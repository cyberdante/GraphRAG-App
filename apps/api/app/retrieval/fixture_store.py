"""The fixture backend: the supply-chain graph, as retrieval candidates.

It exists for more than demos. Because it implements the same port as the real
stores, the whole pipeline — scoring, ranking, prompting, the graph frame — is
exercised end to end without AWS, and the service tests assert behaviour rather
than mocks.
"""

from .. import fixtures
from ..models import GraphEdge, GraphNode
from .models import Candidate, RetrievalRequest


def _label(nodes: dict[str, GraphNode], node_id: str) -> str:
    node = nodes.get(node_id)
    return node.label if node else node_id


class FixtureGraphStore:
    """Serves candidates from the bundled supply-chain graph."""

    name = "fixtures"
    description = "Bundled supply-chain sample. No external services."

    async def retrieve(self, request: RetrievalRequest) -> list[Candidate]:
        graph = fixtures.SUPPLY_CHAIN_GRAPH
        nodes = {node.id: node for node in graph.nodes}

        candidates = [
            self._statement(nodes, link)
            for link in graph.links
            if self._in_scope(nodes, link, request)
        ]

        # A store returns what it found, up to its search budget. Ranking and
        # the frame cap belong to the pipeline, which can weigh candidates from
        # several passes together.
        return candidates[: max(request.max_candidates, 1)]

    def _in_scope(
        self,
        nodes: dict[str, GraphNode],
        link: GraphEdge,
        request: RetrievalRequest,
    ) -> bool:
        if not request.entity_types:
            return True
        endpoints = {nodes[link.source].type, nodes[link.target].type}
        return bool(endpoints & set(request.entity_types))

    def _statement(self, nodes: dict[str, GraphNode], link: GraphEdge) -> Candidate:
        subject = _label(nodes, link.source)
        target = _label(nodes, link.target)
        relation = link.label or link.type

        return Candidate(
            kind="statement",
            text=f"{subject} {relation} {target}",
            subject=link.source,
            predicate=link.type,
            object=link.target,
            subject_type=nodes[link.source].type if link.source in nodes else None,
            object_type=nodes[link.target].type if link.target in nodes else None,
            subject_label=subject,
            object_label=target,
            confidence=0.9,
            source="Supply chain graph",
        )
