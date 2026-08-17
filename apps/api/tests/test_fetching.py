"""The guard on the one place a client chooses where the service connects.

Everywhere else the rule is that a request names a backend and never an
endpoint, so this class of vulnerability cannot exist. A URL attachment is the
exception, and these are the bypasses it has to survive — each of which is a
real technique rather than a hypothetical.
"""

import socket
from unittest.mock import patch

import pytest

from app.fetching import (
    FetchRejected,
    _is_forbidden,
    check,
    extract_text,
    resolve_or_reject,
    validate,
)


def resolving_to(*addresses: str):
    """Pins DNS, so the guard is tested rather than the internet."""
    infos = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 80)) for address in addresses]
    return patch("app.fetching.socket.getaddrinfo", return_value=infos)


class TestTheUrlItself:
    @pytest.mark.parametrize(
        "url",
        [
            "file:///etc/passwd",
            "gopher://internal:70/",
            "dict://localhost:11211/stat",
            "ftp://example.com/x",
            "javascript:alert(1)",
        ],
    )
    def test_refuses_schemes_that_are_not_http(self, url: str):
        # file:// is a local disclosure; gopher and dict are the classic ways to
        # speak to memcached and redis through a fetcher.
        with pytest.raises(FetchRejected) as raised:
            validate(url)

        assert "http and https" in raised.value.reason

    def test_refuses_credentials_in_the_url(self):
        # Forwarding them means the service authenticating on someone's behalf
        # to a destination they chose.
        with pytest.raises(FetchRejected) as raised:
            validate("http://admin:hunter2@example.com/")

        assert "credentials" in raised.value.reason

    def test_refuses_a_url_with_no_host(self):
        with pytest.raises(FetchRejected):
            validate("http:///nowhere")

    def test_accepts_an_ordinary_url_and_reports_its_port(self):
        assert validate("https://example.com/page") == ("example.com", 443)
        assert validate("http://example.com/page") == ("example.com", 80)
        assert validate("http://example.com:8080/page") == ("example.com", 8080)


class TestWhereItResolves:
    @pytest.mark.parametrize(
        "address",
        [
            "127.0.0.1",  # loopback
            "10.0.0.5",  # private
            "192.168.1.1",  # private
            "172.16.0.1",  # private
            "169.254.169.254",  # cloud metadata: SSRF into stolen credentials
            "0.0.0.0",  # unspecified
            "224.0.0.1",  # multicast
            "::1",  # IPv6 loopback
            "fd00::1",  # IPv6 unique-local
            "fe80::1",  # IPv6 link-local
        ],
    )
    def test_refuses_addresses_a_client_must_not_reach(self, address: str):
        assert _is_forbidden(address)

    def test_sees_through_ipv4_mapped_ipv6(self):
        # ::ffff:127.0.0.1 is loopback wearing a different notation, and
        # `is_private` does not see through it on its own.
        assert _is_forbidden("::ffff:127.0.0.1")
        assert _is_forbidden("::ffff:169.254.169.254")

    def test_allows_a_public_address(self):
        assert not _is_forbidden("93.184.216.34")
        assert not _is_forbidden("2606:2800:220:1:248:1893:25c8:1946")

    def test_checks_the_address_not_the_name(self):
        # localtest.me and 127.0.0.1.nip.io are public names for private
        # addresses. A blocklist of hostnames lets both through.
        with resolving_to("127.0.0.1"), pytest.raises(FetchRejected) as raised:
            resolve_or_reject("http://localtest.me/", "localtest.me", 80)

        assert "127.0.0.1" in raised.value.reason

    def test_refuses_a_name_that_resolves_to_both_public_and_private(self):
        # A name that could be connected to either is a name that could be
        # connected to the private one.
        with resolving_to("93.184.216.34", "10.1.2.3"), pytest.raises(FetchRejected):
            resolve_or_reject("http://split.example/", "split.example", 80)

    def test_refuses_a_name_that_does_not_resolve(self):
        with patch("app.fetching.socket.getaddrinfo", side_effect=socket.gaierror):
            with pytest.raises(FetchRejected) as raised:
                resolve_or_reject("http://nope.invalid/", "nope.invalid", 80)

        assert "does not resolve" in raised.value.reason

    def test_allows_a_name_that_resolves_only_to_public_addresses(self):
        with resolving_to("93.184.216.34"):
            assert resolve_or_reject("http://example.com/", "example.com", 80) == ["93.184.216.34"]

    def test_check_runs_both_halves(self):
        with resolving_to("127.0.0.1"), pytest.raises(FetchRejected):
            check("http://anything.example/")


