// PROTOTYPE — throwaway. Portable bit: attach GraphQL field resolvers to a Schema via a
// TYPED, pipeable annotator (the schema stays a plain Schema — full combinator ecosystem),
// then derive a GraphQLSchema by crawling the closure of the root query/mutation rpcs.
// See NOTES.md for the question this answers.

import { Effect, Schema, SchemaAST as AST } from "effect";
import * as GQL from "graphql";

// A resolved field: the Rpc carries the schemas (payload -> args, success -> type);
// `resolve` is authored by us, so `source` is a plain typed parameter.
export interface FieldImpl<Src = any> {
  readonly rpc: {
    readonly _tag: string;
    readonly payloadSchema: Schema.Top;
    readonly successSchema: Schema.Top;
  };
  // R = never here: the prototype's resolvers use no services so we can `runPromise` them
  // directly. The real library would run them on a Runtime that provides their R.
  readonly resolve: (args: any, source: Src) => Effect.Effect<any, any, never>;
}

export type Fields<Src> = Record<string, FieldImpl<Src>>;

// Data-last, effect-idiomatic shape: `<S extends Top>(arg using S["Type"]) => (self: S) => S`.
// In `pipe(schema, withGqlFields(fields))`, S is driven by the contextual `self` type that
// pipe supplies, so `source` in each resolver is inferred from the schema's decoded Type.
// Returns the SAME Schema (annotated under the hood) so every Schema/RPC combinator works.
export const withGqlFields =
  <S extends Schema.Top>(fields: Fields<S["Type"]>) =>
  (self: S): S =>
    self.annotate({ gqlFields: fields }) as S;

// Complementary: stamp the GraphQL type name. Independent of S["Type"], so trivially pipeable.
export const withGqlIdentifier =
  (identifier: string) =>
  <S extends Schema.Top>(self: S): S =>
    self.annotate({ identifier }) as S;

const readFields = (ast: AST.AST): Record<string, FieldImpl> =>
  AST.resolveAt<Record<string, FieldImpl>>("gqlFields")(ast) ?? {};

export interface Roots {
  readonly query: Record<string, FieldImpl>;
  readonly mutation?: Record<string, FieldImpl>;
}

const nonNull = (t: GQL.GraphQLOutputType) => new GQL.GraphQLNonNull(t);
const withNull = (t: GQL.GraphQLOutputType, ast: AST.AST) =>
  ast.context?.isOptional ? t : nonNull(t);

export function deriveSchema(roots: Roots): GQL.GraphQLSchema {
  const cache = new Map<string, GQL.GraphQLObjectType>();

  const inputType = (ast: AST.AST): GQL.GraphQLInputType => {
    if (AST.isString(ast)) return GQL.GraphQLString;
    if (AST.isNumber(ast)) return GQL.GraphQLInt;
    if (AST.isBoolean(ast)) return GQL.GraphQLBoolean;
    throw new Error(`prototype: unsupported input ast '${ast._tag}'`);
  };

  const outputType = (ast: AST.AST): GQL.GraphQLOutputType => {
    if (AST.isString(ast)) return GQL.GraphQLString;
    if (AST.isNumber(ast)) return GQL.GraphQLInt;
    if (AST.isBoolean(ast)) return GQL.GraphQLBoolean;
    if (AST.isArrays(ast))
      return new GQL.GraphQLList(
        withNull(outputType(ast.rest[0]), ast.rest[0]),
      );
    if (AST.isSuspend(ast)) return outputType(ast.thunk()); // recursive/mutually-recursive types
    if (AST.isObjects(ast)) return objectTypeFor(ast);
    throw new Error(`prototype: unsupported output ast '${ast._tag}'`);
  };

  const resolvedField = (impl: FieldImpl): GQL.GraphQLFieldConfig<any, any> => {
    const argsAst = impl.rpc.payloadSchema.ast;
    const args: GQL.GraphQLFieldConfigArgumentMap = {};
    if (AST.isObjects(argsAst)) {
      for (const ps of argsAst.propertySignatures) {
        const base = inputType(ps.type);
        args[String(ps.name)] = {
          type: ps.type.context?.isOptional
            ? base
            : new GQL.GraphQLNonNull(base),
        };
      }
    }
    const successAst = impl.rpc.successSchema.ast;
    return {
      type: withNull(outputType(successAst), successAst),
      args,
      resolve: (source, fieldArgs) =>
        Effect.runPromise(impl.resolve(fieldArgs, source)),
    };
  };

  const objectTypeFor = (ast: AST.Objects): GQL.GraphQLObjectType => {
    const name = AST.resolveIdentifier(ast);
    if (!name)
      throw new Error(
        "prototype: reachable object schema has no `identifier` annotation",
      );
    const hit = cache.get(name);
    if (hit) return hit;
    const fieldsMap = readFields(ast);
    const type = new GQL.GraphQLObjectType({
      name,
      fields: () => {
        const fields: GQL.GraphQLFieldConfigMap<any, any> = {};
        for (const ps of ast.propertySignatures) {
          fields[String(ps.name)] = {
            type: withNull(outputType(ps.type), ps.type),
          };
        }
        for (const [fname, impl] of Object.entries(fieldsMap))
          fields[fname] = resolvedField(impl);
        return fields;
      },
    });
    cache.set(name, type);
    return type;
  };

  const rootType = (name: string, record: Record<string, FieldImpl>) =>
    new GQL.GraphQLObjectType({
      name,
      fields: () => {
        const fields: GQL.GraphQLFieldConfigMap<any, any> = {};
        for (const [fname, impl] of Object.entries(record))
          fields[fname] = resolvedField(impl);
        return fields;
      },
    });

  return new GQL.GraphQLSchema({
    query: rootType("Query", roots.query),
    mutation: roots.mutation ? rootType("Mutation", roots.mutation) : undefined,
  });
}
