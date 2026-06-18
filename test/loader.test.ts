import { Context, Effect, Layer, Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";
import { describe, expect, it } from "vitest";
import { createLoader, type Loader, Provider } from "../src/index.ts";

class Item extends Schema.Class<Item>("Item")({ id: Schema.String }) {}

class LabelLoader extends Context.Service<LabelLoader, Loader<string, string>>()("test/LabelLoader") {}

describe("request-scoped tick-batched loader", () => {
  it("coalesces same-tick loads across sibling resolvers into one batch call", async () => {
    const batchCalls: Array<ReadonlyArray<string>> = [];

    const provider = Provider.make({
      app: Layer.empty,
      request: Layer.effect(LabelLoader)(
        createLoader((keys: ReadonlyArray<string>) =>
          Effect.sync(() => {
            batchCalls.push(keys);
            return keys.map((k) => `label:${k}`);
          })
        ),
      ),
      query: {
        items: Provider.field({
          rpc: Rpc.make("items", { success: Schema.Array(Item) }),
          resolve: () => Effect.succeed([{ id: "1" }, { id: "2" }, { id: "1" }]),
        }),
      },
      augmentations: [
        Provider.augment(Item, Rpc.make("label", { success: Schema.String }), (self) =>
          Effect.gen(function*() {
            const loader = yield* LabelLoader;
            return yield* loader.load(self.id);
          })),
      ],
    });

    const result = await Provider.toExecutor(provider).execute({
      query: `{ items { label } }`,
      request: { method: "POST", url: "/graphql", headers: {}, body: null },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({
      items: [{ label: "label:1" }, { label: "label:2" }, { label: "label:1" }],
    });
    // three loads (two distinct keys, one repeat) -> a single batch of the distinct keys
    expect(batchCalls.length).toBe(1);
    expect([...batchCalls[0]].sort()).toEqual(["1", "2"]);
  });
});
