"""What the graph actually contains, asked of the graph.

`ontology.py` declares the vocabulary this project defines: six classes, eight
properties. That is the right source for the JSON-LD export, because an export
should assert terms we control. It is the wrong source for retrieval, which has
to work against whatever a deployment points it at — a tenant's own graph will
not have heard of `RiskSignal`, and a service that assumes otherwise plans its
search around classes that are not there.

So the schema is introspected, per store, and cached. Three things it answers
that a hardcoded constant cannot:

- which classes exist, so the entity-type filter offers real options
- which predicates connect which classes, so a traversal can be planned rather
  than walked blindly (item 68)
- how common each is, so a schema card can lead with the shape of the graph
  instead of its rarest corner (item 67)

**Truncation is reported, never silent.** Introspection is capped, because on a
large store the distinct-triple query is not free. A cap that quietly drops the
rarest relationships would be the worst possible failure here: rare is where
the interesting questions live, and the loss would show up as a model that
never asks about a relationship rather than as an error.
"""

from dataclasses import dataclass, field

#: Distinct (class, predicate, class) shapes to read before giving up. A graph
#: with more distinct shapes than this is unusual; one that hits the cap says
#: so rather than pretending it did not.
MAX_SHAPES = 200


@dataclass(frozen=True)
class SchemaEdge:
    """One shape the data actually takes: subject class, predicate, object class."""

    domain: str
    predicate: str
    range: str
    #: How many statements share this shape. Ordering by it puts the graph's
    #: backbone first and its long tail last.
    count: int = 0

    def render(self) -> str:
        return f"{self.domain} -{self.predicate}-> {self.range}"


@dataclass(frozen=True)
class GraphSchema:
    """The T-Box, as the store reports it."""

    edges: list[SchemaEdge] = field(default_factory=list)
    #: True when introspection hit its cap, so callers know the picture is
    #: partial. Never inferred silently.
    truncated: bool = False

    @property
    def classes(self) -> list[str]:
        """Every class that appears at either end of a statement."""
        seen: dict[str, None] = {}
        for edge in self.edges:
            seen.setdefault(edge.domain, None)
            seen.setdefault(edge.range, None)
        return sorted(seen)

    @property
    def predicates(self) -> list[str]:
        return sorted({edge.predicate for edge in self.edges})

    def edges_from(self, cls: str) -> list[SchemaEdge]:
        """Where you can go from here, commonest first."""
        return [edge for edge in self.edges if edge.domain == cls]

    def edges_touching(self, classes: set[str]) -> list[SchemaEdge]:
        return [edge for edge in self.edges if edge.domain in classes or edge.range in classes]

    def neighbours(self, cls: str) -> set[str]:
        """Classes reachable from this one in a single hop, either direction."""
        found: set[str] = set()
        for edge in self.edges:
            if edge.domain == cls:
                found.add(edge.range)
            elif edge.range == cls:
                found.add(edge.domain)
        return found

    def is_empty(self) -> bool:
        return not self.edges


def render_schema_card(schema: GraphSchema, limit: int = 40) -> str:
    """A compact description of the graph, for the model's context (item 67).

    This is the item that turns a vocabulary from paperwork into retrieval
    quality: told what the graph can express, a model stops guessing at
    relationships and starts asking for ones that are there.

    Ordered by frequency so a truncated card keeps the backbone, and the
    truncation is stated — a silently shortened schema teaches the model that
    the missing relationships do not exist.
    """
    if schema.is_empty():
        return ""

    shown = schema.edges[:limit]
    lines = [edge.render() for edge in shown]

    omitted = len(schema.edges) - len(shown)
    if omitted > 0 or schema.truncated:
        lines.append(
            f"... and {omitted} further relationship types not listed here."
            if omitted > 0
            else "... this graph has more relationship types than were read."
        )

    return "The graph contains these classes and relationships:\n" + "\n".join(lines)
