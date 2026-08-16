"""Projecting the graph the user sees from the evidence the answer used.

This is the integration seam. A retrieval candidate of kind `statement`
already carries subject, predicate and object — it *is* a triple — so the
visualization does not need its own query. Drawing the top-ranked candidates
means the picture is, by construction, exactly what the answer was grounded in.

Two things fall out of that rather than being built:

- Citations and the drawing refer to the same nodes, so highlighting the
  subgraph behind a source becomes a lookup instead of a feature.
- The graph cannot drift from the answer, because there is nothing to drift
  from — one is derived from the other.
"""

from ..models import GraphData, GraphEdge, GraphNode
from .models import Candidate

#: Assigned per entity type so the frontend can group without knowing the
#: domain. Colour itself belongs to the tenant, not to the data.
_GROUPS: dict[str, int] = {}


def _group_for(entity_type: str) -> int:
    return _GROUPS.setdefault(entity_type, len(_GROUPS) + 1)


def grounded_in(graph: GraphData, candidates: list[Candidate]) -> list[Candidate]:
    """The candidates the frame actually represents.

    The frame is capped; the candidate list is not. Without this filter the
    answer can cite evidence the picture does not contain — clicking a source
    then highlights nothing, and the claim that the drawing *is* the evidence
    stops being true. Narrowing the prompt and the citations to what was drawn
    makes the invariant structural rather than aspirational.
    """
    ids = {node.id for node in graph.nodes}
    return [
        candidate
        for candidate in candidates
        if candidate.kind != "statement" or (candidate.subject in ids and candidate.object in ids)
    ]


def graph_from_candidates(candidates: list[Candidate], *, max_nodes: int) -> GraphData:
    """Builds a graph frame from ranked candidates, best first.

    Nodes are added in rank order and the cap is applied to nodes rather than
    to candidates, so the frame contains the highest-ranked evidence that fits
    whole. An edge is kept only when both its endpoints made the cut — a link
    into empty space is worse than a missing link.
    """
    nodes: dict[str, GraphNode] = {}
    links: list[GraphEdge] = []

    def add_node(node_id: str, label: str | None, entity_type: str | None) -> bool:
        if node_id in nodes:
            return True
        if len(nodes) >= max_nodes:
            return False
        resolved_type = entity_type or "Entity"
        nodes[node_id] = GraphNode(
            id=node_id,
            label=label or node_id,
            type=resolved_type,
            group=_group_for(resolved_type),
        )
        return True

    for candidate in candidates:
        if candidate.kind != "statement":
            continue
        if not (candidate.subject and candidate.object and candidate.predicate):
            continue

        # Both endpoints or neither: adding a subject whose object did not fit
        # would leave a node with no relationship, which reads as noise.
        if len(nodes) + 2 > max_nodes and not (
            candidate.subject in nodes and candidate.object in nodes
        ):
            continue

        if not add_node(candidate.subject, candidate.subject_label, candidate.subject_type):
            continue
        if not add_node(candidate.object, candidate.object_label, candidate.object_type):
            continue

        links.append(
            GraphEdge(
                source=candidate.subject,
                target=candidate.object,
                type=candidate.predicate,
                label=_humanize(candidate.predicate),
            )
        )

    return GraphData(nodes=list(nodes.values()), links=_dedupe_links(links))


def _dedupe_links(links: list[GraphEdge]) -> list[GraphEdge]:
    seen: set[tuple[str, str, str]] = set()
    unique: list[GraphEdge] = []
    for link in links:
        key = (link.source, link.type, link.target)
        if key in seen:
            continue
        seen.add(key)
        unique.append(link)
    return unique


def _humanize(predicate: str) -> str:
    """HAS_RISK to "has risk", for an edge label a reader can parse."""
    return predicate.replace("_", " ").lower()
