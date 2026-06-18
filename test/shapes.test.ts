import { Effect, Layer, Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";
import { printSchema } from "graphql";
import { describe, expect, it } from "vitest";
import { Provider } from "../src/index.ts";

// Optionals + lists + self-recursion in one type.
class Category extends Schema.Class<Category>("Category")({
  id: Schema.String,
  parentName: Schema.optionalKey(Schema.String), // nullable
  tags: Schema.Array(Schema.String), // [String!]!
  children: Schema.Array(Schema.suspend((): Schema.Codec<Category> => Category)), // recursion: [Category!]!
}) {}

const provider = Provider.make({
  app: Layer.empty,
  request: Layer.empty,
  query: {
    root: Provider.field({
      rpc: Rpc.make("root", { success: Category }),
      resolve: () =>
        Effect.succeed({
          id: "1",
          tags: ["a", "b"],
          children: [{ id: "1.1", tags: [], children: [] }],
        }),
    }),
    roots: Provider.field({
      rpc: Rpc.make("roots", { success: Schema.Array(Category) }),
      resolve: () => Effect.succeed([]),
    }),
  },
});

describe("schema shapes: lists, recursion, optionals", () => {
  it("emits the right list/nullability/recursion SDL", () => {
    const sdl = printSchema(Provider.toSchema(provider));
    expect(sdl).toContain("id: String!");
    expect(sdl).toMatch(/parentName: String\b(?!!)/); // optional -> nullable
    expect(sdl).toContain("tags: [String!]!"); // non-null list of non-null
    expect(sdl).toContain("children: [Category!]!"); // recursive list
    expect(sdl).toContain("roots: [Category!]!"); // list-returning root op
  });

  it("resolves a recursive selection", async () => {
    const result = await Provider.toExecutor(provider).execute({
      query: `{ root { id tags children { id children { id } } } }`,
      request: { method: "POST", url: "/graphql", headers: {}, body: null },
    });
    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({
      root: { id: "1", tags: ["a", "b"], children: [{ id: "1.1", children: [] }] },
    });
  });
});
