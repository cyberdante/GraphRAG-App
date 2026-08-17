"""Fetching a URL somebody else chose.

This is the one place the service makes an outbound request to an address a
*client* supplied, which makes it the highest-risk code in the repository.
Everywhere else the rule is that a request names a backend and never an
endpoint, precisely so that this class of vulnerability cannot exist. A URL
attachment is the exception, so it carries the guard the rest of the design
avoids needing.

What the guard stops:

- **Non-HTTP schemes.** `file:///etc/passwd`, `gopher://`, `dict://` and the
  rest are refused before anything is opened.
- **Credentials in the URL.** `http://user:pass@host` is refused rather than
  forwarded, because forwarding it means the service authenticating on
  someone's behalf to a destination they chose.
- **Private, loopback, link-local, reserved and multicast addresses.** Every
  address the hostname resolves to is checked, not just the first, and the check
  is on the resolved address rather than on the name — `localtest.me` and
  `127.0.0.1.nip.io` are public names for private addresses, and a blocklist of
  hostnames would let both through.
- **Cloud metadata.** 169.254.169.254 is link-local, so it is already covered;
  it is worth naming because it is the specific address that turns an SSRF into
  stolen credentials.
- **Redirects.** Followed manually, one hop at a time, with the full check
  applied to every hop. A destination that passes validation and then redirects
  to 169.254.169.254 is the standard bypass, and libraries follow redirects by
  default.
- **Size and time.** Read in chunks against a byte cap, under a total timeout,
  so a slow or endless response cannot exhaust the service.
- **Content type.** Only text is read. An image or a binary is refused rather
  than decoded hopefully.

**What the guard does not stop, stated plainly.** There is a window between
resolving a hostname and connecting to it in which DNS could change — a rebinding
attack. Closing it completely requires pinning the connection to the address
that was validated, which means a custom transport and, for HTTPS, taking over
certificate verification. It is not closed here. The mitigation that *is* here is
that the resolved addresses are re-checked on every redirect hop, and the
residual window is a few milliseconds against an attacker who already needs
control of a DNS zone.

Nor does any of this stop the service being used to fetch arbitrary *public*
URLs, which is a bandwidth and reputation concern rather than a disclosure one.
That is what rate limiting is for, and it is a separate item.
"""

from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import urlsplit

#: Read no more than this from one URL. Streamed against, not trusted from
#: Content-Length, which a hostile server is free to lie about.
MAX_FETCH_BYTES = 1 * 1024 * 1024

#: Total seconds for connect, read and everything in between.
FETCH_TIMEOUT_SECONDS = 8.0

#: How many redirects to follow. Each hop is fully revalidated.
MAX_REDIRECTS = 3

#: Content types worth reading. Anything else is refused rather than decoded in
#: hope: this service reads text, and a JPEG that decodes as latin-1 is not text.
TEXT_CONTENT_TYPES = (
    "text/plain",
    "text/markdown",
    "text/html",
    "text/csv",
    "application/json",
    "application/xhtml+xml",
)


class FetchRejected(ValueError):
    """Why a URL was not fetched, in words a person can act on."""

    def __init__(self, url: str, reason: str) -> None:
        self.url = url
        self.reason = reason
        super().__init__(f"{url}: {reason}")


def _is_forbidden(address: str) -> bool:
    """Whether an IP is somewhere a client must not be able to send us."""
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        # Not an address we can reason about, so not one we will connect to.
        return True

    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local  # includes 169.254.169.254, the metadata endpoint
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
        # IPv4 mapped into IPv6 (::ffff:127.0.0.1) is the same address wearing a
        # different notation, and `is_private` does not see through it.
        or (
            isinstance(ip, ipaddress.IPv6Address)
            and ip.ipv4_mapped is not None
            and _is_forbidden(str(ip.ipv4_mapped))
        )
    )


def resolve_or_reject(url: str, host: str, port: int) -> list[str]:
    """Every address the host resolves to, or a refusal naming the first bad one.

    All of them are checked. A name that resolves to one public address and one
    private one is a name that could be connected to either, so it is refused.
    """
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise FetchRejected(url, "the host name does not resolve") from None

    addresses = sorted({info[4][0] for info in infos})
    if not addresses:
        raise FetchRejected(url, "the host name does not resolve")

    for address in addresses:
        if _is_forbidden(address):
            raise FetchRejected(
                url,
                f"resolves to {address}, which is not a public address. "
                "This service will not fetch from private, loopback or "
                "link-local addresses.",
            )

    return addresses


def validate(url: str) -> tuple[str, int]:
    """Checks the URL itself, and returns the host and port to resolve.

    Everything here is about the URL as written; `resolve_or_reject` handles
    where it actually points.
    """
    parts = urlsplit(url.strip())

    if parts.scheme not in {"http", "https"}:
        raise FetchRejected(url, "only http and https URLs can be fetched")

    if parts.username or parts.password:
        raise FetchRejected(
            url,
            "URLs carrying credentials are not fetched, because that would mean "
            "this service authenticating on your behalf to a destination you chose",
        )

    if not parts.hostname:
        raise FetchRejected(url, "no host in the URL")

    port = parts.port or (443 if parts.scheme == "https" else 80)
    return parts.hostname, port


