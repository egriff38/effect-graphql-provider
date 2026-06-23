/**
 * Smoke test for examples/dev-server: spawns the server in a subprocess via
 * `node:child_process`, hits /graphiql and /graphql, then kills it. Catches
 * "did the example regress?" cheaply without trying to test hot-reload semantics.
 *
 * Uses port 3001 so a local `bun run dev` on 3000 doesn't collide.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PORT = 3001;
const BASE = `http://localhost:${PORT}`;

let server: ChildProcess;

const waitForListen = (proc: ChildProcess): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer): void => {
      if (chunk.toString().includes("Listening on")) {
        proc.stdout?.off("data", onData);
        resolve();
      }
    };
    proc.stdout?.on("data", onData);
    proc.once("exit", (code) => {
      reject(new Error(`dev server exited before listening (code=${code})`));
    });
  });

beforeAll(async () => {
  server = spawn("bun", ["examples/dev-server/main.ts"], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForListen(server);
}, 10_000); // vitest hook timeout (ms): bound how long beforeAll can take overall

afterAll(() => {
  server?.kill();
});

describe("dev-server smoke", () => {
  it("serves GraphiQL HTML at /graphiql with the right endpoint baked in", async () => {
    const res = await fetch(`${BASE}/graphiql`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");
    const body = await res.text();
    expect(body).toContain("<title>Blog Dev</title>");
    expect(body).toContain('"/graphql"');
    // GraphiQL CDN bundle URL fragment — pinned to a tested major version.
    expect(body).toMatch(/graphiql@\d/);
  });

  it("answers a GraphQL query at POST /graphql (read path, no auth required)", async () => {
    const res = await fetch(`${BASE}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `{ posts { id title status author { __typename ... on User { name } } } }`,
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as {
      readonly data?: { readonly posts?: Array<{ readonly id: string; readonly author: { readonly name?: string } }> };
    };
    expect(json.data?.posts?.length).toBeGreaterThan(0);
    expect(json.data?.posts?.[0]?.author?.name).toBeTruthy();
  });

  it("returns Forbidden as a typed-union member when `me` is queried unauthenticated", async () => {
    const res = await fetch(`${BASE}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `{ me { __typename ... on User { id } ... on Forbidden { reason } } }`,
      }),
    });
    const json = await res.json() as {
      readonly data?: { readonly me?: { readonly __typename: string; readonly reason?: string } };
    };
    expect(json.data?.me?.__typename).toBe("Forbidden");
    expect(json.data?.me?.reason).toContain("x-user");
  });

  it("authenticates via the x-user header and returns the User variant", async () => {
    const res = await fetch(`${BASE}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": "u1" },
      body: JSON.stringify({
        query: `{ me { __typename ... on User { id name createdAt } } }`,
      }),
    });
    const json = await res.json() as {
      readonly data?: { readonly me?: { readonly __typename: string; readonly id?: string; readonly createdAt?: string } };
    };
    expect(json.data?.me?.__typename).toBe("User");
    expect(json.data?.me?.id).toBe("u1");
    // DateTime scalar — ISO string round-trip
    expect(json.data?.me?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("derives PostStatus as an enum and accepts it in input position", async () => {
    const res = await fetch(`${BASE}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `{ postsByStatus(status: Published) { title status } }`,
      }),
    });
    const json = await res.json() as {
      readonly data?: { readonly postsByStatus?: Array<{ readonly status: string }> };
    };
    expect(json.data?.postsByStatus?.length).toBeGreaterThan(0);
    for (const post of json.data?.postsByStatus ?? []) {
      expect(post.status).toBe("Published");
    }
  });

  it("traverses the cross-augmentation graph (User.posts → Post.comments → Comment.author)", async () => {
    const res = await fetch(`${BASE}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `{
          user(id: "u1") {
            __typename
            ... on User {
              posts {
                comments {
                  body
                  author { __typename ... on User { name } }
                }
              }
            }
          }
        }`,
      }),
    });
    type UserView = { readonly __typename: string; readonly posts?: Array<{ readonly comments: Array<{ readonly author: { readonly name?: string } }> }> };
    const json = await res.json() as { readonly data?: { readonly user?: UserView } };
    expect(json.data?.user?.__typename).toBe("User");
    const allCommenterNames = (json.data?.user?.posts ?? []).flatMap((p) =>
      p.comments.map((c) => c.author.name).filter((x): x is string => Boolean(x))
    );
    expect(allCommenterNames.length).toBeGreaterThan(0);
  });
});
