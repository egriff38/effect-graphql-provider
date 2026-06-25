import { Effect, Layer, Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";
import { printSchema } from "graphql";
import { describe, expect, it } from "vitest";
import { Provider } from "../src/index.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Interface base + two TaggedClass implementers
// ─────────────────────────────────────────────────────────────────────────────

class Node extends Schema.Class<Node>("Node")(
  {
    id: Schema.String.annotate({ graphql: { id: true } }),
    createdAt: Schema.String,
  },
  { graphql: { interface: true } },
) {}

class User extends Schema.TaggedClass<User>("User")(
  "User",
  {
    id: Schema.String.annotate({ graphql: { id: true } }),
    createdAt: Schema.String,
    name: Schema.String,
  },
  { graphql: { implements: [Node] } },
) {}

class Post extends Schema.TaggedClass<Post>("Post")(
  "Post",
  {
    id: Schema.String.annotate({ graphql: { id: true } }),
    createdAt: Schema.String,
    title: Schema.String,
  },
  { graphql: { implements: [Node] } },
) {}

const provider = Provider.make({
  app: Layer.empty,
  request: Layer.empty,
  query: {
    user: Provider.field({
      rpc: Rpc.make("user", { success: User }),
      resolve: () => Effect.succeed(new User({ id: "u1", createdAt: "2024-01-01", name: "Ada" })),
    }),
    post: Provider.field({
      rpc: Rpc.make("post", { success: Post }),
      resolve: () => Effect.succeed(new Post({ id: "p1", createdAt: "2024-01-02", title: "Hi" })),
    }),
  },
});

const run = (query: string) =>
  Provider.toExecutor(provider).execute({
    query,
    request: { method: "POST", url: "/", headers: {}, body: null },
  });

describe("interfaces from shared-base classes (#21)", () => {
  it("emits a GraphQLInterfaceType for the annotated base", () => {
    const sdl = printSchema(Provider.toSchema(provider));
    expect(sdl).toMatch(/interface Node \{[^}]*id: ID![^}]*createdAt: String![^}]*\}/s);
  });

  it("emits `implements Node` on each implementer object type", () => {
    const sdl = printSchema(Provider.toSchema(provider));
    expect(sdl).toMatch(/type User implements Node/);
    expect(sdl).toMatch(/type Post implements Node/);
  });

  it("preserves all interface fields on the implementer (id + createdAt)", () => {
    const sdl = printSchema(Provider.toSchema(provider));
    expect(sdl).toMatch(/type User implements Node \{[^}]*id: ID![^}]*createdAt: String![^}]*name: String![^}]*\}/s);
  });

  it("returns the concrete implementer for a query that asks for interface fields", async () => {
    // Query 'user' (returns User which implements Node) and ask for both common + specific fields.
    const result = await run(`{ user { __typename id createdAt name } }`);
    expect(result.errors).toBeUndefined();
    expect(result.data?.["user"]).toEqual({
      __typename: "User",
      id: "u1",
      createdAt: "2024-01-01",
      name: "Ada",
    });
  });
});

describe("interface validation errors", () => {
  it("rejects an `implements` entry whose schema lacks `interface: true`", () => {
    class NotAnInterface extends Schema.Class<NotAnInterface>("NotAnInterface")({
      id: Schema.String,
    }) {}
    class Bad extends Schema.TaggedClass<Bad>("Bad")(
      "Bad",
      { id: Schema.String },
      { graphql: { implements: [NotAnInterface] } },
    ) {}
    expect(() =>
      Provider.toSchema(
        Provider.make({
          app: Layer.empty,
          request: Layer.empty,
          query: {
            bad: Provider.field({
              rpc: Rpc.make("bad", { success: Bad }),
              resolve: () => Effect.succeed(new Bad({ id: "x" })),
            }),
          },
        }),
      )
    ).toThrow(/interface: true/);
  });
});
