import { Effect, Layer, Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";
import { printSchema } from "graphql";
import { describe, expect, it } from "vitest";
import { Provider } from "../src/index.ts";

class Thing extends Schema.Class<Thing>("Thing")({ id: Schema.String }) {}
class ThingError extends Schema.Class<ThingError>("ThingError")({
  _tag: Schema.Literal("ThingError"),
  msg: Schema.String,
}) {}
class Boom extends Schema.Class<Boom>("Boom")({ _tag: Schema.Literal("Boom"), why: Schema.String }) {}

const provider = Provider.make({
  app: Layer.empty,
  request: Layer.empty,
  query: {
    // typed-error field whose resolver DIES (a defect, not a typed failure)
    boom: Provider.field({
      rpc: Rpc.make("boom", { success: Thing, error: ThingError }),
      resolve: () => Effect.die("secret internal detail"),
    }),
    // typed-error field with a SCALAR success -> wrapped in `{Op}Success { data }`
    token: Provider.field({
      rpc: Rpc.make("token", { payload: { ok: Schema.Boolean }, success: Schema.String, error: Boom }),
      resolve: ({ ok }: { ok: boolean }) =>
        ok ? Effect.succeed("secret-token") : Effect.fail(new Boom({ _tag: "Boom", why: "denied" })),
    }),
  },
});

const run = (query: string) =>
  Provider.toExecutor(provider).execute({
    query,
    request: { method: "POST", url: "/graphql", headers: {}, body: null },
  });

describe("error edges", () => {
  it("masks a defect (no leak) and reports it in errors[]", async () => {
    const result = await run(`{ boom { __typename } }`);
    expect(result.errors).toBeDefined();
    expect(result.errors?.[0]?.message).toBe("Internal server error");
    expect(JSON.stringify(result)).not.toContain("secret internal detail");
    expect(result.data?.boom ?? null).toBeNull();
  });

  it("wraps a non-object success in {Op}Success for errors-as-data fields", () => {
    const sdl = printSchema(Provider.toSchema(provider));
    expect(sdl).toContain("union TokenResult = TokenSuccess | Boom");
    expect(sdl).toContain("type TokenSuccess");
    expect(sdl).toMatch(/TokenSuccess\s*\{\s*data: String!/);
  });

  it("returns the wrapped success member on success, and the error member on failure", async () => {
    const ok = await run(`{ token(ok: true) { __typename ... on TokenSuccess { data } } }`);
    expect(ok.errors).toBeUndefined();
    expect(ok.data).toEqual({ token: { __typename: "TokenSuccess", data: "secret-token" } });

    const denied = await run(`{ token(ok: false) { __typename ... on Boom { why } } }`);
    expect(denied.errors).toBeUndefined();
    expect(denied.data).toEqual({ token: { __typename: "Boom", why: "denied" } });
  });
});
