import { Effect, Layer, Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";
import { describe, expect, it } from "vitest";
import { Provider } from "../src/index.ts";

class User extends Schema.Class<User>("User")({ id: Schema.String, name: Schema.String }) {}
class Ghost extends Schema.Class<Ghost>("Ghost")({ id: Schema.String }) {}

const base = {
  app: Layer.empty,
  request: Layer.empty,
  query: {
    user: Provider.field({
      rpc: Rpc.make("user", { success: User }),
      resolve: () => Effect.succeed({ id: "1", name: "Ada" }),
    }),
  },
} as const;

describe("derive-time guards", () => {
  it("rejects an augment whose field collides with a base field", () => {
    const provider = Provider.make({
      ...base,
      augmentations: [
        Provider.augment(User, Rpc.make("name", { success: Schema.String }), () => Effect.succeed("x")),
      ],
    });
    expect(() => Provider.toSchema(provider)).toThrow(/collides on field 'name'/);
  });

  it("rejects an augment that targets a type not reachable from the roots", () => {
    const provider = Provider.make({
      ...base,
      augmentations: [
        Provider.augment(Ghost, Rpc.make("boo", { success: Schema.String }), () => Effect.succeed("x")),
      ],
    });
    expect(() => Provider.toSchema(provider)).toThrow(/not present in the schema: Ghost/);
  });

  it("rejects a reachable object schema with no identifier", () => {
    const Anon = Schema.Struct({ id: Schema.String }); // no identifier annotation
    const provider = Provider.make({
      app: Layer.empty,
      request: Layer.empty,
      query: {
        thing: Provider.field({
          rpc: Rpc.make("thing", { success: Anon }),
          resolve: () => Effect.succeed({ id: "1" }),
        }),
      },
    });
    expect(() => Provider.toSchema(provider)).toThrow(/identifier/);
  });
});
