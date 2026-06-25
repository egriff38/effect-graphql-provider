// Schema -> GraphQLSchema derivation. Resolvers run through an injected per-request runner
// (RequestContextValue.runField), so this module is independent of the runtime/transport.
// Type-system coverage here is intentionally minimal for Phase 0 (scalars/array/object/class +
// augments); the full mapping is issue #7.

import type { Rpc } from "effect/unstable/rpc";

import { Cause, Effect, Exit, Schema, SchemaAST as AST } from "effect";
import * as GQL from "graphql";

/** Passed to graphql-js as `contextValue`; resolvers call `runField` with their Effect. */
export interface RequestContextValue<R> {
  readonly runField: (effect: Effect.Effect<unknown, unknown, R>) => Promise<unknown>;
  readonly runFieldExit: (effect: Effect.Effect<unknown, unknown, R>) => Promise<Exit.Exit<unknown, unknown>>;
}

/** A field normalized for derivation: schemas + a (source, args) -> Effect runner. */
export interface InternalField<R> {
  readonly rpc: Rpc.Any;
  readonly payloadSchema: Schema.Codec<unknown>;
  readonly successSchema: Schema.Top;
  readonly errorSchema: Schema.Top;
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
const withNullInput = (t: GQL.GraphQLInputType, ast: AST.AST): GQL.GraphQLInputType =>
  ast.context?.isOptional ? t : new GQL.GraphQLNonNull(t);
const cap = (s: string): string => (s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1));

// A Schema.Class has a `Declaration` AST; its underlying struct is typeParameters[0].
const structOf = (ast: AST.AST): AST.Objects | undefined => {
  if (AST.isObjects(ast)) return ast;
  if (AST.isDeclaration(ast)) {
    const inner = ast.typeParameters[0];
    if (inner && AST.isObjects(inner)) return inner;
  }
  return undefined;
};

/** The `graphql` annotation: overrides for a schema's GraphQL mapping. */
interface GraphQLAnnotation {
  /** Override the structural scalar mapping with a custom `GraphQLScalarType`. */
  readonly scalar?: GQL.GraphQLScalarType;
  /** Mark a `Schema.String` field as the GraphQL `ID` scalar (must apply to a String). */
  readonly id?: boolean;
  /** Mark a `Schema.Class` as an interface type (emits `GraphQLInterfaceType` when referenced). */
  readonly interface?: boolean;
  /** Schemas (typically other classes) whose interfaces this class implements. */
  readonly implements?: ReadonlyArray<Schema.Top>;
  /** Override the derived GraphQL type/field name. */
  readonly name?: string;
  /** Field-level deprecation reason emitted on the GraphQL field config. */
  readonly deprecationReason?: string;
}
const readGraphQL = (ast: AST.AST): GraphQLAnnotation | undefined => AST.resolveAt<GraphQLAnnotation>("graphql")(ast);

// `Schema.Int` is `Number.check(isInt())`; the int filter carries `meta._tag === "isInt"`.
const isIntFilter = (check: AST.Check<unknown>): boolean => {
  if (check._tag === "Filter") {
    const meta: unknown = check.annotations?.meta;
    return typeof meta === "object" && meta !== null && "_tag" in meta
      && (meta as { readonly _tag: unknown })._tag === "isInt";
  }
  return check.checks.some(isIntFilter);
};
const hasIntCheck = (ast: AST.AST): boolean => (ast.checks ?? []).some(isIntFilter);

// Scalars are valid in both input and output positions.
const scalarFor = (ast: AST.AST): GQL.GraphQLScalarType | undefined => {
  const ann = readGraphQL(ast);
  if (ann?.scalar) return ann.scalar;
  if (ann?.id) {
    if (!AST.isString(ast)) {
      throw new Error("effect-graphql-provider: `graphql: { id: true }` can only annotate a String schema");
    }
    return GQL.GraphQLID;
  }
  if (AST.isString(ast)) return GQL.GraphQLString;
  if (AST.isBoolean(ast)) return GQL.GraphQLBoolean;
  if (AST.isNumber(ast)) return hasIntCheck(ast) ? GQL.GraphQLInt : GQL.GraphQLFloat;
  if (AST.isLiteral(ast) && typeof ast.literal === "string") return GQL.GraphQLString;
  return undefined;
};

