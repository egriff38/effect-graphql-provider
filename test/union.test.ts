import { Effect, Layer, Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";
import { printSchema } from "graphql";
import { describe, expect, it } from "vitest";
import { Provider } from "../src/index.ts";

class Cat extends Schema.Class<Cat>("Cat")({
  _tag: Schema.Literal("Cat"),
  meows: Schema.Boolean,
}) {}

class Dog extends Schema.Class<Dog>("Dog")({
  _tag: Schema.Literal("Dog"),
  barks: Schema.Boolean,
}) {}

const Animal = Schema.Union([Cat, Dog]).annotate({ identifier: "Animal" });

const provider = Provider.make({
  app: Layer.empty,
  request: Layer.empty,
  query: {
    pet: Provider.field({
      rpc: Rpc.make("pet", { success: Animal }),
      resolve: () => Effect.succeed({ _tag: "Cat" as const, meows: true }),
    }),
  },
});

describe("tagged union", () => {
  it("maps a Schema.Union of tagged members to a GraphQL union", () => {
    const sdl = printSchema(Provider.toSchema(provider));
    expect(sdl).toContain("union Animal = Cat | Dog");
    expect(sdl).toContain("type Cat");
    expect(sdl).toContain("type Dog");
    expect(sdl).toContain("pet: Animal!");
  });
});
