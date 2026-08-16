# Architecture decision records

Short notes on decisions that were not obvious, written when the decision was
made rather than reconstructed afterwards. Each one records what the situation
was, what was chosen, and what that choice costs.

| # | Decision |
| --- | --- |
| [0001](0001-sse-over-eventsource.md) | Stream answers with SSE, read manually rather than with `EventSource` |
| [0002](0002-python-service-in-a-javascript-monorepo.md) | Keep a Python service inside the JavaScript monorepo |
| [0003](0003-keep-mui-for-white-labelling.md) | Keep MUI; the white-label ceiling is our own code |
| [0004](0004-containerised-graph-stores-for-development.md) | Develop against containerised graph stores, not a managed cluster |
