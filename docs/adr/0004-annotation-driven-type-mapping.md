# Annotation-driven Schema→GraphQL type mapping with structural fallback

The deriver maps effect `Schema` to GraphQL types by consulting a `graphql` annotation first, then falling back to structural rules: `String`→String, `Schema.Int`→Int, `Schema.Number`→Float, `Boolean`→Boolean, `Schema.Literals`→enum, a `Schema.Union` of tagged members→GraphQL union, classes sharing a base→interface, structs/classes→object type (or input object in argument position, per issue #2). The `graphql` annotation overrides type names, marks `ID`, and declares custom scalars (e.g. DateTime/UUID/JSON) with serialize/parse.

## Rationale

A registry + annotation approach covers the whole type system and gives an explicit override exactly where structure is ambiguous or insufficient (custom scalars, `ID` vs `String`). It reuses the Schema annotation mechanism already used for identifiers and gql fields. Pure structural inference can't express custom scalars and leaves `Number` ambiguous; maintaining parallel hand-written GraphQL types defeats deriving from Schema.

## Consequences

- Fixes the prototype's incorrect `Number`→`Int` (now `Float` unless `Schema.Int`).
- Union derivation here is the same machinery as the errors-as-data result unions (ADR 0002).
- Custom-scalar serialize/parse runs at the GraphQL boundary — distinct from `Schema` decode of argument payloads (issue #1).
