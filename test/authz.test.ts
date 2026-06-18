import { Context, Effect, Layer, Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";
import { describe, expect, it } from "vitest";
import { Provider, ProviderRequest } from "../src/index.ts";

class Secret extends Schema.Class<Secret>("Secret")({ value: Schema.String }) {}

class Forbidden extends Schema.Class<Forbidden>("Forbidden")({
  _tag: Schema.Literal("Forbidden"),
  reason: Schema.String,
}) {}

class Auth extends Context.Service<Auth, { readonly role: string }>()("test/Auth") {}

const adminOnly = Effect.gen(function*() {
  const auth = yield* Auth;
  if (auth.role !== "admin") {
    yield* Effect.fail(new Forbidden({ _tag: "Forbidden", reason: "admin only" }));
  }
});

const provider = Provider.make({
  app: Layer.empty,
  request: Layer.effect(Auth)(
    Effect.gen(function*() {
      const request = yield* ProviderRequest;
      const role = request.headers["x-role"];
      return { role: typeof role === "string" ? role : "guest" };
    }),
  ),
  query: {
    secret: Provider.field({
      rpc: Rpc.make("secret", { success: Secret, error: Forbidden }),
      guards: [adminOnly], // field-level authorization
      resolve: () => Effect.succeed({ value: "42" }),
    }),
  },
});

const run = (role: string) =>
  Provider.toExecutor(provider).execute({
    query: `{ secret { __typename ... on Secret { value } ... on Forbidden { reason } } }`,
    request: { method: "POST", url: "/graphql", headers: { "x-role": role }, body: null },
  });

describe("authorization guards", () => {
  it("runs the resolver when the guard passes", async () => {
    const result = await run("admin");
    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({ secret: { __typename: "Secret", value: "42" } });
  });

  it("surfaces a denied guard as a typed error union member (not errors[])", async () => {
    const result = await run("guest");
    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({ secret: { __typename: "Forbidden", reason: "admin only" } });
  });
});
