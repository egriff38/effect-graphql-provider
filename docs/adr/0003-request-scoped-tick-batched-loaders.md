# Request-scoped tick-batched loaders for N+1

We provide a DataLoader-style `createLoader(batchFn)`: calls enqueue keys and flush once per microtask/tick, dispatching `batchFn` once per batch. Loaders are request-scoped — provided via `Layer.scoped` in the request context layer (ADR 0001) — so their queue and cache cannot leak across requests. A loader may use `RequestResolver` underneath for the fetch and dedupe.

## Rationale

We own execution via graphql-js `graphql()`, which invokes sibling field resolvers as independent Promises / separate `runPromise`s. Effect's `RequestResolver` batches only requests collected within a single fiber's structured concurrency, so it never sees sibling resolvers as one batch. A shared request cache yields dedupe but not batching of distinct keys. A per-tick queue (DataLoader's mechanism) is the only thing that collapses N+1 across graphql-js's independent resolutions.

## Considered Options

- **`RequestResolver` + shared request cache only** — rejected: cross-resolver dedupe without cross-sibling batching; the canonical N+1 stays unsolved.
- **No built-in batching** — rejected: a graph that N+1s by default is not production-credible.

## Consequences

- A loader's flush window is tied to the JS microtask/event-loop tick.
- Request-scoped lifetime depends on the request `Layer`/`Scope` from ADR 0001.
