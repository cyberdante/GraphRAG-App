"""Every backend must behave the same way, or "switchable" means nothing.

The pipeline downstream of retrieval — scoring, ranking, the prompt, the graph
frame — is written once against the `GraphStore` port. That only holds if each
store returns evidence of the same shape with the same guarantees. A store that
omits `subject_type` produces an uncoloured graph; one that ignores
`max_candidates` truncates before ranking runs, which silently defeats the
ranking. Neither shows up as an error, and neither is caught by testing one
backend well.

So this suite is written against the port and run against every store the
machine can reach. The fixture store always runs. The openCypher store runs when
a Bolt endpoint is up and seeded — `docker compose up -d neo4j && python
scripts/seed_neo4j.py` — and skips with a reason when it is not, so the suite
stays honest either way rather than quietly covering one backend.
"""

import os
import socket
from contextlib import closing

import pytest

from app.retrieval.fixture_store import FixtureGraphStore
from app.retrieval.models import RetrievalRequest
from app.retrieval.store import GraphStore

BOLT_URI = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
BOLT_USER = os.environ.get("NEO4J_USER", "neo4j")
BOLT_PASSWORD = os.environ.get("NEO4J_PASSWORD", "ragstone-dev")


def _bolt_is_listening(uri: str, timeout: float = 0.35) -> bool:
    """Cheap reachability check, so a missing container skips rather than hangs."""
    host, _, port = uri.rsplit("/", 1)[-1].partition(":")
    with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as probe:
        probe.settimeout(timeout)
        return probe.connect_ex((host or "localhost", int(port or 7687))) == 0


def _cypher_store() -> GraphStore:
    from app.retrieval.cypher_store import CypherGraphStore, build_driver

    return CypherGraphStore(build_driver(BOLT_URI, BOLT_USER, BOLT_PASSWORD))


#: Set where the store is supposed to be there. A skip is the right answer on a
#: laptop without Docker and the wrong one in the job that exists to exercise
#: the real backend: a container that failed to start would skip its way to a
#: green tick, and the suite would report success for tests that never ran.
REQUIRE_CYPHER = os.environ.get("RAGSTONE_REQUIRE_CYPHER") == "1"

cypher_available = pytest.mark.skipif(
    not REQUIRE_CYPHER and not _bolt_is_listening(BOLT_URI),
    reason=f"No Bolt endpoint at {BOLT_URI}. Run: docker compose up -d neo4j",
)


@pytest.fixture(params=["fixtures", pytest.param("cypher", marks=cypher_available)])
async def store(request: pytest.FixtureRequest):
    """Each test below runs once per backend this machine can reach."""
    if request.param == "fixtures":
        yield FixtureGraphStore()
        return

    built = _cypher_store()
    try:
        yield built
    finally:
        await built.close()


@pytest.mark.anyio
async def test_returns_statements_with_a_complete_triple(store: GraphStore):
    candidates = await store.retrieve(RetrievalRequest(query="supplier risk"))

    assert candidates, f"{store.name} returned no evidence for a question the graph answers"
    for candidate in candidates:
        # A statement missing any leg cannot be cited or drawn: the citation
        # renders without node ids, and the graph frame drops the edge.
        assert candidate.subject, f"{store.name} returned a statement with no subject"
        assert candidate.predicate, f"{store.name} returned a statement with no predicate"
        assert candidate.object, f"{store.name} returned a statement with no object"


@pytest.mark.anyio
async def test_carries_the_labels_and_types_the_graph_frame_needs(store: GraphStore):
    # The frame is projected from the answer's own evidence rather than fetched
    # separately, so whatever it needs to draw a node has to arrive here.
    candidates = await store.retrieve(RetrievalRequest(query="supplier risk"))

    for candidate in candidates:
        assert candidate.subject_label, f"{store.name} returned a node with no label"
        assert candidate.object_label, f"{store.name} returned a node with no label"
        assert candidate.subject_type, f"{store.name} returned a node with no type"
        assert candidate.object_type, f"{store.name} returned a node with no type"


@pytest.mark.anyio
async def test_text_reads_as_a_sentence_about_the_labels(store: GraphStore):
    candidates = await store.retrieve(RetrievalRequest(query="supplier risk"))

    for candidate in candidates:
        # The text is what reaches the prompt and the citation, so it must name
        # the entities rather than their opaque ids.
        assert candidate.subject_label in candidate.text
        assert candidate.object_label in candidate.text