class TestWhatIsRead:
    def test_reads_plain_text(self):
        assert extract_text("text/plain", b"hello", "u") == "hello"

    def test_takes_the_visible_text_out_of_html(self):
        html = b"<html><body><h1>Supplier report</h1><p>ITAMCO is late.</p></body></html>"
        text = extract_text("text/html", html, "u")

        assert "Supplier report" in text
        assert "ITAMCO is late." in text
        assert "<h1>" not in text

    def test_drops_script_and_style_content(self):
        # The bulk of a modern page and none of its meaning. Feeding minified
        # JavaScript to a language model is worse than feeding it nothing.
        html = (
            b"<html><head><style>.a{color:red}</style>"
            b"<script>var x=1;alert('hi')</script></head>"
            b"<body><p>Real content.</p></body></html>"
        )
        text = extract_text("text/html", html, "u")

        assert "Real content." in text
        assert "color:red" not in text
        assert "alert" not in text

    def test_refuses_a_type_it_does_not_read(self):
        with pytest.raises(FetchRejected) as raised:
            extract_text("image/png", b"\x89PNG\r\n", "u")

        assert "not a text type" in raised.value.reason

    def test_ignores_charset_parameters_on_the_content_type(self):
        assert extract_text("text/plain; charset=utf-8", b"fine", "u") == "fine"

    def test_refuses_a_page_with_no_readable_text(self):
        with pytest.raises(FetchRejected) as raised:
            extract_text("text/html", b"<html><body><script>x=1</script></body></html>", "u")

        assert "no readable text" in raised.value.reason


class TestRedirectsAreRevalidated:
    """The bypass that defeats a check which only runs once.

    A destination passes validation, returns 302 to 169.254.169.254, and a
    client that follows redirects by default fetches the metadata endpoint on
    the attacker's behalf. Every hop is therefore revalidated.
    """

    @staticmethod
    def _transport(handler):
        import httpx

        return httpx.MockTransport(handler)

    @pytest.mark.anyio
    async def test_refuses_a_redirect_to_a_private_address(self):
        import httpx

        from app.fetching import fetch

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/start":
                return httpx.Response(
                    302, headers={"location": "http://169.254.169.254/latest/meta-data/"}
                )
            return httpx.Response(200, text="secrets", headers={"content-type": "text/plain"})

        # Public on the first hop, the metadata address on the second.
        def resolve(host, port, **_):
            address = "93.184.216.34" if host == "public.example" else host
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, port))]

        with patch("app.fetching.socket.getaddrinfo", side_effect=resolve):
            with pytest.raises(FetchRejected) as raised:
                await fetch("http://public.example/start", transport=self._transport(handler))

        assert "169.254.169.254" in raised.value.reason

    @pytest.mark.anyio
    async def test_follows_a_redirect_between_public_hosts(self):
        import httpx

        from app.fetching import fetch

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/start":
                return httpx.Response(302, headers={"location": "http://public.example/final"})
            return httpx.Response(200, text="Arrived.", headers={"content-type": "text/plain"})

        with resolving_to("93.184.216.34"):
            page = await fetch("http://public.example/start", transport=self._transport(handler))

        assert page.text == "Arrived."

    @pytest.mark.anyio
    async def test_stops_after_too_many_redirects(self):
        import httpx

        from app.fetching import fetch

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(302, headers={"location": "http://public.example/again"})

        with resolving_to("93.184.216.34"):
            with pytest.raises(FetchRejected) as raised:
                await fetch(
                    "http://public.example/start",
                    max_redirects=2,
                    transport=self._transport(handler),
                )

        assert "redirected more than" in raised.value.reason

    @pytest.mark.anyio
    async def test_stops_reading_at_the_byte_cap(self):
        # Against the stream, not against Content-Length, which a hostile server
        # is free to understate.
        import httpx

        from app.fetching import fetch

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200, content=b"x" * 50_000, headers={"content-type": "text/plain"}
            )

        with resolving_to("93.184.216.34"):
            with pytest.raises(FetchRejected) as raised:
                await fetch(
                    "http://public.example/big",
                    max_bytes=1_000,
                    transport=self._transport(handler),
                )

        assert "larger than" in raised.value.reason


class TestRefusalsReachTheAnswer:
    """A refusal collected and never reported is the same as not checking."""

    def test_a_blocked_url_is_reported_in_the_done_frame(self, client, query_body):
        body = {
            **query_body,
            "input": {
                "text": "supplier risk",
                "urls": ["http://169.254.169.254/latest/meta-data/"],
            },
        }
        response = client.post("/api/query", json=body)

        assert response.status_code == 200
        assert "not a public address" in response.text

    def test_a_blocked_url_does_not_fail_the_question(self, client, query_body):
        # The graph can usually still answer, and a refusal is more useful
        # attached to the answer than instead of it.
        body = {**query_body, "input": {"text": "supplier risk", "urls": ["file:///etc/passwd"]}}
        response = client.post("/api/query", json=body)

        assert response.status_code == 200
        assert "event: done" in response.text
        assert "only http and https" in response.text

    def test_a_question_with_no_urls_carries_no_refusals(self, client, query_body):
        # Asserted on behaviour rather than on how null is serialised: a
        # question that attached nothing should report nothing declined.
        response = client.post("/api/query", json=query_body)

        assert "was not fetched" not in response.text
