import { Context, Effect, Layer, Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";
import { describe, expect, it } from "vitest";
import { createLoader, type Loader, Provider } from "../src/index.ts";

class L extends Context.Service<L, Loader<string, string>>()("test/xreq/L") {}

describe("cross-request isolation", () => {
  it("gives each request its own loader cache and finalizes its scope", async () => {
    const batches: Array<ReadonlyArray<string>> = [];
    let finalizes = 0;

    const provider = Provider.make({
      app: Layer.empty,
      request: Layer.effect(L)(
        Effect.gen(function*() {
          yield* Effect.addFinalizer(() => Effect.sync(() => { finalizes++; }));
          return yield* createLoader((keys: ReadonlyArray<string>) =>
            Effect.sync(() => {
              batches.push(keys);
              return keys.map((k) => `v:${k}`);
            })
          );
        }),
      ),
      query: {
        label: Provider.field({
          rpc: Rpc.make("label", { payload: { id: Schema.String }, success: Schema.String }),
          resolve: ({ id }: { id: string }) =>
            Effect.gen(function*() {
              const loader = yield* L;
              return yield* loader.load(id);
            }),
        }),
      },
    });

    const executor = Provider.toExecutor(provider);
    const q = `{ label(id: "1") }`;
    const r1 = await executor.execute({ query: q, request: { method: "POST", url: "/", headers: {}, body: null } });
    const r2 = await executor.execute({ query: q, request: { method: "POST", url: "/", headers: {}, body: null } });

    expect(r1.data).toEqual({ label: "v:1" });
    expect(r2.data).toEqual({ label: "v:1" });
    // a shared cache would batch only once; isolation => each request batches independently
    expect(batches.length).toBe(2);
    // each request's scope finalized
    expect(finalizes).toBe(2);
  });
});
