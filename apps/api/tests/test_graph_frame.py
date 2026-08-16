"""The graph frame is a projection of the evidence, not a separate query.

That is the property worth protecting: whatever the answer stands on is what
the user sees. A test suite that only checked the frame was well-formed would
miss the point — these check it *matches the candidates it came from*.
"""

from app.retrieval.graph_frame import graph_from_candidates
from app.retrieval.models import Candidate


def statement(subject: str, predicate: str, obj: str, **kwargs) -> Candidate:
    return Candidate(
        kind="statement",
        text=f"{subject} {predicate} {obj}",
        subject=subject,
        predicate=predicate,
        object=obj,
        subject_label=kwargs.get("subject_label", subject.upper()),
        object_label=kwargs.get("object_label", obj.upper()),
        subject_type=kwargs.get("subject_type", "Supplier"),
        object_type=kwargs.get("object_type", "Risk"),
    )


class TestProjection:
    def test_builds_nodes_and_links_from_triples(self) -> None:
        graph = graph_from_candidates([statement("sup_88", "HAS_RISK", "risk_12")], max_nodes=10)

        assert {node.id for node in graph.nodes} == {"sup_88", "risk_12"}
        assert graph.links[0].source == "sup_88"
        assert graph.links[0].target == "risk_12"

    def test_carries_labels_and_types_through(self) -> None:
        graph = graph_from_candidates(
            [statement("sup_88", "HAS_RISK", "risk_12", subject_label="ITAMCO")],
            max_nodes=10,
        )
        node = next(node for node in graph.nodes if node.id == "sup_88")

        assert node.label == "ITAMCO"
        assert node.type == "Supplier"

    def test_humanizes_the_predicate_for_display(self) -> None:
        graph = graph_from_candidates([statement("a", "HAS_RISK", "b")], max_nodes=10)
        assert graph.links[0].label == "has risk"
        # The machine-readable type survives alongside it.
        assert graph.links[0].type == "HAS_RISK"

    def test_shares_a_node_between_statements_rather_than_duplicating_it(self) -> None:
        graph = graph_from_candidates(
            [statement("sup_88", "HAS_RISK", "r1"), statement("sup_88", "SHIPS", "s1")],
            max_nodes=10,
        )
        assert len(graph.nodes) == 3
        assert len(graph.links) == 2

    def test_ignores_candidates_that_are_not_triples(self) -> None:
        prose = Candidate(kind="chunk", text="some prose with no subject")
        graph = graph_from_candidates([prose, statement("a", "P", "b")], max_nodes=10)

        assert len(graph.nodes) == 2

    def test_drops_duplicate_links(self) -> None:
        graph = graph_from_candidates(
            [statement("a", "P", "b"), statement("a", "P", "b")], max_nodes=10
        )
        assert len(graph.links) == 1

    def test_assigns_a_stable_group_per_entity_type(self) -> None:
        graph = graph_from_candidates([statement("a", "P", "b")], max_nodes=10)
        groups = {node.type: node.group for node in graph.nodes}

        assert groups["Supplier"] != groups["Risk"]


class TestCapping:
    def test_respects_the_node_cap(self) -> None:
        candidates = [statement(f"s{i}", "P", f"o{i}") for i in range(20)]
        graph = graph_from_candidates(candidates, max_nodes=6)

        assert len(graph.nodes) <= 6

    def test_never_leaves_a_link_pointing_at_a_node_it_did_not_send(self) -> None:
        # An edge into empty space is worse than a missing edge: the frontend
        # would draw a line to nowhere.
        candidates = [statement(f"s{i}", "P", f"o{i}") for i in range(20)]
        graph = graph_from_candidates(candidates, max_nodes=7)
        ids = {node.id for node in graph.nodes}

        for link in graph.links:
            assert link.source in ids
            assert link.target in ids

    def test_keeps_the_highest_ranked_evidence_when_it_cannot_keep_everything(self) -> None:
        # Candidates arrive best-first, so the cap should cut the tail.
        best = statement("first", "P", "best_obj")
        rest = [statement(f"s{i}", "P", f"o{i}") for i in range(20)]
        graph = graph_from_candidates([best, *rest], max_nodes=4)

        assert "first" in {node.id for node in graph.nodes}

    def test_an_empty_result_is_an_empty_graph_not_an_error(self) -> None:
        graph = graph_from_candidates([], max_nodes=10)
        assert graph.nodes == []
        assert graph.links == []
