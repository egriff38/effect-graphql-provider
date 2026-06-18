import { Context, Effect, Layer, Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";
import { describe, expect, it } from "vitest";
import { Provider, ProviderRequest } from "../src/index.ts";

// A type (pure shape).
class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
}) {}

// App-scoped service (built once).
class Greeter extends Context.Service<Greeter, { readonly greet: (name: string) => string }>()(
  "test/Greeter",
) {}

// Request-scoped service (built per request from ProviderRequest), with a finalizer so we can
// observe the request scope closing.
class CurrentUserId extends Context.Service<CurrentUserId, { readonly id: string }>()(
  "test/CurrentUserId",
) {}

describe("two-tier runtime", () => {
  it("provides app + request services to a resolver and finalizes the request scope", async () => {
    let finalized = false;

    const appLayer = Layer.succeed(Greeter, { greet: (name) => `Hello, ${name}` });

    const requestLayer = Layer.effect(CurrentUserId)(
      Effect.gen(function*() {
        const request = yield* ProviderRequest;
        yield* Effect.addFinalizer(() => Effect.sync(() => { finalized = true; }));
        const header = request.headers["x-user"];
        return { id: typeof header === "string" ? header : "anon" };
      }),
    );

    const provider = Provider.make({
      app: appLayer,
      request: requestLayer,
      query: {
        me: Provider.field({
          rpc: Rpc.make("me", { success: User }),
          resolve: () =>
            Effect.gen(function*() {
              const greeter = yield* Greeter; // app service
              const current = yield* CurrentUserId; // request service
              return { id: current.id, name: greeter.greet(current.id) };
            }),
        }),
      },
    });

    const executor = Provider.toExecutor(provider);
    try {
      const result = await executor.execute({
        query: `{ me { id name } }`,
        request: { method: "POST", url: "/graphql", headers: { "x-user": "ada" }, body: null },
      });

      expect(result.errors).toBeUndefined();
      expect(result.data).toEqual({ me: { id: "ada", name: "Hello, ada" } });
      expect(finalized).toBe(true); // request scope finalized after the operation
    } finally {
      await executor.dispose();
    }
  });
});
