import { Context, Effect, Layer, Schema } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { Rpc } from "effect/unstable/rpc";
import { describe, expect, it } from "vitest";
import { Provider, ProviderRequest } from "../src/index.ts";

class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
}) {}

class Greeter extends Context.Service<Greeter, { readonly greet: (name: string) => string }>()(
  "test/serve/Greeter",
) {}

class CurrentUserId extends Context.Service<CurrentUserId, { readonly id: string }>()(
  "test/serve/CurrentUserId",
) {}

const provider = Provider.make({
  app: Layer.succeed(Greeter, { greet: (name) => `Hello, ${name}` }),
  request: Layer.effect(CurrentUserId)(
    Effect.gen(function*() {
      const request = yield* ProviderRequest;
      const header = request.headers["x-user"];
      return { id: typeof header === "string" ? header : "anon" };
    }),
  ),
  query: {
    me: Provider.field({
      rpc: Rpc.make("me", { success: User }),
      resolve: () =>
        Effect.gen(function*() {
          const greeter = yield* Greeter;
          const current = yield* CurrentUserId;
          return { id: current.id, name: greeter.greet(current.id) };
        }),
    }),
  },
});

describe("Provider.serve (effect-platform)", () => {
  it("serves a GraphQL POST end-to-end through the HttpApp", async () => {
    const app = Provider.serve(provider);
    const request = HttpServerRequest.fromWeb(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user": "linus" },
        body: JSON.stringify({ query: `{ me { id name } }` }),
      }),
    );

    const response = await Effect.runPromise(
      app.pipe(Effect.provideService(HttpServerRequest.HttpServerRequest, request)),
    );
    const webResponse = HttpServerResponse.toWeb(response);

    expect(webResponse.status).toBe(200);
    expect(await webResponse.json()).toEqual({ data: { me: { id: "linus", name: "Hello, linus" } } });
  });
});