@pytest.mark.anyio
async def test_respects_the_search_budget(store: GraphStore):
    capped = await store.retrieve(RetrievalRequest(query="supplier risk", max_candidates=3))

    # Exceeding the budget is a memory and latency problem; the pipeline sized
    # it deliberately.
    assert len(capped) <= 3


@pytest.mark.anyio
async def test_a_budget_of_zero_still_returns_something_rather_than_failing(
    store: GraphStore,
):
    # Callers compute this from settings, so a zero is a configuration slip
    # rather than a request for nothing. Failing the query would turn a slip
    # into an outage.
    candidates = await store.retrieve(RetrievalRequest(query="supplier risk", max_candidates=0))

    assert len(candidates) == 1


@pytest.mark.anyio
async def test_entity_types_narrow_the_result(store: GraphStore):
    everything = await store.retrieve(RetrievalRequest(query="supplier risk"))
    risks_only = await store.retrieve(
        RetrievalRequest(query="supplier risk", entity_types=["Risk"])
    )

    assert risks_only, f"{store.name} filtered away a type the graph contains"
    assert len(risks_only) <= len(everything)
    for candidate in risks_only:
        assert "Risk" in {candidate.subject_type, candidate.object_type}


@pytest.mark.anyio
async def test_no_entity_types_means_no_filter(store: GraphStore):
    unfiltered = await store.retrieve(RetrievalRequest(query="supplier risk", entity_types=[]))
    narrowed = await store.retrieve(RetrievalRequest(query="supplier risk", entity_types=["Risk"]))

    # An empty list is "everything", not "nothing" — reading it the other way
    # silently returns an empty answer for every unscoped question.
    assert len(unfiltered) >= len(narrowed)


@pytest.mark.anyio
async def test_candidates_dedupe_by_key(store: GraphStore):
    candidates = await store.retrieve(RetrievalRequest(query="supplier risk"))
    keys = [candidate.key() for candidate in candidates]

    # Retrieval runs several passes and merges them on this key. Two distinct
    # facts sharing one key would silently drop evidence.
    assert len(keys) == len(set(keys)), f"{store.name} returned colliding candidate keys"


@pytest.mark.anyio
async def test_the_question_selects_the_evidence(store: GraphStore):
    """The property the whole pipeline rests on, and the one that was missing.

    A store that ignores the question answers every question with the same
    rows. Ranking downstream can then only reorder an arbitrary prefix — it
    cannot recover evidence the store never returned. That was invisible while
    the sample graph fitted inside the search budget, and wrong the moment it
    did not.

    Asserted by difference rather than by content, because it holds whatever
    the store contains: two questions about different things cannot both be
    answered by the same rows.
    """
    risks = await store.retrieve(RetrievalRequest(query="risk", max_candidates=20))
    deliveries = await store.retrieve(
        RetrievalRequest(query="warehouse delivered location", max_candidates=20)
    )

    assert risks, f"{store.name} found nothing for a question the graph answers"
    assert deliveries, f"{store.name} found nothing for a question the graph answers"
    assert {candidate.key() for candidate in risks} != {
        candidate.key() for candidate in deliveries
    }, f"{store.name} returns the same evidence regardless of the question"


@pytest.mark.anyio
async def test_the_evidence_is_mostly_about_what_was_asked(store: GraphStore):
    # Difference alone would be satisfied by returning two different arbitrary
    # prefixes. This asks that the evidence actually concerns the question.
    candidates = await store.retrieve(RetrievalRequest(query="risk", max_candidates=20))

    on_topic = [candidate for candidate in candidates if "risk" in candidate.searchable.lower()]
    assert len(on_topic) >= len(candidates) / 2, (
        f"{store.name} returned {len(on_topic)}/{len(candidates)} candidates about risk"
    )


@pytest.mark.anyio
async def test_a_question_with_no_content_words_still_returns_evidence(store: GraphStore):
    # "what is there" stems to nothing. A store with no terms to search on has
    # no relevance to select by, and answering with silence would be worse than
    # answering with a prefix.
    candidates = await store.retrieve(RetrievalRequest(query="what is there?"))

    assert candidates


