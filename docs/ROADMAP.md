# v1 Roadmap

Phased plan to take the library from prototype to a production-ready v1. Ordering follows the
decisions recorded in `docs/adr/` and the design interview. Each phase depends on the one before
it; testing accompanies every phase (the harness is set up in Phase 0).

**v1 scope:** queries + mutations. Subscriptions are deferred (ADR 0005).

## Phase 0 — Foundation

Replace the prototype's stubs (`Effect.runPromise` per resolver, `R = never`) with the real
runtime, and lock the public surface everything else is built behind.

- **#4 — Core runtime: own execution + two-tier runtime + request-context Layer** (ADR 0001). The unblocker; nothing real ships before this.
- **#9 — Public API + module structure: `Provider` namespace, `internal/`, exports map** (Q10).
- **#12 — Testing suite/harness** (`@effect/vitest`); feature tests then land per phase.

## Phase 1 — Correctness (the schema is right)

Make the derived schema cover the GraphQL type system and surface errors as decided.

- **#7 — Annotation-driven type-system coverage** (ADR 0004): custom scalars, enums, unions, interfaces, ID, `Number`→Float fix.
- **#2 — Input/output type split** (`GraphQLInputObjectType` for structured args).
- **#5 — Errors-as-data result unions** (ADR 0002).
- **#1 — Decode argument payloads through `Schema`** before resolvers.

## Phase 2 — Effect superpowers (why choose this over Pothos)

The differentiators that the runtime makes possible.

- **#6 — Request-scoped tick-batched loaders** (ADR 0003).
- **#10 — Observability**: per-request + per-resolver tracing, metrics, logging.
- **#8 — Authorization**: Rpc middleware + request auth service.

## Phase 3 — Hardening & transports

Make it safe to expose, and portable.

- **#11 — Query hardening**: operation timeout, depth/complexity limits, env-gated introspection.
- **#3 — Native RPC transport + dual client (root-only)** (decision in #3).
- **#16 — Foreign-server adapters** (Yoga/Apollo) over the `ProviderRequest` contract.

## Phase 4 — DX & release

- **#13 — GraphiQL route** (gated by introspection).
- **#14 — Examples suite** (promote `prototype/`).
- **#15 — Documentation** (API reference + "why Effect" + augmentation/recursion guide).
- **#17 — Release plumbing + `effect@beta` upgrade tracking**.

## Decision record

- ADR 0001 — Own execution on effect-platform; two-tier runtime.
- ADR 0002 — Typed errors as data; defects masked.
- ADR 0003 — Request-scoped tick-batched loaders.
- ADR 0004 — Annotation-driven Schema→GraphQL type mapping.
- ADR 0005 — Subscriptions deferred from v1.

Glossary: `CONTEXT.md`.
