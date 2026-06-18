// Public surface. A Provider bundles the type/operation definitions with the app + request
// Layers that satisfy resolver requirements. `AppR | ReqR` is the set of services resolvers may
// require; a resolver requiring anything outside it is a compile error.

import { Effect, SchemaAST as AST } from "effect";
import type { Layer, Schema } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import type { GraphQLSchema } from "graphql";
import type { ProviderRequest, ProviderRequestFields } from "./ProviderRequest.ts";
import { deriveSchema, type InternalAugment, type InternalField } from "./internal/derive.ts";
import { type Executor, makeExecutor } from "./internal/runtime.ts";

/** The schema-carrying part of an Rpc the constructors read (an `Rpc.make(...)` result fits). */
export interface RpcSchemas {
  readonly _tag: string;
  readonly payloadSchema: Schema.Codec<unknown>;
  readonly successSchema: Schema.Top;
  readonly errorSchema: Schema.Top;
}

/** Run authorization/validation guards (each fails with the field's error) before the body. */
const withGuards = <A, E, R>(
  guards: ReadonlyArray<Effect.Effect<void, E, R>> | undefined,
  body: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => (guards && guards.length > 0 ? Effect.flatMap(Effect.all(guards), () => body) : body);

/** Declare a root operation (query/mutation field). Source is the root and is unused. */
export const field = <Args, Success, E, R>(options: {
  readonly rpc: RpcSchemas;
  readonly guards?: ReadonlyArray<Effect.Effect<void, E, R>>;
  readonly resolve: (args: Args) => Effect.Effect<Success, E, R>;
}): InternalField<R> => ({
  payloadSchema: options.rpc.payloadSchema,
  successSchema: options.rpc.successSchema,
  errorSchema: options.rpc.errorSchema,
  // graphql-js provides args matching the payload schema this field was derived from.
  run: (_source, args) => withGuards(options.guards, options.resolve(args as Args)),
});

/** Layer a relationship field onto `schema` (by its identifier). `self` is the parent. */
export const augment = <S extends Schema.Top, Args, Success, E, R>(
  schema: S,
  rpc: RpcSchemas,
  impl: (self: S["Type"], args: Args) => Effect.Effect<Success, E, R>,
  guards?: ReadonlyArray<Effect.Effect<void, E, R>>,
): InternalAugment<R> => {
  const identifier = AST.resolveIdentifier(schema.ast);
  if (!identifier) {
    throw new Error("effect-graphql-provider: augment target schema has no identifier (use Schema.Class or annotate it)");
  }
  return {
    identifier,
    fieldName: rpc._tag,
    field: {
      payloadSchema: rpc.payloadSchema,
      successSchema: rpc.successSchema,
      errorSchema: rpc.errorSchema,
      // parent and args are provided by the GraphQL executor at the shapes derived here.
      run: (source, args) => withGuards(guards, impl(source as S["Type"], args as Args)),
    },
  };
};

export interface ProviderConfig<AppR, ReqR, E> {
  // `AppR` is inferred only from `app`, `ReqR` only from `request`'s output; the other
  // positions are `NoInfer` so they validate (resolver requirements ⊆ AppR | ReqR) without
  // polluting inference (otherwise `request`'s RIn could degenerately fix `AppR`).
  readonly app: Layer.Layer<AppR, E, never>;
  readonly request: Layer.Layer<ReqR, E, ProviderRequest | NoInfer<AppR>>;
  readonly query: Record<string, InternalField<NoInfer<AppR> | NoInfer<ReqR>>>;
  readonly mutation?: Record<string, InternalField<NoInfer<AppR> | NoInfer<ReqR>>>;
  readonly augmentations?: ReadonlyArray<InternalAugment<NoInfer<AppR> | NoInfer<ReqR>>>;
}

export interface Provider<AppR, ReqR, E> {
  readonly config: ProviderConfig<AppR, ReqR, E>;
}

export const make = <AppR, ReqR, E>(config: ProviderConfig<AppR, ReqR, E>): Provider<AppR, ReqR, E> => ({ config });

export const toSchema = <AppR, ReqR, E>(provider: Provider<AppR, ReqR, E>): GraphQLSchema =>
  deriveSchema<AppR | ReqR>({
    query: provider.config.query,
    mutation: provider.config.mutation,
    augmentations: provider.config.augmentations ?? [],
  });

export const toExecutor = <AppR, ReqR, E>(provider: Provider<AppR, ReqR, E>): Executor =>
  makeExecutor(toSchema(provider), provider.config.app, provider.config.request);

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const asString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * An effect-platform HttpApp serving the Provider: reads a GraphQL request from the body,
 * bridges it to a ProviderRequest, executes through the two-tier runtime, and returns JSON.
 * The app runtime is built once when `serve` is called and reused per request.
 */
export const serve = <AppR, ReqR, E>(provider: Provider<AppR, ReqR, E>) => {
  const executor = toExecutor(provider);
  return Effect.gen(function*() {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* request.json;
    const params = asRecord(body) ?? {};
    const result = yield* Effect.promise(() =>
      executor.execute({
        query: asString(params["query"]) ?? "",
        variables: asRecord(params["variables"]),
        operationName: asString(params["operationName"]),
        request: { method: request.method, url: request.url, headers: { ...request.headers }, body },
      })
    );
    return yield* HttpServerResponse.json(result);
  });
};
