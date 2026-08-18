"""A subject is configuration, or the claim is decoration.

The vocabulary lived as module constants: six supply-chain classes reachable
only by editing Python. That is fine for one domain and wrong for a product
whose proposition is that a client's graph — pharmaceutical, financial,
whatever they hold — is declared rather than compiled.

The only honest test of that is a second domain. If adding one needs a code
change, it was never configuration, so these run over *every* declared domain
rather than over the one this project happens to ship data for.
"""

import pytest

from app import domains, fixtures, ontology

ALL_DOMAINS = pytest.mark.parametrize("domain", list(domains.DOMAINS.values()), ids=lambda d: d.id)


class TestEveryDomainIsWellFormed:
    @ALL_DOMAINS
    def test_declares_classes_and_properties(self, domain: domains.Domain):
        assert domain.classes, f"{domain.id} declares no classes"
        assert domain.properties, f"{domain.id} declares no properties"

    @ALL_DOMAINS
    def test_every_shape_uses_terms_it_declared(self, domain: domains.Domain):
        # A shape naming a class the domain does not have would plan a traversal
        # to somewhere that cannot exist.
        for start, predicate, target in domain.shapes:
            assert start in domain.classes, f"{domain.id}: {start} is not a declared class"
            assert target in domain.classes, f"{domain.id}: {target} is not a declared class"
            assert predicate in domain.properties, f"{domain.id}: {predicate} is undeclared"

    @ALL_DOMAINS
    def test_carries_a_fallback_for_unnamed_relationships(self, domain: domains.Domain):
        # Emitting a term in our own namespace says "a relationship we have not
        # named", rather than borrowing someone else's IRI to say it.
        assert "relatedTo" in domain.properties

    @ALL_DOMAINS
    def test_offers_somewhere_to_start(self, domain: domains.Domain):
        # A domain with no starter questions gives a newcomer an empty box and
        # a vocabulary they have never seen.
        assert domain.starters, f"{domain.id} offers no starting questions"

    @ALL_DOMAINS
    def test_has_its_own_namespace(self, domain: domains.Domain):
        assert domain.vocab.startswith(domains.NAMESPACE)
        assert domain.id in domain.vocab

    def test_no_two_domains_share_a_namespace(self):
        # Two domains under one IRI would make a term ambiguous, which is the
        # whole failure a namespace exists to prevent.
        namespaces = [domain.vocab for domain in domains.DOMAINS.values()]
        assert len(namespaces) == len(set(namespaces))

    def test_more_than_one_domain_is_declared(self):
        # The test that keeps the rest honest. With a single domain, every
        # assertion above is satisfied by the hardcoded one and proves nothing
        # about whether a second could be added without a code change.
        assert len(domains.DOMAINS) > 1


class TestRenderingIsPerDomain:
    @ALL_DOMAINS
    def test_turtle_describes_the_domain_it_was_given(self, domain: domains.Domain):
        turtle = ontology.to_turtle(domain)

        assert domain.vocab in turtle
        assert f'owl:versionInfo "{domain.version}"' in turtle
        for term in domain.classes:
            assert f"sc:{term} a owl:Class" in turtle

    @ALL_DOMAINS
    def test_turtle_mentions_no_term_the_domain_did_not_declare(self, domain: domains.Domain):
        import re

        turtle = ontology.to_turtle(domain)
        referenced = set(re.findall(r"\bsc:(\w+)\b", turtle))
        # Local names, which is what a prefixed Turtle term is;
        # `properties_of` returns full IRIs and would match nothing.
        known = set(domain.classes) | set(domain.properties.values())

        assert referenced - known == set()

    def test_two_domains_do_not_render_the_same_document(self):
        supply = ontology.to_turtle(domains.SUPPLY_CHAIN)
        clinical = ontology.to_turtle(domains.CLINICAL_TRIALS)

        assert supply != clinical
        assert "Investigator" in clinical
        assert "Investigator" not in supply

    def test_an_export_names_the_vocabulary_it_was_written_in(self):
        # A deployment holding clinical trials must not hand out a document
        # claiming to be supply chain.
        document = ontology.graph_to_jsonld(fixtures.SUPPLY_CHAIN_GRAPH, domains.CLINICAL_TRIALS)

        assert document["isDefinedBy"] == "/ontology/clinical-trials.ttl"
        assert document["@context"]["@vocab"] == domains.CLINICAL_TRIALS.vocab


class TestAgreementAppliesWhereThereIsData:
    """Declarations can only be checked against a graph that exists.

    Supply chain ships a sample; clinical trials does not, and inventing some to
    make an assertion pass would be worse than the assertion not existing. So
    the agreement test runs where there is data and says plainly why it does not
    run elsewhere.
    """

    def test_the_sampled_domain_agrees_with_its_graph(self):
        graph = fixtures.SUPPLY_CHAIN_GRAPH
        nodes = {node.id: node for node in graph.nodes}
        observed = {
            (nodes[link.source].type, link.type, nodes[link.target].type)
            for link in graph.links
            if link.source in nodes and link.target in nodes
        }

        assert observed == set(domains.SUPPLY_CHAIN.shapes)

    def test_exactly_one_domain_claims_a_sample_graph(self):
        # If a second one starts claiming data, it needs its own agreement test
        # rather than inheriting this one's silence.
        sampled = [d.id for d in domains.DOMAINS.values() if d.has_sample_graph]

        assert sampled == ["supply-chain"]


class TestResolving:
    def test_finds_a_declared_domain(self):
        assert domains.get("clinical-trials") is domains.CLINICAL_TRIALS

    def test_falls_back_rather_than_failing(self):
        # A tenant naming a domain this deployment does not hold should render
        # the default: the wrong vocabulary degrades the answers, a failure to
        # boot degrades everything.
        assert domains.get("nonesuch").id == domains.DEFAULT_DOMAIN_ID
        assert domains.get(None).id == domains.DEFAULT_DOMAIN_ID
        assert domains.get("").id == domains.DEFAULT_DOMAIN_ID


class TestTheEndpoints:
    def test_lists_every_domain_with_what_a_console_needs(self, client):
        response = client.get("/api/domains")

        assert response.status_code == 200
        listed = {item["id"]: item for item in response.json()}
        assert set(listed) == set(domains.DOMAINS)
        for item in listed.values():
            assert item["classes"], "a console offering no types has nothing to filter by"
            assert item["starters"]
            assert item["ontology"].endswith(".ttl")

    def test_marks_exactly_one_default(self, client):
        defaults = [item for item in client.get("/api/domains").json() if item["default"]]

        assert len(defaults) == 1

    def test_serves_each_declared_vocabulary(self, client):
        for domain in domains.DOMAINS.values():
            response = client.get(domain.ontology_path)

            assert response.status_code == 200, domain.id
            assert response.headers["content-type"].startswith("text/turtle")
            assert domain.vocab in response.text

    def test_an_unknown_vocabulary_is_a_404_rather_than_a_fallback(self, client):
        # An unknown tenant should still render; an unknown *document* that
        # quietly returned a different vocabulary would be worse than silence.
        assert client.get("/ontology/nonesuch.ttl").status_code == 404