const isStringLiteralUnion = (ast: AST.AST): ast is AST.Union =>
  AST.isUnion(ast) && ast.types.length > 0
  && ast.types.every((t) => AST.isLiteral(t) && typeof t.literal === "string");

const isObjectUnion = (ast: AST.AST): ast is AST.Union =>
  AST.isUnion(ast) && ast.types.length > 0 && ast.types.every((t) => structOf(t) !== undefined);

// the `_tag` literal of a tagged struct member, used to discriminate union values at runtime
const tagLiteralOf = (struct: AST.Objects): string | undefined => {
  for (const ps of struct.propertySignatures) {
    if (String(ps.name) === "_tag" && AST.isLiteral(ps.type) && typeof ps.type.literal === "string") {
      return ps.type.literal;
    }
  }
  return undefined;
};

const readTag = (value: unknown): string | undefined =>
  typeof value === "object" && value !== null && "_tag" in value
    && typeof (value as { readonly _tag: unknown })._tag === "string"
    ? (value as { readonly _tag: string })._tag
    : undefined;

export function deriveSchema<R>(input: DeriveInput<R>): GQL.GraphQLSchema {
  const cache = new Map<string, GQL.GraphQLObjectType<unknown, RequestContextValue<R>>>();
  const materialized = new Set<string>();
  const idToAugments = new Map<string, ReadonlyArray<InternalAugment<R>>>();
  for (const aug of input.augmentations) {
    idToAugments.set(aug.identifier, [...(idToAugments.get(aug.identifier) ?? []), aug]);
  }
  const interfaceCache = new Map<string, GQL.GraphQLInterfaceType>();
  const implementersByInterface = new Map<string, Set<GQL.GraphQLObjectType<unknown, RequestContextValue<R>>>>();
  const enumCache = new Map<string, GQL.GraphQLEnumType>();
  const enumFor = (ast: AST.Union): GQL.GraphQLEnumType => {
    const name = AST.resolveIdentifier(ast);
    if (!name) throw new Error("effect-graphql-provider: enum (Literals) needs an `identifier` annotation");
    const hit = enumCache.get(name);
    if (hit) return hit;
    const values: GQL.GraphQLEnumValueConfigMap = {};
    for (const member of ast.types) {
      if (AST.isLiteral(member) && typeof member.literal === "string") {
        values[member.literal] = { value: member.literal };
      }
    }
    const enumType = new GQL.GraphQLEnumType({ name, values, description: AST.resolveDescription(ast) });
    enumCache.set(name, enumType);
    return enumType;
  };

  /**
   * Unwrap an optional Union (the wrapper added by `Schema.optional(X)`):
   * `Union<X, Undefined>` → `X`. The caller's `withNull{,Input}` reads
   * `ast.context?.isOptional` separately, so nullability stays correct.
   * Returns the original AST unchanged when there is no Undefined member
   * to strip, or when stripping would leave more than one member (an edge
   * case we don't try to handle).
   */
  const unwrapOptional = (ast: AST.AST): AST.AST => {
    if (!AST.isUnion(ast)) return ast;
    const non = ast.types.filter((t) => !AST.isUndefined(t));
    return non.length === 1 ? non[0] : ast;
  };

  const inputType = (ast: AST.AST): GQL.GraphQLInputType => {
    const a = unwrapOptional(ast);
    const scalar = scalarFor(a);
    if (scalar) return scalar;
    if (isStringLiteralUnion(a)) return enumFor(a);
    if (AST.isArrays(a)) return new GQL.GraphQLList(withNullInput(inputType(a.rest[0]), a.rest[0]));
    if (AST.isSuspend(a)) return inputType(a.thunk());
    const struct = structOf(a);
    if (struct) return inputObjectFor(a, struct);
    throw new Error(`effect-graphql-provider: unsupported input ast '${a._tag}'`);
  };

  const inputObjectCache = new Map<string, GQL.GraphQLInputObjectType>();
  const inputObjectFor = (nameAst: AST.AST, struct: AST.Objects): GQL.GraphQLInputObjectType => {
    const id = AST.resolveIdentifier(nameAst);
    if (!id) throw new Error("effect-graphql-provider: input object schema has no `identifier` annotation");
    // input types are distinct from output objects; default name is `{Id}Input`.
    const name = readGraphQL(nameAst)?.name ?? (id.endsWith("Input") ? id : `${id}Input`);
    const hit = inputObjectCache.get(name);
    if (hit) return hit;
    const inputObject = new GQL.GraphQLInputObjectType({
      name,
      description: AST.resolveDescription(nameAst),
      fields: () => {
        const fields: GQL.GraphQLInputFieldConfigMap = {};
        for (const ps of struct.propertySignatures) {
          fields[String(ps.name)] = { type: withNullInput(inputType(ps.type), ps.type) };
        }
        return fields;
      },
    });
    inputObjectCache.set(name, inputObject);
    return inputObject;
  };

  const outputType = (ast: AST.AST): GQL.GraphQLOutputType => {
    const a = unwrapOptional(ast);
    const scalar = scalarFor(a);
    if (scalar) return scalar;
    if (isStringLiteralUnion(a)) return enumFor(a);
    if (isObjectUnion(a)) return unionFor(a);
    if (AST.isArrays(a)) return new GQL.GraphQLList(withNull(outputType(a.rest[0]), a.rest[0]));
    if (AST.isSuspend(a)) return outputType(a.thunk());
    const struct = structOf(a);
    if (struct) return objectTypeFor(a, struct);
    throw new Error(`effect-graphql-provider: unsupported output ast '${a._tag}'`);
  };

  const fieldFromInternal = (
    name: string,
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
    const hasErrors = !AST.isNever(field.errorSchema.ast);
    const successIsObject = structOf(successAst) !== undefined;
    const hasArgs = structOf(field.payloadSchema.ast) !== undefined;
    const type = hasErrors
      ? new GQL.GraphQLNonNull(resultUnionFor(name, field))
      : withNull(outputType(successAst), successAst);
    return {
      type,
      args,
      resolve: async (source: unknown, rawArgs: unknown, context: RequestContextValue<R>) => {
        // Validate args through the payload schema (Schema-level checks); failures -> errors[].
        const decoded = hasArgs ? await Schema.decodeUnknownPromise(field.payloadSchema)(rawArgs) : rawArgs;
        // Each resolver runs in its own span (named after the field) for tracing/metrics.
        const effect = field.run(source, decoded).pipe(Effect.withSpan(`graphql.${name}`));
        if (!hasErrors) return context.runField(effect);
        const exit = await context.runFieldExit(effect);
        if (Exit.isSuccess(exit)) return successIsObject ? exit.value : { data: exit.value };
        const fail = exit.cause.reasons.find(Cause.isFailReason);
        if (fail) return fail.error; // typed error -> errors-as-data union member
        throw new Error("Internal server error"); // defect/interrupt -> masked errors[]
      },
    };
  };

  const interfaceTypeFor = (
    nameAst: AST.AST,
    struct: AST.Objects,
  ): GQL.GraphQLInterfaceType => {
    const name = AST.resolveIdentifier(nameAst);
    if (!name) throw new Error("effect-graphql-provider: interface schema has no `identifier` annotation");
    const hit = interfaceCache.get(name);
    if (hit) return hit;
    const iface = new GQL.GraphQLInterfaceType({
      name,
      description: AST.resolveDescription(nameAst),
      fields: () => {
        const fields: GQL.GraphQLFieldConfigMap<unknown, RequestContextValue<R>> = {};
        for (const ps of struct.propertySignatures) {
          const fname = String(ps.name);
          fields[fname] = {
            type: withNull(outputType(ps.type), ps.type),
            description: AST.resolveDescription(ps.type),
            deprecationReason: readGraphQL(ps.type)?.deprecationReason,
          };
        }
        return fields;
      },
      // Discriminate concrete types by `_tag` — implementers should be `Schema.TaggedClass`
      // (or any class whose instances carry a string `_tag`). Returning `undefined` lets
      // graphql-js fall back to each object type's own `isTypeOf`.
      resolveType: (value: unknown) => {
        const tag = readTag(value);
        if (tag === undefined) return undefined;
        const implementers = implementersByInterface.get(name);
        if (!implementers) return undefined;
        for (const impl of implementers) {
          if (impl.name === tag) return impl.name;
        }
        return undefined;
      },
    });
    interfaceCache.set(name, iface);
    return iface;
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
    // Resolve any `implements: [...]` interface annotations.
    const ann = readGraphQL(nameAst);
    const interfaces: Array<GQL.GraphQLInterfaceType> = [];
    if (ann?.implements) {
      for (const ifaceSchema of ann.implements) {
        const ifaceAst = ifaceSchema.ast;
        const ifaceStruct = structOf(ifaceAst);
        if (!ifaceStruct) {
          throw new Error(
            `effect-graphql-provider: 'implements' entry for '${name}' is not a class/struct schema`,
          );
        }
        const ifaceAnn = readGraphQL(ifaceAst);
        if (!ifaceAnn?.interface) {
          throw new Error(
            `effect-graphql-provider: 'implements' entry on '${name}' references a schema without 'graphql: { interface: true }'`,
          );
        }
        interfaces.push(interfaceTypeFor(ifaceAst, ifaceStruct));
      }
    }
    const augs = idToAugments.get(name) ?? [];
    const type = new GQL.GraphQLObjectType<unknown, RequestContextValue<R>>({
      name,
      description: AST.resolveDescription(nameAst),
      fields: () => {
        const fields: GQL.GraphQLFieldConfigMap<unknown, RequestContextValue<R>> = {};
        const plainNames = new Set<string>();
        for (const ps of struct.propertySignatures) {
          const fname = String(ps.name);
          fields[fname] = {
            type: withNull(outputType(ps.type), ps.type),
            description: AST.resolveDescription(ps.type),
            deprecationReason: readGraphQL(ps.type)?.deprecationReason,
          };
          plainNames.add(fname);
        }
        for (const aug of augs) {
          if (aug.fieldName in fields) {
            const origin = plainNames.has(aug.fieldName) ? "the base schema" : "another augment";
            throw new Error(
              `effect-graphql-provider: augment on type '${name}' collides on field '${aug.fieldName}' (already defined by ${origin})`,
            );
          }
          fields[aug.fieldName] = fieldFromInternal(aug.fieldName, aug.field);
        }
        return fields;
      },
      ...(interfaces.length > 0
        ? { interfaces, isTypeOf: (value: unknown) => readTag(value) === name }
        : {}),
    });
    cache.set(name, type);
    // Register self as implementer of every declared interface.
    for (const iface of interfaces) {
      const set = implementersByInterface.get(iface.name) ?? new Set<GQL.GraphQLObjectType<unknown, RequestContextValue<R>>>();
      set.add(type);
      implementersByInterface.set(iface.name, set);
    }
    return type;
  };

  const unionCache = new Map<string, GQL.GraphQLUnionType>();
  const unionFor = (ast: AST.Union): GQL.GraphQLUnionType => {
    const name = AST.resolveIdentifier(ast);
    if (!name) throw new Error("effect-graphql-provider: union needs an `identifier` annotation");
    const hit = unionCache.get(name);
    if (hit) return hit;
    const tagToName = new Map<string, string>();
    const types = ast.types.map((memberAst) => {
      const struct = structOf(memberAst);
      if (!struct) throw new Error(`effect-graphql-provider: union '${name}' has a non-object member`);
      const objectType = objectTypeFor(memberAst, struct);
      const tag = tagLiteralOf(struct);
      if (tag !== undefined) tagToName.set(tag, objectType.name);
      return objectType;
    });
    const union = new GQL.GraphQLUnionType({
      name,
      description: AST.resolveDescription(ast),
      types,
      resolveType: (value: unknown) => {
        const tag = readTag(value);
        return tag !== undefined ? tagToName.get(tag) : undefined;
      },
    });
    unionCache.set(name, union);
    return union;
  };

  const resultUnionCache = new Map<string, GQL.GraphQLUnionType>();
  // Errors-as-data: a field that declares typed errors derives `{Field}Result = Success | Err…`,
  // mirroring Exit<A, E>. A non-object success is wrapped in `{Field}Success { data: T }`.
  const resultUnionFor = (fieldName: string, field: InternalField<R>): GQL.GraphQLUnionType => {
    const name = `${cap(fieldName)}Result`;
    const hit = resultUnionCache.get(name);
    if (hit) return hit;
    const tagToName = new Map<string, string>();
    const members: Array<GQL.GraphQLObjectType<unknown, RequestContextValue<R>>> = [];
    const successAst = field.successSchema.ast;
    const successStruct = structOf(successAst);
    let successName: string;
    if (successStruct) {
      const objectType = objectTypeFor(successAst, successStruct);
      successName = objectType.name;
      members.push(objectType);
      const tag = tagLiteralOf(successStruct);
      if (tag !== undefined) tagToName.set(tag, objectType.name);
    } else {
      successName = `${cap(fieldName)}Success`;
      members.push(
        new GQL.GraphQLObjectType<unknown, RequestContextValue<R>>({
          name: successName,
          fields: () => ({ data: { type: withNull(outputType(successAst), successAst) } }),
        }),
      );
    }
    const errorAst = field.errorSchema.ast;
    const errorAsts = AST.isUnion(errorAst) ? errorAst.types : [errorAst];
    for (const memberAst of errorAsts) {
      const struct = structOf(memberAst);
      if (!struct) throw new Error(`effect-graphql-provider: error member of '${name}' is not an object type`);
      const objectType = objectTypeFor(memberAst, struct);
      members.push(objectType);
      const tag = tagLiteralOf(struct);
      if (tag !== undefined) tagToName.set(tag, objectType.name);
    }
    const union = new GQL.GraphQLUnionType({
      name,
      types: members,
      resolveType: (value: unknown) => {
        const tag = readTag(value);
        return tag !== undefined && tagToName.has(tag) ? tagToName.get(tag) : successName;
      },
    });
    resultUnionCache.set(name, union);
    return union;
  };

  const rootType = (name: string, record: Record<string, InternalField<R>>) =>
    new GQL.GraphQLObjectType<unknown, RequestContextValue<R>>({
      name,
      fields: () => {
        const fields: GQL.GraphQLFieldConfigMap<unknown, RequestContextValue<R>> = {};
        for (const [fname, field] of Object.entries(record)) fields[fname] = fieldFromInternal(fname, field);
        return fields;
      },
    });

  // Collect interface implementers so graphql-js can discover them even when
  // a field only names the interface. Without this, abstract-type resolution
  // is limited to types reachable through concrete fields.
  const interfaceImplementerTypes = new Set<GQL.GraphQLObjectType<unknown, RequestContextValue<R>>>();
  for (const set of implementersByInterface.values()) {
    for (const t of set) interfaceImplementerTypes.add(t);
  }
  const schema = new GQL.GraphQLSchema({
    query: rootType("Query", input.query),
    mutation: input.mutation ? rootType("Mutation", input.mutation) : undefined,
    ...(interfaceImplementerTypes.size > 0 ? { types: [...interfaceImplementerTypes] } : {}),
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
