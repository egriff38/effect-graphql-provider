// The two-tier runtime (ADR 0001). An app Layer -> long-lived ManagedRuntime built once; per
// operation a request Context is built (inside a request Scope) from the request Layer, and each
// resolver Effect runs on the app runtime with the request context provided. Scope finalizes
// after the operation. R is satisfied by app services ∪ request services.

import { Effect, Exit, Layer, ManagedRuntime, Scope } from "effect";
import { graphql, type ExecutionResult, type GraphQLSchema } from "graphql";
import { ProviderRequest, type ProviderRequestFields } from "../ProviderRequest.ts";
import type { RequestContextValue } from "./derive.ts";

export interface ExecuteParams {
  readonly query: string;
  readonly variables?: Readonly<Record<string, unknown>> | undefined;
  readonly operationName?: string | undefined;
  readonly request: ProviderRequestFields;
}

export interface Executor {
  readonly execute: (params: ExecuteParams) => Promise<ExecutionResult>;
  readonly dispose: () => Promise<void>;
}

export const makeExecutor = <AppR, ReqR, E>(
  schema: GraphQLSchema,
  appLayer: Layer.Layer<AppR, E, never>,
  requestLayer: Layer.Layer<ReqR, E, AppR | ProviderRequest>,
): Executor => {
  const managed = ManagedRuntime.make(appLayer);

  const execute = async (params: ExecuteParams): Promise<ExecutionResult> => {
    const scope = Scope.makeUnsafe();
    const requestContext = await managed.runPromise(
      Layer.build(requestLayer).pipe(
        Effect.provideService(ProviderRequest, params.request),
        Effect.provideService(Scope.Scope, scope),
      ),
    );
    const contextValue: RequestContextValue<AppR | ReqR> = {
      runField: (effect) => managed.runPromise(Effect.provideContext(effect, requestContext)),
    };
    try {
      return await graphql({
        schema,
        source: params.query,
        variableValues: params.variables,
        operationName: params.operationName,
        contextValue,
      });
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.succeed(undefined)));
    }
  };

  return { execute, dispose: () => managed.dispose() };
};
