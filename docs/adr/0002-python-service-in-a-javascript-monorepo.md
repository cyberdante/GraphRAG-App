# 2. Keep a Python service inside the JavaScript monorepo

Date: 2026-08-16

## Status

Accepted.

## Context

The project began as a Figma Make export: a React frontend with a mock API in
the browser and no backend at all. Two constraints made a server unavoidable
rather than optional.

Neptune is reachable only from inside a VPC, so a browser cannot query it under
any configuration. Bedrock requires SigV4-signed requests, and the credentials
that sign them cannot be shipped to a client.

Given that a server was required, the question was which runtime. An
all-TypeScript backend — Next.js route handlers, or Hono — would share types
with the frontend directly and need one toolchain. Against that, the GraphRAG
ecosystem is Python-first: `boto3`, `gremlinpython`, the SPARQL clients, spaCy,
and the retrieval pipeline this project is building out.

A third option, a TypeScript backend-for-frontend in front of a Python worker,
was rejected as three moving parts to solve a problem we do not have yet.

## Decision

One pnpm workspace containing `apps/web` (Vite, React) and `apps/api` (FastAPI),
with `packages/shared` holding the wire contract and `packages/config` the
shared TypeScript configuration.

`apps/api` carries a `package.json` whose scripts call into its own virtual
environment. That is the seam that lets `pnpm dev` start both applications with
one command, and lets CI treat them uniformly.

## Consequences

Two toolchains, two lockfiles, two test runners. Accepted deliberately: the cost
is setup, which is paid once and scripted, while the benefit is access to the
libraries the actual problem needs.

The contract is defined twice — TypeScript in `packages/shared`, Pydantic in
`apps/api/app/models.py` — and the two can drift. They are cross-referenced in
comments, and generating the TypeScript from the service's OpenAPI schema is the
intended fix once the shape settles.

Contributors need a Python 3.11+ interpreter. `scripts/setup.sh` finds one,
including Homebrew and Anaconda installs that are not on `PATH`, and `pnpm dev`
builds the environment if it is missing, so the failure mode is a clear message
rather than a confusing path error.
