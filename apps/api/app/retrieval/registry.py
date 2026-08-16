"""Which stores this deployment offers.

The registry is built from settings at startup, never from a request. That is
the whole security property: a client chooses among what the deployment has
already decided to expose, and cannot describe a new destination.

Backends that need an endpoint are registered only when that endpoint is
configured. A store that cannot work is absent rather than present-and-broken,
so `available()` is the honest answer to "what can I ask for?".
"""

import logging

from ..config import Settings
from .fixture_store import FixtureGraphStore
from .store import GraphStore, UnknownBackendError

logger = logging.getLogger(__name__)


class BackendRegistry:
    def __init__(self, stores: list[GraphStore], default: str) -> None:
        self._stores = {store.name: store for store in stores}
        self._default = default

    def available(self) -> list[GraphStore]:
        return list(self._stores.values())

    def names(self) -> list[str]:
        return list(self._stores)

    @property
    def default(self) -> str:
        return self._default

    def get(self, name: str | None) -> GraphStore:
        """Resolves a requested backend, or raises with what is on offer."""
        requested = name or self._default
        store = self._stores.get(requested)
        if store is None:
            raise UnknownBackendError(requested, self.names())
        return store


def build_registry(settings: Settings) -> BackendRegistry:
    stores: list[GraphStore] = [FixtureGraphStore()]

    # Neptune-backed stores land with their endpoints. Registering a store that
    # cannot reach anything would make `available()` a promise the service
    # cannot keep.
    if settings.neptune_endpoint:
        logger.info("Neptune endpoint configured, but no adapter is wired yet.")

    default = settings.default_backend
    names = [store.name for store in stores]
    if default not in names:
        logger.warning(
            "Configured default backend %r is unavailable; falling back to %r.",
            default,
            names[0],
        )
        default = names[0]

    return BackendRegistry(stores, default)
