# GraphRAG

[![CI](https://github.com/cyberdante/GraphRAG-App/actions/workflows/ci.yml/badge.svg)](https://github.com/cyberdante/GraphRAG-App/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A white-label GraphRAG console. You ask a question in natural language; the
service retrieves a subgraph from Neptune, answers with Bedrock, and the app
streams the answer and draws the graph it came from side by side.

Design decisions are recorded in [docs/adr](docs/adr/).

## Layout

```
graphrag/
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

## What is real and what is not

The service currently answers from fixtures in `apps/api/app/fixtures.py` — the
supply-chain graph, three canned answers, and citations. Bedrock and Neptune
land in Sprint 2. Only `stream_answer` changes when they do; the frames stay
identical, so the frontend needs no work.

Roadmap: https://claude.ai/code/artifact/ca1d6947-831f-492e-9d1f-f7903d4b3f07

## Features

- Natural language query with file, URL and entity-ID attachments
- Streaming answers rendered as markdown, with citations and token usage
- Stop mid-answer; partial output is kept
- Interactive D3 force-directed knowledge graph — zoom, pan, drag, labels,
  node inspector, light and dark
- Conversation history in localStorage, with export to PDF, CSV and JSON-LD
