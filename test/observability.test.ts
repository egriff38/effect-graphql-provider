import { Effect, Layer, Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";
import { describe, expect, it } from "vitest";
import { Provider } from "../src/index.ts";

class Pong extends Schema.Class<Pong>("Pong")({ ok: Schema.Boolean }) {}

describe("observability", () => {
  it("runs each resolver inside a span named after the field", async () => {
    const spanNames: Array<string> = [];

    const provider = Provider.make({
      app: Layer.empty,
      request: Layer.empty,
      query: {
        ping: Provider.field({
          rpc: Rpc.make("ping", { success: Pong }),
          resolve: () =>
            Effect.gen(function*() {
              const span = yield* Effect.currentSpan; // present because the resolver is wrapped in a span
              spanNames.push(span.name);
              return { ok: true };
            }),
        }),
      },
    });

    const result = await Provider.toExecutor(provider).execute({
      query: `{ ping { ok } }`,
      request: { method: "POST", url: "/graphql", headers: {}, body: null },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({ ping: { ok: true } });
    expect(spanNames).toContain("graphql.ping");
  });
});
