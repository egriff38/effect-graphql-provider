# Prototype — class-based fields, crawl-derived GraphQL

## What this answers
Can a type be declared as ONE `Schema.Class` binding, have resolvers attached with `source`
fully inferred and **no explicit types**, and support recursive cross-type references — without
`Schema.suspend`, without a base/wrapped split?

Yes. The key facts (all verified by `tsc` + runtime):
1. A field is the real `Rpc.make` (payload -> args, success -> field type).
2. `Schema.Class` types are **nominal**, so `success: Schema.Array(Post)` referencing the bare
   class needs **no `Schema.suspend`** and creates **no inference cycle**.
3. `withGqlFields` is **dual**: `withGqlFields(Class, {...})` (data-first) or
   `Class.pipe(withGqlFields({...}))` (pipeable). `source` is inferred from the class either way.
4. Resolvers are attached **inline in the provider's `types` list**, so each type is a single
   `class X` binding — no separate wrapped value.
5. The deriver reads class fields from the `Declaration` AST (`typeParameters[0]` = the struct),
   and looks resolvers up by GraphQL identifier (cross-refs reach the bare class).
6. Void-payload fields render without parens automatically (graphql-js); only `posts(first:Int!)`
   gets parens. So the "everything is an RPC, void => no parens" idea is free.

## Run
```
bun run prototype                       # interactive TUI; 1-4 run queries, q quits
bunx tsc --noEmit -p tsconfig.json      # typecheck (proves inferred `source`)
```

## Verified
- `tsc` clean (strict + exactOptionalPropertyTypes); negative probe shows `source: User`
  (a bogus field is a compile error), so inference is real, not `any`.
- Deep `users -> posts -> author` resolves through the recursive graph with no suspend.
- Plain-only selection fires no resolvers (graphql-js default resolver).

## Open / not yet done (not the question)
- The `types: [...]` list is the one bit of bookkeeping: it supplies resolver maps keyed by
  identifier. Shapes are still discovered by crawling roots. (A global registry could remove the
  list but adds import-order-dependent mutable state — rejected for the prototype.)
- `R = never` on resolvers so we can `runPromise`; real lib runs them on a Runtime providing `R`.
- Args pass through as graphql-js coerced them; real lib would `Schema.decode` the payload first.
- Scalars only (String/Int/Boolean). No input/output polarity split, unions, enums, custom
  scalars, errors-as-data, subscriptions yet.
- Parked design decision: how deep the Rpc unification goes (full / root-only / tiered).
