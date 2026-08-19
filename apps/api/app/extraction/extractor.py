"""The port every extractor implements.

Same shape as `GraphStore` and `AnswerGenerator`, for the same reason: the
review loop, the API and the tests are written against this and never against a
particular extractor. A deployment can put a model behind it, a rules engine, or
somebody else's service, and nothing downstream changes.

What an extractor may and may not do is part of the contract:

- It returns proposals. It never writes to a store. The write path is a separate
  step behind a person, and an extractor that could commit would make that
  person optional by accident.
- It reports what it skipped. An extraction that finds two statements in a long
  document has either found very little or gone very wrong, and a bare list
  cannot tell a reader which.
- It names itself, because "a model said so" and "a regular expression said so"
  deserve different scepticism and the reviewer is entitled to know which they
  are reading.
"""

from typing import Protocol, runtime_checkable

from .models import Extraction


@runtime_checkable
class Extractor(Protocol):
    """Proposes statements a document appears to assert."""

    #: Stable identifier a deployment names in configuration.
    name: str

    #: Human-readable, and honest about the method — a reviewer reads this.
    description: str

    async def extract(self, text: str, source: str) -> Extraction:
        """Read a document and propose statements, without asserting any."""
        ...