def check(url: str) -> list[str]:
    """The full pre-flight: the URL, then where it resolves."""
    host, port = validate(url)
    return resolve_or_reject(url, host, port)


class _TextExtractor(HTMLParser):
    """Visible text from HTML, without taking on a parser dependency.

    Script and style contents are dropped rather than included: they are the
    bulk of a modern page and none of its meaning, and feeding minified
    JavaScript to a language model is worse than feeding it nothing.
    """

    _SKIP = frozenset({"script", "style", "noscript", "template", "svg"})

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._parts: list[str] = []
        self._skipping = 0

    def handle_starttag(self, tag: str, attrs: object) -> None:
        if tag in self._SKIP:
            self._skipping += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in self._SKIP and self._skipping:
            self._skipping -= 1

    def handle_data(self, data: str) -> None:
        if self._skipping:
            return
        text = data.strip()
        if text:
            self._parts.append(text)

    @property
    def text(self) -> str:
        # Paragraph breaks, so the chunker has something to split on.
        return "\n\n".join(self._parts)


def extract_text(content_type: str, raw: bytes, url: str) -> str:
    """The readable text of a response, or a refusal."""
    base_type = content_type.split(";")[0].strip().lower()

    if base_type and base_type not in TEXT_CONTENT_TYPES:
        raise FetchRejected(url, f"{base_type} is not a text type this service reads")

    try:
        decoded = raw.decode("utf-8", errors="replace")
    except Exception:  # pragma: no cover - decode with replace does not raise
        raise FetchRejected(url, "the response could not be decoded as text") from None

    text = (
        _extract_html(decoded) if base_type in {"text/html", "application/xhtml+xml"} else decoded
    )

    if not text.strip():
        raise FetchRejected(url, "the page contained no readable text")

    return text


def _extract_html(markup: str) -> str:
    parser = _TextExtractor()
    parser.feed(markup)
    parser.close()
    return parser.text


@dataclass(frozen=True)
class FetchedPage:
    url: str
    title: str
    text: str


async def fetch(
    url: str,
    *,
    max_bytes: int = MAX_FETCH_BYTES,
    timeout: float = FETCH_TIMEOUT_SECONDS,
    max_redirects: int = MAX_REDIRECTS,
    transport: object | None = None,
) -> FetchedPage:
    """Fetches one URL, revalidating every redirect hop.

    Redirects are followed by hand with `follow_redirects=False`, because the
    default is to follow them silently — and a destination that passes
    validation and then redirects to 169.254.169.254 is the standard way past a
    check that only ran once.
    """
    import httpx

    current = url.strip()

    async with httpx.AsyncClient(
        follow_redirects=False,
        timeout=timeout,
        # A seam for tests, which need to answer as a hostile server without
        # one existing. Monkeypatching the client class instead makes the
        # library patch itself, which is how the first attempt at this recursed.
        **({"transport": transport} if transport is not None else {}),
        # A browser-ish agent gets a page rather than a bot wall, and naming the
        # service is the polite half of fetching somebody else's site.
        headers={"User-Agent": "Ragstone/0.1 (+https://github.com/cyberdante/Ragstone)"},
    ) as client:
        for _ in range(max_redirects + 1):
            check(current)

            try:
                async with client.stream("GET", current) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            raise FetchRejected(current, "redirected without a destination")
                        # Resolved against the current URL, so a relative
                        # Location is handled the same as an absolute one.
                        current = str(response.url.join(location))
                        continue

                    if response.status_code >= 400:
                        raise FetchRejected(current, f"the site returned {response.status_code}")

                    # Read against the cap rather than trusting Content-Length,
                    # which a hostile server is free to understate.
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > max_bytes:
                            raise FetchRejected(
                                current,
                                f"larger than {max_bytes // 1024} KB",
                            )

                    text = extract_text(
                        response.headers.get("content-type", ""), bytes(body), current
                    )
                    return FetchedPage(url=current, title=_title(text, current), text=text)

            except httpx.TimeoutException:
                raise FetchRejected(current, "the site did not respond in time") from None
            except httpx.HTTPError as error:
                raise FetchRejected(
                    current, f"could not be reached ({type(error).__name__})"
                ) from None

    raise FetchRejected(url, f"redirected more than {max_redirects} times")


def _title(text: str, url: str) -> str:
    """A short label for citations: the first line, or the host."""
    first = next((line.strip() for line in text.splitlines() if line.strip()), "")
    if 0 < len(first) <= 80:
        return first
    return urlsplit(url).hostname or url
