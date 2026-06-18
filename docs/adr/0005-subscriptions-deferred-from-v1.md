# Subscriptions deferred from v1

v1 ships queries and mutations only; GraphQL subscriptions are explicitly out of scope. The streaming Rpc machinery (`RpcSchema.Stream`) stays available, but the subscription transport (SSE / WebSocket), the `Stream` → `AsyncIterable` bridge, and stream-lifecycle/backpressure handling are not built for v1.

## Rationale

Matches the project's original mutations-first framing and keeps a real-time transport out of the first production cut. Queries + mutations cover the target use cases, and subscriptions can be added later (SSE-first) without reworking the core — the streaming Rpc declaration shape already exists.
