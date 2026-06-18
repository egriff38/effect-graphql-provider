import { Effect, Layer, Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";
import { printSchema } from "graphql";
import { describe, expect, it } from "vitest";
import { Provider } from "../src/index.ts";

class Stats extends Schema.Class<Stats>("Stats")({
  name: Schema.String,
  score: Schema.Number,
  count: Schema.Int,
  status: Schema.Literals(["ACTIVE", "INACTIVE"]).annotate({ identifier: "Status" }),
}) {}

const provider = Provider.make({
  app: Layer.empty,
  request: Layer.empty,
  query: {
    stats: Provider.field({
      rpc: Rpc.make("stats", { success: Stats }),
      resolve: () => Effect.succeed({ name: "x", score: 1.5, count: 3, status: "ACTIVE" as const }),
    }),
  },
});

describe("scalar mapping", () => {
  it("maps Number -> Float and Schema.Int -> Int (not Int for plain numbers)", () => {
    const sdl = printSchema(Provider.toSchema(provider));
    expect(sdl).toContain("name: String!");
    expect(sdl).toContain("score: Float!");
    expect(sdl).toContain("count: Int!");
    expect(sdl).toContain("status: Status!");
    expect(sdl).toContain("enum Status");
    expect(sdl).toContain("ACTIVE");
    expect(sdl).toContain("INACTIVE");
  });
});