@pytest.mark.anyio
async def test_declares_an_identity_a_request_can_name(store: GraphStore):
    assert store.name and store.name.isidentifier()
    assert store.description


async def _dataset_scale() -> int:
    """How much generated volume the store holds, as the seeder recorded it.

    Exact equality against the fixture graph only means anything when the store
    holds the fixture graph and nothing else. Rather than let that test fail
    confusingly the moment someone seeds volume, ask the store what it has.
    """
    from app.retrieval.cypher_store import build_driver

    driver = build_driver(BOLT_URI, BOLT_USER, BOLT_PASSWORD)
    try:
        async with driver.session() as session:
            result = await session.run(
                "MATCH (d:RagstoneDataset {id: 'dataset'}) RETURN d.scale AS scale"
            )
            record = await result.single()
            return int(record["scale"]) if record and record["scale"] is not None else 0
    finally:
        await driver.close()


@pytest.mark.anyio
@cypher_available
async def test_both_backends_describe_the_same_graph_identically():
    """The strongest form of the claim: same source graph, same evidence.

    The per-store properties above are necessary but not sufficient — two
    stores can each satisfy every one of them and still disagree. That
    disagreement is invisible in the UI and expensive in the pipeline: the
    ranking weights are renormalised over whichever signals a candidate
    carries, so a backend that omits `confidence` ranks the same fact
    differently from one that records it. The answer changes with the backend
    while the graph does not.

    This caught exactly that: the seeder wrote no confidence and named the
    source differently from the fixture store.
    """
    from app.retrieval.cypher_store import CypherGraphStore, build_driver

    scale = await _dataset_scale()
    if scale:
        pytest.skip(
            f"Store holds generated volume (scale {scale}); equivalence is asserted "
            "against the sample alone. Re-seed with: python scripts/seed_neo4j.py --clear"
        )

    request = RetrievalRequest(query="supplier risk")
    from_fixtures = await FixtureGraphStore().retrieve(request)

    cypher = CypherGraphStore(build_driver(BOLT_URI, BOLT_USER, BOLT_PASSWORD))
    try:
        from_cypher = await cypher.retrieve(request)
    finally:
        await cypher.close()

    def described(candidates: list) -> set[tuple]:
        # Order is a store's own business; ranking imposes its own. Everything
        # else about a piece of evidence has to match.
        return {
            (
                candidate.subject,
                candidate.predicate,
                candidate.object,
                candidate.text,
                candidate.subject_type,
                candidate.object_type,
                candidate.subject_label,
                candidate.object_label,
                candidate.confidence,
                candidate.source,
            )
            for candidate in candidates
        }

    assert described(from_fixtures) == described(from_cypher)


@pytest.mark.anyio
async def test_an_entity_id_anchors_the_search(store: GraphStore):
    """An id names an individual, so it is looked up rather than searched for.

    Attachments of this kind used to reach the request and stop there. Someone
    who attaches `sup_88` has said exactly what the question is about, and
    matching that against keywords would throw the information away — so the
    evidence returned has to actually be about that node.
    """
    anchored = await store.retrieve(
        RetrievalRequest(query="anything at all", entity_ids=["sup_88"], max_candidates=40)
    )

    assert anchored, f"{store.name} returned nothing for an id its graph contains"
    assert any("sup_88" in {candidate.subject, candidate.object} for candidate in anchored), (
        f"{store.name} ignored the id it was given"
    )


@pytest.mark.anyio
async def test_an_id_works_even_when_the_question_matches_nothing(store: GraphStore):
    # The case that distinguishes an anchor from a filter: prose that matches no
    # keyword in the graph must not suppress an id that does exist.
    anchored = await store.retrieve(
        RetrievalRequest(query="zeppelin trombone", entity_ids=["sup_88"], max_candidates=40)
    )

    assert any("sup_88" in {candidate.subject, candidate.object} for candidate in anchored)


@pytest.mark.anyio
async def test_an_unknown_id_is_not_an_error(store: GraphStore):
    # An id that has gone is not something the asker can act on, and failing the
    # whole question over it would be worse than answering from the rest.
    result = await store.retrieve(
        RetrievalRequest(query="supplier risk", entity_ids=["no_such_node"])
    )

    assert isinstance(result, list)
