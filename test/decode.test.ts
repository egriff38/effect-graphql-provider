import { Effect, Layer, Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";
import { describe, expect, it } from "vitest";
import { Provider } from "../src/index.ts";

class Greeting extends Schema.Class<Greeting>("Greeting")({ text: Schema.String }) {}

const provider = Provider.make({
  app: Layer.empty,
  request: Layer.empty,
  query: {
    // `name` is NonEmptyString: graphql derives it as `String` (accepts ""), but the payload
    // decode rejects "" — proving Schema-level validation runs before the resolver.
    greet: Provider.field({
      rpc: Rpc.make("greet", { payload: { name: Schema.NonEmptyString }, success: Greeting }),
      resolve: ({ name }: { name: string }) => Effect.succeed({ text: `Hi ${name}` }),
    }),
  },
});

const run = (query: string) =>
  Provider.toExecutor(provider).execute({
    query,
    request: { method: "POST", url: "/graphql", headers: {}, body: null },
  });

describe("payload decode", () => {
  it("runs the resolver when args satisfy the payload schema", async () => {
    const result = await run(`{ greet(name: "Ada") { text } }`);
    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({ greet: { text: "Hi Ada" } });
  });

  it("rejects args that fail Schema validation (before the resolver) -> errors[]", async () => {
    const result = await run(`{ greet(name: "") { text } }`);
    expect(result.errors).toBeDefined();
    expect(result.errors?.length ?? 0).toBeGreaterThan(0);
  });
});
