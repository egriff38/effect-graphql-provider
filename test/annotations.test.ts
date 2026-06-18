import { Effect, Layer, Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";
import { GraphQLScalarType, printSchema } from "graphql";
import { describe, expect, it } from "vitest";
import { Provider } from "../src/index.ts";

const DateTime = new GraphQLScalarType({ name: "DateTime" });

class Event extends Schema.Class<Event>("Event")({
  title: Schema.String.annotate({ description: "The event title" }),
  at: Schema.String.annotate({ graphql: { scalar: DateTime } }),
}) {}

const provider = Provider.make({
  app: Layer.empty,
  request: Layer.empty,
  query: {
    event: Provider.field({
      rpc: Rpc.make("event", { success: Event }),
      resolve: () => Effect.succeed({ title: "Launch", at: "2026-01-01" }),
    }),
  },
});

describe("annotations", () => {
  it("maps a custom scalar from the graphql annotation and carries field descriptions", () => {
    const sdl = printSchema(Provider.toSchema(provider));
    expect(sdl).toContain("scalar DateTime");
    expect(sdl).toContain("at: DateTime!");
    expect(sdl).toContain("The event title");
  });
});
