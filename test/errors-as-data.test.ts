import { Effect, Layer, Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";
import { printSchema } from "graphql";
import { describe, expect, it } from "vitest";
import { Provider } from "../src/index.ts";

class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
}) {}

class NotFound extends Schema.Class<NotFound>("NotFound")({
  _tag: Schema.Literal("NotFound"),
  message: Schema.String,
}) {}

const provider = Provider.make({
  app: Layer.empty,
  request: Layer.empty,
  query: {
    user: Provider.field({
      rpc: Rpc.make("user", { payload: { id: Schema.String }, success: User, error: NotFound }),
      resolve: ({ id }: { id: string }) =>
        id === "1"
          ? Effect.succeed({ id: "1", name: "Ada" })
          : Effect.fail(new NotFound({ _tag: "NotFound", message: `no user ${id}` })),
    }),
  },
});

const run = (query: string) =>
  Provider.toExecutor(provider).execute({
    query,
    request: { method: "POST", url: "/graphql", headers: {}, body: null },
  });

describe("errors-as-data", () => {
  it("derives a result union from the Rpc error schema", () => {
    const sdl = printSchema(Provider.toSchema(provider));
    expect(sdl).toContain("union UserResult = User | NotFound");
    expect(sdl).toContain("user(id: String!): UserResult!");
  });

  it("returns the success member on success", async () => {
    const result = await run(`{ user(id: "1") { __typename ... on User { name } } }`);
    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({ user: { __typename: "User", name: "Ada" } });
  });

  it("returns the typed error as a union member (data, not errors[])", async () => {
    const result = await run(`{ user(id: "2") { __typename ... on NotFound { message } } }`);
    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({ user: { __typename: "NotFound", message: "no user 2" } });
  });
});
