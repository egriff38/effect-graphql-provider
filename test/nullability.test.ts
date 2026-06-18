import { Effect, Layer, Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";
import { printSchema } from "graphql";
import { describe, expect, it } from "vitest";
import { Provider } from "../src/index.ts";

class Profile extends Schema.Class<Profile>("Profile")({
  id: Schema.String,
  nickname: Schema.optionalKey(Schema.String), // optional -> nullable GraphQL field
}) {}

const provider = Provider.make({
  app: Layer.empty,
  request: Layer.empty,
  query: {
    profile: Provider.field({
      rpc: Rpc.make("profile", { success: Profile }),
      resolve: () => Effect.succeed({ id: "1" }),
    }),
  },
});

describe("nullability", () => {
  it("maps required fields to non-null and optional fields to nullable", () => {
    const sdl = printSchema(Provider.toSchema(provider));
    expect(sdl).toContain("id: String!");
    expect(sdl).toMatch(/nickname: String\b(?!!)/); // nullable: `String`, not `String!`
  });
});
