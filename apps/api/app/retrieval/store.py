"""The port every graph backend implements.

One protocol, several adapters: fixtures today, Neptune over SPARQL and
openCypher next. Everything downstream — scoring, the prompt, the graph frame —
is written against this and never against a particular store.

Security note, and the reason a store is never constructed from request data:
the deployment declares which stores exist and how to reach them. A request may
name one of them and nothing else. Accepting an endpoint from a client would
turn this service into an SSRF vector aimed at whatever the VPC can see.
"""

from typing import Protocol, runtime_checkable

from .models import Candidate, RetrievalRequest
from .schema import GraphSchema


@runtime_checkable
class GraphStore(Protocol):
    """A source of evidence for a question."""

    #: Stable identifier a request may name.
    name: str

    #: Human-readable, for the backend listing the UI offers.
    description: str

    async def retrieve(self, request: RetrievalRequest) -> list[Candidate]:
        """Return candidate evidence for the question, unranked."""
        ...

    async def schema(self) -> GraphSchema:
        """Describe the shapes the data actually takes.

        Introspected rather than declared: `ontology.py` states the vocabulary
        this project defines, which is right for an export and wrong for
        retrieval. A store points at whatever a deployment gave it, and a
        service that assumes our six classes will plan its search around
        classes that are not there.
        """
        ...


class UnknownBackendError(ValueError):
    """A request named a backend this deployment does not offer."""

    def __init__(self, requested: str, available: list[str]) -> None:
        self.requested = requested
        self.available = available
        super().__init__(
            f"Unknown retrieval backend {requested!r}. "
            f"This deployment offers: {', '.join(available) or 'none'}."
        )
