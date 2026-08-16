"""The generator's job is not "make a lot of nodes".

It is to produce a graph that can *falsify* the pipeline: skewed enough that
ranking can be wrong, provenanced enough that confidence and recency mean
something, and reproducible enough that a failure can be looked at twice.
Volume without those is a slower version of the fixture graph.
"""

import statistics
from collections import Counter
from datetime import datetime

import pytest

from app import ontology
from app.generator import DEFAULT_REFERENCE, GENERATED_PREFIX, generate


def test_same_seed_gives_the_same_graph():
    # A dataset that changes per run cannot be asserted against, and a bug that
    # only appears on someone else's data is a bug nobody can reproduce.
    first = generate(40, seed=7)
    second = generate(40, seed=7)

    assert first.nodes == second.nodes
    assert first.edges == second.edges


def test_a_different_seed_gives_a_different_graph():
    assert generate(40, seed=7).edges != generate(40, seed=8).edges


def test_scale_drives_size():
    small = generate(20, seed=1)
    large = generate(200, seed=1)

    assert len(large.nodes) > len(small.nodes) * 5


def test_an_empty_scale_produces_nothing_rather_than_failing():
    # The seeder passes this through from a flag, so zero is a request for the
    # sample alone, not a request the generator should reject.
    empty = generate(0)

    assert empty.nodes == []
    assert empty.edges == []


def test_every_type_it_emits_is_declared_in_the_vocabulary():
    # The same agreement the fixture graph is held to. A generator inventing an
    # undeclared type would silently break the JSON-LD export, which is exactly
    # the bug item 65 was about.
    graph = generate(60, seed=3)

    for node in graph.nodes:
        assert node.type in ontology.CLASSES, f"undeclared class {node.type}"
    for edge in graph.edges:
        assert edge.type in ontology.PROPERTIES, f"undeclared property {edge.type}"


def test_it_exercises_the_whole_vocabulary():
    # The other direction, and the one that matters for a test dataset: a
    # relationship the generator never emits is a relationship retrieval is
    # never tested against.
    graph = generate(120, seed=3)
    emitted = {edge.type for edge in graph.edges}

    declared = set(ontology.PROPERTIES) - {"relatedTo"}
    assert declared - emitted == set(), f"never generated: {declared - emitted}"


def test_degree_is_skewed_not_uniform():
    """The property that makes ranking falsifiable.

    On a uniform graph every candidate looks alike, so a ranking that does
    nothing scores as well as one that works. The interesting questions are
    about the suppliers a lot depends on, and those only exist if some
    suppliers carry far more than the median.
    """
    graph = generate(200, seed=5)
    out_degree = Counter(edge.source for edge in graph.edges)

    suppliers = [node.id for node in graph.nodes if node.type == "Supplier"]
    degrees = sorted((out_degree[supplier_id] for supplier_id in suppliers), reverse=True)

    median = statistics.median(degrees)
    assert degrees[0] >= median * 3, "no hubs: the graph is effectively uniform"


def test_every_statement_carries_its_own_confidence():
    # A constant confidence is why the signal was inert. The scoring
    # renormalises over whichever signals a candidate carries, so a constant
    # contributes range but no discrimination.
    graph = generate(80, seed=11)
    values = {edge.confidence for edge in graph.edges}

    assert len(values) > 20, "confidence is not varying"
    assert all(0.0 < value <= 1.0 for value in values), "confidence outside [0,1]"


def test_confidence_reflects_the_kind_of_claim():
    graph = generate(300, seed=13)

    def mean_for(relation: str) -> float:
        return statistics.mean(edge.confidence for edge in graph.edges if edge.type == relation)

    # A shipment's destination is a matter of record; a risk attribution is a
    # judgement. Ranking them alike is what a single constant did.
    assert mean_for("DELIVERED_TO") > mean_for("HAS_RISK")


def test_extraction_dates_spread_far_enough_to_discriminate():
    graph = generate(80, seed=17)
    dates = [edge.extracted_at for edge in graph.edges]

    span = max(dates) - min(dates)
    # The recency half-life is 365 days. Data all newer than that has range but
    # nothing to separate, so the weight would still do no work.
    assert span.days > 365, "every fact is equally recent; recency cannot rank"
    assert max(dates) <= DEFAULT_REFERENCE


def test_the_reference_date_is_the_callers_choice():
    # Seeded data should read as current; a test asserting on it must not
    # depend on when it runs. Both need the same generator.
    reference = datetime(2020, 1, 1)
    graph = generate(20, seed=2, reference=reference)

    assert max(edge.extracted_at for edge in graph.edges) <= reference


def test_generated_ids_are_distinguishable_from_the_sample():
    # A store can hold both. Tests that make exact assertions need to know
    # which they are looking at.
    graph = generate(30, seed=4)

    assert all(node.id.startswith(f"{GENERATED_PREFIX}_") for node in graph.nodes)


def test_ids_are_unique():
    graph = generate(150, seed=6)
    ids = [node.id for node in graph.nodes]

    # Two nodes sharing an id would MERGE into one on seeding, silently
    # collapsing the graph.
    assert len(ids) == len(set(ids))


def test_every_edge_connects_nodes_that_exist():
    graph = generate(100, seed=9)
    known = {node.id for node in graph.nodes}

    for edge in graph.edges:
        assert edge.source in known, f"dangling source {edge.source}"
        assert edge.target in known, f"dangling target {edge.target}"


def test_labels_are_not_drawn_from_one_template():
    """Retrieval scores lexical overlap, so labels are part of the test.

    Names sharing every token would make the generated graph easier to search
    than any real one, and the scoring would look better than it is.
    """
    graph = generate(200, seed=21)
    names = [node.label for node in graph.nodes if node.type == "Supplier"]

    first_tokens = Counter(name.split()[0] for name in names)
    assert len(first_tokens) > 10
    assert first_tokens.most_common(1)[0][1] < len(names) * 0.35


@pytest.mark.parametrize("scale", [1, 2, 5])
def test_small_scales_still_produce_a_connected_shape(scale: int):
    # Scale 1 is a degenerate case a developer will absolutely run.
    graph = generate(scale, seed=1)

    assert graph.nodes
    assert graph.edges
    types = {node.type for node in graph.nodes}
    assert {"Supplier", "Product", "Shipment", "Location"} <= types
