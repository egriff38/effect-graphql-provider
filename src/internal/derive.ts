// Schema -> GraphQLSchema derivation. Resolvers run through an injected per-request runner
// (RequestContextValue.runField), so this module is independent of the runtime/transport.
// Type-system coverage here is intentionally minimal for Phase 0 (scalars/array/object/class +
// augments); the full mapping is issue #7.

import { type Effect, Schema, SchemaAST as AST } from "effect";
import * as GQL from "graphql";

/** Passed to graphql-js as `contextValue`; resolvers call `runField` with their Effect. */
export interface RequestContextValue<R> {
  readonly runField: (effect: Effect.Effect<unknown, unknown, R>) => Promise<unknown>;
}

/** A field normalized for derivation: schemas + a (source, args) -> Effect runner. */
export interface InternalField<R> {
  readonly payloadSchema: Schema.Top;
  readonly successSchema: Schema.Top;
  readonly run: (source: unknown, args: unknown) => Effect.Effect<unknown, unknown, R>;
}

export interface InternalAugment<R> {
  readonly identifier: string;
  readonly fieldName: string;
  readonly field: InternalField<R>;
}

export interface DeriveInput<R> {
  readonly query: Record<string, InternalField<R>>;
  readonly mutation?: Record<string, InternalField<R>> | undefined;
  readonly augmentations: ReadonlyArray<InternalAugment<R>>;
}

const nonNull = (t: GQL.GraphQLOutputType) => new GQL.GraphQLNonNull(t);
const withNull = (t: GQL.GraphQLOutputType, ast: AST.AST) => ast.context?.isOptional ? t : nonNull(t);

// A Schema.Class has a `Declaration` AST; its underlying struct is typeParameters[0].
const structOf = (ast: AST.AST): AST.Objects | undefined => {
  if (AST.isObjects(ast)) return ast;
  if (AST.isDeclaration(ast)) {
    const inner = ast.typeParameters[0];
    if (inner && AST.isObjects(inner)) return inner;
  }
  return undefined;
};

export function deriveSchema<R>(input: DeriveInput<R>): GQL.GraphQLSchema {
  const cache = new Map<string, GQL.GraphQLObjectType<unknown, RequestContextValue<R>>>();
  const materialized = new Set<string>();
  const idToAugments = new Map<string, ReadonlyArray<InternalAugment<R>>>();
  for (const aug of input.augmentations) {
    idToAugments.set(aug.identifier, [...(idToAugments.get(aug.identifier) ?? []), aug]);
  }

  const inputType = (ast: AST.AST): GQL.GraphQLInputType => {
    if (AST.isString(ast)) return GQL.GraphQLString;
    if (AST.isNumber(ast)) return GQL.GraphQLInt;
    if (AST.isBoolean(ast)) return GQL.GraphQLBoolean;
    throw new Error(`effect-graphql-provider: unsupported input ast '${ast._tag}'`);
  };

  const outputType = (ast: AST.AST): GQL.GraphQLOutputType => {
    if (AST.isString(ast)) return GQL.GraphQLString;
    if (AST.isNumber(ast)) return GQL.GraphQLInt;
    if (AST.isBoolean(ast)) return GQL.GraphQLBoolean;
    if (AST.isArrays(ast)) return new GQL.GraphQLList(withNull(outputType(ast.rest[0]), ast.rest[0]));
    if (AST.isSuspend(ast)) return outputType(ast.thunk());
    const struct = structOf(ast);
    if (struct) return objectTypeFor(ast, struct);
    throw new Error(`effect-graphql-provider: unsupported output ast '${ast._tag}'`);
  };

  const fieldFromInternal = (
    field: InternalField<R>,
  ): GQL.GraphQLFieldConfig<unknown, RequestContextValue<R>> => {
    const argsStruct = structOf(field.payloadSchema.ast);
    const args: GQL.GraphQLFieldConfigArgumentMap = {};
    if (argsStruct) {
      for (const ps of argsStruct.propertySignatures) {
        const base = inputType(ps.type);
        args[String(ps.name)] = { type: ps.type.context?.isOptional ? base : new GQL.GraphQLNonNull(base) };
      }
    }
    const successAst = field.successSchema.ast;
    return {
      type: withNull(outputType(successAst), successAst),
      args,
      resolve: (source: unknown, fieldArgs: unknown, context: RequestContextValue<R>) =>
        context.runField(field.run(source, fieldArgs)),
    };
  };

  const objectTypeFor = (
    nameAst: AST.AST,
    struct: AST.Objects,
  ): GQL.GraphQLObjectType<unknown, RequestContextValue<R>> => {
    const name = AST.resolveIdentifier(nameAst);
    if (!name) throw new Error("effect-graphql-provider: reachable object schema has no `identifier` annotation");
    const hit = cache.get(name);
    if (hit) return hit;
    materialized.add(name);
    const augs = idToAugments.get(name) ?? [];
    const type = new GQL.GraphQLObjectType<unknown, RequestContextValue<R>>({
      name,
      fields: () => {
        const fields: GQL.GraphQLFieldConfigMap<unknown, RequestContextValue<R>> = {};
        const plainNames = new Set<string>();
        for (const ps of struct.propertySignatures) {
          const fname = String(ps.name);
          fields[fname] = { type: withNull(outputType(ps.type), ps.type) };
          plainNames.add(fname);
        }
        for (const aug of augs) {
          if (aug.fieldName in fields) {
            const origin = plainNames.has(aug.fieldName) ? "the base schema" : "another augment";
            throw new Error(
              `effect-graphql-provider: augment on type '${name}' collides on field '${aug.fieldName}' (already defined by ${origin})`,
            );
          }
          fields[aug.fieldName] = fieldFromInternal(aug.field);
        }
        return fields;
      },
    });
    cache.set(name, type);
    return type;
  };

  const rootType = (name: string, record: Record<string, InternalField<R>>) =>
    new GQL.GraphQLObjectType<unknown, RequestContextValue<R>>({
      name,
      fields: () => {
        const fields: GQL.GraphQLFieldConfigMap<unknown, RequestContextValue<R>> = {};
        for (const [fname, field] of Object.entries(record)) fields[fname] = fieldFromInternal(field);
        return fields;
      },
    });

  const schema = new GQL.GraphQLSchema({
    query: rootType("Query", input.query),
    mutation: input.mutation ? rootType("Mutation", input.mutation) : undefined,
  });

  const missing = [...idToAugments.keys()].filter((id) => !materialized.has(id));
  if (missing.length > 0) {
    const known = [...materialized].sort().join(", ");
    throw new Error(
      `effect-graphql-provider: augment(s) target type(s) not present in the schema: ${missing.join(", ")}. Known types: ${known}`,
    );
  }
  return schema;
}
