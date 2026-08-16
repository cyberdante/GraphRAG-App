# 0004 — Develop against containerised graph stores

## Situation

The service reads evidence through a `GraphStore` port, and the plan is to
offer two query languages: openCypher and SPARQL. Until now only the fixture
store implemented the port, which meant the interesting claim — that the
backend is switchable and nothing downstream cares — was argued rather than
demonstrated. A port with one implementation is a guess about what the second
one will need.

The obvious way to get a second implementation is to point at a managed
Neptune cluster. That has real costs beyond the invoice: it is VPC-only, so
reaching it from a development machine needs a bastion or a tunnel; it cannot
be started from a cold checkout; and it makes the integration tests
unrunnable for anyone without credentials, which in practice means they stop
being run.

## Decision

Develop and test against graph stores running in containers, defined in
`compose.yaml`:

- **openCypher** — Neo4j, over Bolt
- **SPARQL** — to follow

A managed cluster is a deployment target these adapters address, not a
prerequisite for working on them. Neptune speaks Bolt and openCypher, so the
adapter that runs against the local store is the same adapter, reached by
changing a URI.

Two things make this more than convenience:

**One seed, one description of the graph.** The seeder loads the same sample
graph the fixture store serves, and both take the graph's provenance from the
same constants. Without that, the stores disagreed about `confidence` — the
fixture store attributed 0.9, the seeded store recorded nothing — and because
the ranking weights renormalise over whichever signals a candidate carries,
the same question ranked differently depending on which backend answered. That
is invisible in the UI and would not have been caught by testing either store
on its own.

**A conformance suite, not a per-store suite.** `test_store_conformance.py` is
written against the port and parametrised over every store the machine can
reach, with a final test asserting that both describe the same graph
identically. It skips the openCypher store when no endpoint is listening, so
`pytest` stays useful without Docker, and CI sets `RAGSTONE_REQUIRE_CYPHER=1`
to turn that skip into a failure — otherwise a container that failed to start
would skip its way to a green tick in the one job that exists to exercise the
real backend.

## Costs

Docker becomes a dependency for the full suite. It is not a dependency for the
default one: `pytest` and `pnpm dev` work on a clean checkout with nothing
running, because the fixture store needs no infrastructure.

Neo4j and Neptune agree on openCypher but are not identical — Neptune has its
own limits on the language, and the adapter can drift into working against one
and not the other. Keeping the query in the adapter simple, and keeping the
conformance suite as the definition of what a store must do, is what bounds
that. The suite is the thing to run against a real cluster when there is one;
it is written so that it can be.

The local credentials in `compose.yaml` are checked in. They guard sample
supply-chain data on a loopback port, and a deployment supplies its own.
