import { Effect, Layer, Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";
import { printSchema } from "graphql";
import { describe, expect, it } from "vitest";
import { Provider } from "../src/index.ts";

const Status = Schema.Literals(["Active", "Archived"]).annotate({ identifier: "Status" });

class Item extends Schema.Class<Item>("Item")({
  id: Schema.String,
  status: Status,
}) {}

const provider = Provider.make({
  app: Layer.empty,
  request: Layer.empty,
  query: {
    // optional enum in input position — was issue #22 (deriver threw "unsupported input ast 'Union'")
    items: Provider.field({
      rpc: Rpc.make("items", {
        payload: { status: Schema.optional(Status) },
        success: Schema.Array(Item),
      }),
      resolve: ({ status }) =>
        Effect.succeed(
          status === undefined
            ? [new Item({ id: "i1", status: "Active" }), new Item({ id: "i2", status: "Archived" })]
            : [new Item({ id: "i1", status }), new Item({ id: "i2", status })],
        ),
    }),
  },
});

const run = (query: string) =>
  Provider.toExecutor(provider).execute({
    query,
    request: { method: "POST", url: "/", headers: {}, body: null },
  });

describe("optional enum in input position (#22)", () => {
  it("derives the enum and marks the arg as nullable in the SDL", () => {
    const sdl = printSchema(Provider.toSchema(provider));
    // enum is emitted
    expect(sdl).toContain("enum Status");
    expect(sdl).toContain("Active");
    expect(sdl).toContain("Archived");
    // arg is nullable (no "!" after Status)
    expect(sdl).toMatch(/items\(status: Status\)/);
  });

  it("accepts a query that omits the optional arg", async () => {
    const result = await run(`{ items { id status } }`);
    expect(result.errors).toBeUndefined();
    expect(result.data?.["items"]).toEqual([
      { id: "i1", status: "Active" },
      { id: "i2", status: "Archived" },
    ]);
  });

  it("accepts a query that supplies the enum value", async () => {
    const result = await run(`{ items(status: Archived) { id status } }`);
    expect(result.errors).toBeUndefined();
    const items = result.data?.["items"] as ReadonlyArray<{ id: string; status: string }>;
    expect(items).toHaveLength(2);
    for (const it of items) expect(it.status).toBe("Archived");
  });
});
