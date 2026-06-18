# Typed errors as data; defects masked

A resolver's outcome reifies the Effect's `Exit<A, E>` into GraphQL. Declared typed errors (the Rpc `errorSchema` — a tagged error or a union of them) become members of a derived **result union** `{Op}Result = <success> | Err1 | Err2 …`; the handler surfaces them through the Effect failure channel (`Effect.fail` / `yield*`), and the resolver wrapper encodes the `Fail(e)` via that same `errorSchema` into the matching union member (its tag → the member type name / `__typename`). A success that isn't an object type is wrapped in `{Op}Success { data: T }` so it can be a union member; fields that declare no typed errors return their success type directly (no union). Defects and interrupts (the `Cause`, outside `E`) are masked to a generic top-level `errors[]` entry and logged with the trace.

## Rationale

The union mirrors `Exit<A, E>` one-to-one, so the schema's error contract is the exact value the handler already produces — the `errorSchema` is the single source of truth for both "what errors appear in the schema" and "how a surfaced error is encoded." Keeps expected/business failures out of GraphQL's null-propagation machinery (they're typed data the client must handle, and they null nothing), and reserves the spec's top-level `errors[]` for genuinely unexpected failures, where subtree-nulling is the correct behaviour.

## Considered Options

- **Top-level `errors[]` only (codes in `extensions`)** — rejected: discards the typed-error advantage, forces clients to string-match codes, and subjects business errors to null propagation.
- **Relay-style payload object** (`{ ...success, errors: [..] }`) — rejected: co-mingles success and errors and doesn't force per-variant handling in the type system.
- **Object-success-only union** — rejected: an arbitrary restriction that breaks common scalar-returning operations.

## Consequences

- The deriver must synthesize union + `{Op}Success` wrapper types — shared machinery with #2 (input/output split) and the broader union/enum coverage work.
- A mechanism to mark some declared `E` as internal (masked rather than exposed) may be wanted later.
