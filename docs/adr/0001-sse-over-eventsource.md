# 1. Stream answers with SSE, read manually rather than with EventSource

Date: 2026-08-16

## Status

Accepted.

## Context

Answers arrive token by token and the graph is refined while retrieval runs, so
the client needs a push channel. Three options were realistic.

WebSockets are bidirectional and we need one direction. They add connection
state, a second protocol to authenticate, and no proxy or load balancer treats
them as well as plain HTTP.

Long polling reconnects per chunk and loses the ordering guarantees we get for
free from a single response body.

Server-Sent Events fit: one HTTP response, ordered frames, named event types,
and any proxy that handles HTTP handles them.

The complication is the browser's built-in `EventSource`. It only issues GET
requests, so a JSON body carrying the conversation, retrieval settings and
attachments cannot be sent. It also cannot set an `Authorization` header, which
rules out bearer tokens, and it cannot carry a bring-your-own provider key.

## Decision

Use SSE as the wire format, and read it with `fetch` plus `ReadableStream`
rather than `EventSource`. Frame parsing lives in `apps/web/src/api/sse.ts` as a
pure function over chunks, separate from the reading, so it is testable without
a network.

The service emits `status`, `graph`, `delta`, `done` and `error`, defined once
in `packages/shared` and mirrored by the Pydantic models in `apps/api`.

## Consequences

We own the parser, so we own its edge cases: a frame split across reads, a CRLF
split across reads, bare CR terminators, comment keepalives, and unknown fields
that must be ignored so the service can extend the protocol without breaking
older clients. All are covered by tests.

We also lose `EventSource`'s automatic reconnection. That is acceptable, because
resuming mid-answer would need the server to replay from an offset, which it
cannot do — a dropped stream means re-running the query. The `id:` field is
parsed anyway, so resumption stays open as a later option.

Cancellation is explicit: aborting the signal must raise rather than end the
loop quietly, or a stopped answer is indistinguishable from a finished one. That
distinction was a real bug, fixed in 2c7fa48 and now covered by a test.
