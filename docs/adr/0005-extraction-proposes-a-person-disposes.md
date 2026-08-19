# 5. Extraction proposes; a person disposes

Date: 2026-08-19

## Status

Accepted.

## Context

Every node in this graph comes from a generator or a fixture. Making it
self-sustaining means reading documents and turning them into statements, which
is the point at which a knowledge graph stops being a demo — and the point at
which it acquires a failure mode the rest of the pipeline does not have.

Retrieval and generation are recoverable. A bad ranking gives a worse answer to
one question, and the next question starts fresh. A wrong statement written into
the graph is different in kind: it persists, it is retrieved as evidence, and
every answer built on it inherits the error *while citing a source*. A confident
wrong answer with a citation is worse than no answer, because it survives review
by the person reading it.

Language models assert things documents do not say. So do pattern matchers —
"ITAMCO no longer supplies Component A" contains "supplies" and reads, to
anything matching surface forms, as an assertion that it does. The question is
not whether extraction will be wrong but what happens when it is.

Three arrangements were realistic.

**Write directly, correct later.** Extraction commits, and errors are fixed when
somebody notices. This is how most ingestion demos work and it is why most of
them cannot be pointed at real documents. Nobody notices: the error is only
visible as a slightly wrong answer weeks later, by which time nothing connects
the answer to the sentence that caused it.

**Write with a confidence threshold.** Commit above some score, queue the rest.
Attractive until you ask what the score means. Our reference extractor genuinely
cannot tell a clean sentence from a mangled one, and a model's self-reported
confidence is not calibrated against anything. A threshold over a number that
is not measuring anything is a filter that feels principled and is not.

**Propose, and require a person.** Nothing reaches the graph without a decision.
The cost is real: it does not scale to a million documents, and it makes
ingestion an interactive feature rather than a batch job.

A separate constraint shaped this too, and it is worth recording because it is
invisible in the code. A sophisticated extractor may not be published with this
repository. The design therefore has to survive its best implementation living
somewhere else.

## Decision

Extraction produces **proposals**, never statements. `Extractor` is a port in
`app/extraction/extractor.py`, the same shape as `GraphStore` and
`AnswerGenerator`: a deployment names one, a request never does, and the review
loop, the API and the tests are written against the protocol rather than any
implementation.

The contract forbids writing. An extractor that could commit would make the
reviewer optional by accident — the first time somebody wanted a batch import,
the affordance would be there.

A `ReferenceExtractor` ships, matching sentences against the readable forms of
the relationships the domain vocabulary declares. It is deliberately plain, and
it cannot propose a term the graph has no word for. It is enough to make the
loop runnable with nothing configured — no key, no model, no network — in the
same way the fixture store and fixture generator are, and nowhere near enough
for real documents. Naming an extractor that is not installed fails loudly
rather than falling back to it, because a deployment believing its documents
were read by a model and getting a regular expression would trust the output far
more than it deserves.

Two things travel with every proposal:

**The quote it came from.** A reviewer asked to accept
`ITAMCO --SUPPLIES--> Component A` with no source is being asked to trust the
extractor, which is the thing under review.

**Labels, not identifiers.** A document says "ITAMCO", not `sup_88`. Resolving
that to a node — or deciding it is a new one — is a separate step, kept separate
so the moment where a document's "Acme Ltd" becomes an existing "ACME Limited"
is visible rather than buried inside extraction.

Proposal ids are derived from their content and source, so re-reading a document
collides with decisions already made instead of reopening them.

## Consequences

Ingestion is interactive and does not scale to bulk import. That is the cost,
and it is the right one at this stage: a graph nobody has checked is not an
asset. If bulk import is ever needed, it should arrive as an explicit
"accept everything from this extractor" decision that a person makes once and
that is recorded, rather than as a threshold that quietly does the same thing.

The review queue is in memory and per process, with the same limitation the
attachment store states: several workers means a proposal made on one is
invisible on another. A deployment that meant it would put these in a database.

Accepting a proposal does not yet write to the graph. Commit is a separate step
with its own failure modes — chiefly entity resolution — and an endpoint named
"accept" that silently wrote would make the review a formality. The API says so
rather than implying otherwise.

The reference extractor's weaknesses are documented in its own module and held
by tests, including the negation case that produces a confidently wrong
proposal. Recording a known failure as a test is the difference between a
limitation and a bug waiting to be discovered by a user.

Because the port is the public contract and the adapter is replaceable, a better
extractor can live in a private package without this repository having a hole in
it. What is published is the design and a working reference; what is withheld is
an implementation detail, which is the honest division rather than a missing
module.
