# Ragstone

[![CI](https://github.com/cyberdante/Ragstone/actions/workflows/ci.yml/badge.svg)](https://github.com/cyberdante/Ragstone/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A white-label GraphRAG console. You ask a question in natural language; the
service retrieves a subgraph from Neptune, answers with Bedrock, and the app
streams the answer and draws the graph it came from side by side.

The product carries no name of its own where a user can see it — every visible
name, colour, shape and phrase belongs to a tenant. "Ragstone" is what the repo
is called, not what the client sees.

Design decisions are recorded in [docs/adr](docs/adr/).

## Layout

```
ragstone/
├─ apps/
│  ├─ web/            React 18 · MUI 7 · Vite 6 · D3 7
│  └─ api/            FastAPI · Python 3.11+
├─ packages/
│  ├─ shared/         The wire contract both sides build against
│  └─ config/         Shared strict tsconfig base
└─ pnpm-workspace.yaml
```

`packages/shared/src/index.ts` is the single definition of a message, a graph
and a stream event. `apps/api/app/models.py` mirrors it field for field. When
one changes, change the other.

## Getting started

Two ways in. Docker needs nothing installed but Docker; the local setup is the
one to use if you are going to change the code.

### With Docker

Brings up the whole stack — web app, service and graph store — and loads the
sample graph on the way:

```bash
docker compose up --build
```

Then open **http://localhost:8080**.

That is the entire setup. No Node, no Python, no pnpm, no keys.

| Container | What it is | Where |
| --- | --- | --- |
| `ragstone-web` | The built app, served by nginx | http://localhost:8080 |
| `ragstone-api` | The FastAPI service | on the compose network |
| `ragstone-neo4j` | Neo4j, holding the sample graph | bolt://localhost:7687 |
| `ragstone-seed` | Loads the sample graph, then exits | — |

nginx puts the API on the same origin as the app under `/api`, which is what
the Vite dev server does too — so the client code is identical either way, with
no CORS and no API URL compiled into the bundle. The service is deliberately
not published on a port of its own; uncomment the `ports` block under `api` in
[compose.yaml](compose.yaml) to reach it directly and read the interactive docs
at `/docs`.

**Answering with a model.** With no key the service answers from the fixture
generator, so the stack works end to end out of the box. To answer with a real
model, put a key in a `.env` file beside `compose.yaml`:

```bash
# .env — gitignored
ANTHROPIC_API_KEY=sk-ant-...
# or
RAGSTONE_LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

Then `docker compose up -d --force-recreate api`. Keys are read from the
environment at run time and never copied into an image — `.env` files are
excluded by [.dockerignore](.dockerignore).

**If a port is already taken.** 8080 is the most contended port on any machine
that runs containers, so every published port can be overridden:

```bash
RAGSTONE_WEB_PORT=8081 docker compose up
```

`RAGSTONE_BOLT_PORT` and `RAGSTONE_NEO4J_HTTP_PORT` do the same for Neo4j.

**Looking at the graph.** Neo4j Browser is at http://localhost:7474 —
`neo4j` / `ragstone-dev`. `MATCH (n)-[r]->(m) RETURN n,r,m` shows everything
the adapter is matching against. Those credentials guard a container of sample
supply-chain data on a loopback port; a deployment supplies its own.

**Stopping.**

```bash
docker compose down          # stop, keep the graph
docker compose down -v       # stop and discard the graph too
```

Re-running `docker compose up` re-seeds, and the seeder is idempotent, so a
discarded graph costs nothing but the time to load 15 nodes.

### Locally, for development

```bash
pnpm install          # JavaScript dependencies for the whole workspace
pnpm api:setup        # one-time: builds the Python environment
pnpm dev              # starts both apps
```

- Web: http://localhost:5173
- API: http://localhost:8000 — interactive docs at http://localhost:8000/docs

Vite proxies `/api` to the service, so there is no CORS to think about in
development.

To run the frontend alone with no Python at all, copy `apps/web/.env.example`
to `apps/web/.env.local` and set `VITE_USE_MOCK=true`.

**Against a real graph.** The service answers from the bundled fixture graph
with nothing configured, so this is optional. To develop against the store
instead, run just the database and leave the apps on the host:

```bash
docker compose up -d neo4j                # openCypher over Bolt, on 7687
pnpm --filter @ragstone/api seed          # idempotent
```

The sample graph is fifteen nodes, which is too small to tell a working ranking
from a broken one. To seed volume alongside it:

```bash
cd apps/api
python scripts/seed_neo4j.py --scale 500   # ~3.4k nodes, ~5.9k relationships
python scripts/seed_neo4j.py --clear       # drop generated data, keep the sample
```

Generated statements carry their own confidence and extraction date, so the
recency and confidence weights have something to discriminate on — with the
sample alone they are renormalised away. Same scale and seed, same graph.

Then copy `apps/api/.env.example` to `.env.local`, uncomment the `NEO4J_*`
block, and install the driver with `pip install -e ".[graph]"` inside
`apps/api`. The backend appears in the picker once it is configured; a store
that cannot answer is never offered.

### Graph backends

| Language | Status | Reached over |
| --- | --- | --- |
| openCypher | Working — Neo4j locally, Neptune when deployed | Bolt |
| SPARQL | Planned | HTTP |
| Gremlin | Planned | WebSocket |

One `GraphStore` port, one adapter each. `tests/test_store_conformance.py` runs
the same properties against every backend the machine can reach, including that
they describe the same graph identically — so which store answers cannot
quietly change the answer.

### Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Both apps, in parallel |
| `pnpm dev:web` / `pnpm dev:api` | One app on its own |
| `pnpm build` | Typecheck, then build the web app to `apps/web/dist` |
| `pnpm typecheck` | Typecheck every workspace package |
| `pnpm test` | Both test suites |
| `pnpm test:web` / `pnpm test:api` | One suite on its own |
| `pnpm lint` | Ruff check and format check on the service |
| `pnpm api:setup` | Create or repair the Python environment |
| `pnpm --filter @ragstone/api seed` | Load the sample graph into the local store |

## White-labelling

Every visible name, colour, shape and phrase belongs to a tenant. Nothing about
a client is compiled in: the document is fetched at boot from `/tenants/{id}.json`,
so onboarding a client is a file, not a release.

```
?tenant=meridian          →  the URL wins, so a demo can be linked at a brand
VITE_TENANT=meridian      →  otherwise the deployment's default
                          →  otherwise the bundled fallback
```

In development, a brand switcher appears in the navbar: choosing a brand
re-themes the running app — palette, corner radius, spacing, type, graph
colours and wording — without a reload, and keeps the conversation on screen.
It is off outside development unless `VITE_TENANT_SWITCHER=true`, because a
client's deployment must never list other people's brands.

You can also link straight at one with `?tenant=meridian` or `?tenant=lumen`. The three
bundled tenants differ in corner radius, spacing base, type family, node
colours and wording, because a white-label claim tested against near-identical
themes proves nothing.

A tenant declares how components are *built*, not only what colour they are:
surfaces elevated, outlined or flat; buttons contained, outlined or text;
inputs outlined, filled or underlined; plus chip style, control size and
whether the ripple runs. The vocabulary is closed on purpose — enumerated
choices can be validated and tested, and they do not weld the contract to one
component library's internals. Arbitrary tenant CSS is a separate, larger
decision, not an extension of this one.

A fetched document is not trusted. Every field falls back independently and
what was repaired is reported, so one mistyped hex value cannot stop the app
rendering — and a palette that cannot carry readable text is reported rather
than silently altered, since changing a client's brand colour is worse than
telling them it fails. `scripts/emit-tenants.mjs` regenerates the served
documents from the bundled ones so the two cannot drift.

## Tests

Vitest with jsdom on the web side, pytest on the service. CI runs typecheck,
both suites, the build, and Ruff on every push.

The two suites are deliberately narrow. The SSE parser is a pure function over
chunks, so it is tested exhaustively — frames split across reads, a CRLF split
across reads, bare CR terminators, keepalive comments, unknown fields. The
service tests assert the *shape and order* of the event sequence rather than the
wording of the answer, so they will keep passing when Bedrock and Neptune
replace the fixtures.

## Python, for someone who has not used it

Everything here has a JavaScript counterpart you already know.

| Python | The equivalent you know |
| --- | --- |
| `pyproject.toml` | `package.json` |
| `pip` | `npm` / `pnpm` |
| `.venv/` | `node_modules/`, but it also contains its own copy of Python |
| `uvicorn` | `vite` — the process that serves the app in development |
| `ruff` | `eslint` |
| `pytest` | `vitest` |

**Virtual environments.** Python has no `node_modules`. By default `pip`
installs packages system-wide, where two projects wanting different versions of
the same library collide. A *virtual environment* fixes that: it is a folder —
here, `apps/api/.venv` — holding a private Python and this project's packages.
`pnpm api:setup` creates it. It is gitignored, and deleting it costs nothing;
rerun setup to get it back.

You do not need to "activate" anything. Every script in `apps/api/package.json`
calls `./.venv/bin/...` directly, so `pnpm dev` works from a plain shell.

**Which Python.** The service needs 3.11 or newer. macOS ships 3.9, which is
past end of life, so `scripts/setup.sh` searches for a newer one — including
Homebrew and Anaconda installs that are not on your `PATH` — and tells you which
it picked. If it finds nothing:

```bash
brew install python@3.12
pnpm api:setup
```

To force a specific interpreter: `PYTHON=/path/to/python pnpm api:setup`.

**Adding a dependency.** Add it to the `dependencies` list in
`apps/api/pyproject.toml`, then rerun `pnpm api:setup`. There is no
`pip install --save`; the file is the source of truth.

**Reading the code.** Three things account for most of what looks unfamiliar:

- Indentation defines blocks. There are no braces, and the indentation is not
  cosmetic.
- `async def` and `await` mean what they mean in JavaScript. `yield` inside an
  `async def` makes an async generator — the same `for await` you use in
  `client.ts`, from the other side.
- Type hints (`def answer_for(query: str) -> tuple[str, list[Citation]]`) are
  optional annotations. Pydantic uses them at runtime to validate and parse
  incoming JSON, which is why `models.py` is mostly type declarations.

**When something breaks.** `ModuleNotFoundError` almost always means the
environment is stale — rerun `pnpm api:setup`. A `422` from the API is Pydantic
rejecting a request body that does not match the model, and the response says
which field.

## How a query flows

The service answers over Server-Sent Events. Five frame types, always in this
order:

| Event | Carries |
| --- | --- |
| `status` | Which retrieval phase is running, for the progress line |
| `graph` | A subgraph to draw — sent more than once, refined as it goes |
| `delta` | The next piece of the answer. Increments, not the running total |
| `done` | Token usage and citations |
| `error` | A failure; the stream ends here |

`apps/web/src/api/client.ts` picks the transport. `HttpStreamingAPI` talks to
the service; `MockStreamingAPI` replays fixtures in the browser. Both implement
`GraphRagClient` and emit identical events, so nothing downstream can tell them
apart.

`EventSource` is not used: it only issues GET requests and cannot carry a JSON
body or an auth header, so `sse.ts` reads the response stream and parses frames
directly.

## Answering with a model

Retrieval and generation are both ports with a fixture adapter, so the whole
pipeline runs with nothing configured — no keys, no AWS, no network. That is
deliberate: the demo works in five seconds and costs nothing.

Give it a key and a model answers instead:

```bash
cd apps/api && ./.venv/bin/pip install -e ".[llm]"
export ANTHROPIC_API_KEY=sk-ant-...     # or OPENAI_API_KEY
```

Provider and model come from `RAGSTONE_LLM_PROVIDER` and `RAGSTONE_LLM_MODEL`;
keys are read from each provider's own variable, so an existing shell
environment works untouched. `GET /health` reports which generator is live.

Answers are grounded: the model receives the ranked evidence as numbered facts
and is asked to cite them inline, and the citations returned are the ones it
actually used. The graph frame is built first and the evidence narrowed to what
it holds, so **the prompt, the citations and the drawing all describe the same
set** — a cited source always points at a node on screen.

`temperature` is not sent unless a deployment asks for it: the Claude 5 family
rejects it with a 400, so a default would break the recommended model rather
than tune it.

## What is real and what is not

Retrieval answers from the fixture graph in `apps/api/app/fixtures.py` by
default, and from a real store over openCypher when one is configured. Both
implement the same `GraphStore` port, and `tests/test_store_conformance.py`
runs the same properties against each — including that they describe the same
graph identically, so the backend cannot quietly change the answer. CI runs
that suite against a real Neo4j service container.

The SPARQL adapter is next and reuses the vocabulary in `app/ontology.py`;
Gremlin is planned after it. Both land as one more implementation of the same
port, and the conformance suite is already written to hold them to it.

Roadmap: https://claude.ai/code/artifact/ca1d6947-831f-492e-9d1f-f7903d4b3f07

## Features

- Natural language query with file, URL and entity-ID attachments
- Streaming answers rendered as markdown, with citations and token usage
- Stop mid-answer; partial output is kept
- Interactive D3 force-directed knowledge graph — zoom, pan, drag, labels,
  node inspector, light and dark
- Conversation history in localStorage, with export to PDF, CSV and JSON-LD
