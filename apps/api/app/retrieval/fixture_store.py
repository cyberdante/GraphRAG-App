"""The fixture backend: the supply-chain graph, as retrieval candidates.

It exists for more than demos. Because it implements the same port as the real
stores, the whole pipeline — scoring, ranking, prompting, the graph frame — is
exercised end to end without AWS, and the service tests assert behaviour rather
than mocks.
"""

from .. import fixtures
from ..models import GraphEdge, GraphNode
from . import passes, scoring
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

        in_scope = [link for link in graph.links if self._in_scope(nodes, link, request)]
        keywords = passes.keywords_for(request)
        budgets = passes.plan(request.max_candidates)

        if not keywords:
            # Nothing to search on. Returning a prefix is honest here — there is
            # no question to be relevant to — and it keeps a bare request
            # working rather than answering it with silence.
            return [self._statement(nodes, link) for link in in_scope][: budgets.total]

        entity_hits = [
            link
            for link in in_scope
            if self._matches(keywords, nodes[link.source].label, nodes[link.target].label)
        ][: budgets.entity]

        vocabulary_hits = [
            link
            for link in in_scope
            if self._matches(
                keywords,
                nodes[link.source].type,
                nodes[link.target].type,
                link.type,
                link.label or "",
            )
        ][: budgets.vocabulary]

        # One hop out from whatever the direct passes anchored on.
        anchors = {link.source for link in entity_hits + vocabulary_hits}
        anchors |= {link.target for link in entity_hits + vocabulary_hits}
        expansion_hits = [
            link for link in in_scope if link.source in anchors or link.target in anchors
        ][: budgets.expansion]

        return passes.merge(
            [
                [self._scored(nodes, link, keywords) for link in entity_hits],
                [self._scored(nodes, link, keywords) for link in vocabulary_hits],
                [self._scored(nodes, link, keywords) for link in expansion_hits],
            ],
            budgets.total,
        )

    @staticmethod
    def _matches(keywords: list[str], *fields: str) -> bool:
        """Whether any search term appears in any of these fields.

        Substring rather than token equality, because the question is stemmed
        and the graph is not: "risk" has to reach `HAS_RISK`, and "supplier"
        has to reach `Supplier`.
        """
        haystack = " ".join(fields).lower()
        return any(keyword in haystack for keyword in keywords)

    def _scored(
        self,
        nodes: dict[str, GraphNode],
        link: GraphEdge,
        keywords: list[str],
    ) -> Candidate:
        """A candidate carrying how well it answered the question it was found by."""
        candidate = self._statement(nodes, link)
        candidate.relevancy = scoring.overlap_relevancy(keywords, candidate.searchable)
        return candidate

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
            confidence=fixtures.SAMPLE_CONFIDENCE,
            source=fixtures.SAMPLE_SOURCE,
        )
