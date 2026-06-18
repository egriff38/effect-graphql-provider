import { Context } from "effect";

/**
 * The transport-agnostic request the per-request context layer is built from.
 * Each adapter (effect-platform, Yoga, Apollo, …) populates this from its native
 * request, so a Provider's request layer never depends on a concrete server.
 */
export interface ProviderRequestFields {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export class ProviderRequest extends Context.Service<ProviderRequest, ProviderRequestFields>()(
  "effect-graphql-provider/ProviderRequest",
) {}
