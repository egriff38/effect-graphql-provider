import { Effect, Layer, Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";
import { printSchema } from "graphql";
import { describe, expect, it } from "vitest";
import { Provider } from "../src/index.ts";

class User extends Schema.Class<User>("User")({
  id: Schema.String.annotate({ graphql: { id: true } }),
  name: Schema.String,
}) {}

const provider = Provider.make({
  app: Layer.empty,
  request: Layer.empty,
  query: {
    user: Provider.field({
      rpc: Rpc.make("user", {
        // ID also valid in input position
        payload: { id: Schema.String.annotate({ graphql: { id: true } }) },
        success: User,
      }),
      resolve: ({ id }) => Effect.succeed(new User({ id, name: "Ada" })),
    }),
  },
});

describe("ID marker (#20)", () => {
  it("emits ID! in output position for an annotated Schema.String", () => {
    const sdl = printSchema(Provider.toSchema(provider));
    // Field is non-null ID
    expect(sdl).toMatch(/type User \{[^}]*id: ID![^}]*\}/s);
    // Other strings on the same type remain String
    expect(sdl).toMatch(/name: String!/);
  });

  it("emits ID! in input position when used as a payload arg", () => {
    const sdl = printSchema(Provider.toSchema(provider));
    expect(sdl).toMatch(/user\(id: ID!\)/);
  });

  it("round-trips an ID-typed value end-to-end", async () => {
    const result = await Provider.toExecutor(provider).execute({
      query: `{ user(id: "u1") { id name } }`,
      request: { method: "POST", url: "/", headers: {}, body: null },
    });
    expect(result.errors).toBeUndefined();
    expect(result.data?.["user"]).toEqual({ id: "u1", name: "Ada" });
  });

  it("rejects `graphql: { id: true }` on a non-String schema at derive time", () => {
    class Bad extends Schema.Class<Bad>("Bad")({
      // intentionally invalid: id on a Number
      id: Schema.Number.annotate({ graphql: { id: true } }),
    }) {}
    expect(() =>
      Provider.toSchema(
        Provider.make({
          app: Layer.empty,
          request: Layer.empty,
          query: {
            thing: Provider.field({
              rpc: Rpc.make("thing", { success: Bad }),
              resolve: () => Effect.succeed(new Bad({ id: 1 })),
            }),
          },
        }),
      )
    ).toThrow(/id: true.*String/);
  });
});
