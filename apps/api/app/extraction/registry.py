"""Choosing which extractor reads a document.

Same shape as the store and generator registries, and here for a specific
reason: extraction is the step most likely to be replaced. The reference
extractor is a pattern match, which is enough to make the loop runnable with
nothing configured and nowhere near enough for real documents — so the seam
where a better one goes is part of the design rather than something to be carved
out later.

A deployment names an extractor; a request never does. Same rule as the stores,
and for the same reason: what reads your documents is a deployment decision.
"""

import logging

from ..config import Settings
from ..domains import Domain
from .extractor import Extractor
from .reference import ReferenceExtractor

logger = logging.getLogger(__name__)


class UnknownExtractorError(ValueError):
    """A deployment named an extractor that is not installed."""

    def __init__(self, requested: str, available: list[str]) -> None:
        super().__init__(
            f"Unknown extractor {requested!r}. Installed: {', '.join(available) or 'none'}."
        )


def build(settings: Settings, domain: Domain) -> Extractor:
    """The configured extractor, or the reference one.

    Additional extractors register themselves here. Keeping the mapping
    explicit rather than scanning for plugins means an installed-but-unwanted
    package cannot become the thing that reads your documents.
    """
    available: dict[str, Extractor] = {
        ReferenceExtractor.name: ReferenceExtractor(domain),
    }

    requested = settings.extractor
    if not requested:
        return available[ReferenceExtractor.name]

    if requested not in available:
        # Loud, and then the default. A deployment that asked for a better
        # extractor and silently got the pattern matcher would believe its
        # documents had been read properly.
        raise UnknownExtractorError(requested, sorted(available))

    return available[requested]
