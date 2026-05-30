// PROTOTYPE — throwaway domain wiring. Demonstrates: each type is ONE binding — a plain
// Schema piped through the typed annotators `withGqlIdentifier`/`withGqlFields` — with NO
// explicit const types and `source` fully inferred. The User<->Post recursion lives only in
// the resolver graph (the schemas themselves are flat), and is broken by a loose
// `Schema.suspend((): Schema.Top => Other)` back-edge — no base/wrapped split, no class.

import { Effect, HashMap, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import {
  type FieldImpl,
  type Roots,
  withGqlFields,
  withGqlIdentifier,
} from "./derive.ts";

// ---- in-memory store -----------------------------------------------------
interface UserRow {
  id: string;
  name: string;
}
interface PostRow {
  id: string;
  title: string;
  authorId: string;
}

const users: UserRow[] = [
  { id: "u1", name: "Ada" },
  { id: "u2", name: "Linus" },
];
const posts: PostRow[] = [
  { id: "p1", title: "On Algorithms", authorId: "u1" },
  { id: "p2", title: "Notes on Engines", authorId: "u1" },
  { id: "p3", title: "Kernel Hacking", authorId: "u2" },
];
const postRow = (id: string) => posts.find((p) => p.id === id)!;

// ---- resolution trace (the thing we watch) -------------------------------
export const trace: string[] = [];
export const resetTrace = () => {
  trace.length = 0;
};
const log = (s: string) => {
  trace.push(s);
};

// ---- types: ONE binding each; resolvers co-located via withGqlFields ------
// The schemas are flat ({id,name} / {id,title}); recursion is purely in the resolver graph.
// The loose `Schema.suspend((): Schema.Top => Other)` anchor breaks the type cycle without
// restating any shape — the deriver follows the thunk to the real AST at runtime.
class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
}) {}

class Post extends Schema.Class<Post>("Post")({
  id: Schema.String,
  title: Schema.String,
}) {}

const withGQLField = <S extends Schema.Top, R extends Rpc.Any>(
  schema: S,
  r: R,
  impl: (
    self: S["Type"],
    ...rest: Parameters<Rpc.ToHandlerFn<R>>
  ) => ReturnType<Rpc.ToHandlerFn<R>>,
) => {
  return [schema, r, impl] as const;
};
withGQLField(
  User,
  Rpc.make("posts", {
    payload: { first: Schema.Int },
    success: Schema.Array(Schema.suspend(() => Post)),
  }),
  Effect.fn(function* (a, { first }) {
    return [];
  }),
);

const queryUsers: FieldImpl = {
  rpc: Rpc.make("users", { success: Schema.Array(User) }),
  resolve: () =>
    Effect.sync(() => {
      log(`Query.users  source=<root>`);
      return users;
    }),
};

const createPost: FieldImpl = {
  rpc: Rpc.make("createPost", {
    payload: { authorId: Schema.String, title: Schema.String },
    success: Post,
  }),
  resolve: ({ authorId, title }: { authorId: string; title: string }) =>
    Effect.sync(() => {
      const row: PostRow = { id: `p${posts.length + 1}`, title, authorId };
      posts.push(row);
      log(
        `Mutation.createPost(authorId=${authorId}, title=${JSON.stringify(title)}) -> ${row.id}`,
      );
      return row;
    }),
};

// The whole provider: just the roots. Every other type is discovered by crawling.
export const roots: Roots = {
  query: { user: queryUser, users: queryUsers },
  mutation: { createPost },
  globalAugmentations: [
    createAugment(
      User,
      Rpc.make("posts", {
        payload: { first: Schema.Int },
        success: Schema.Array(Schema.suspend(() => Post)),
      }),
      Effect.fn(function* (a, { first }) {
        return [];
      }),
    ),
  ],
};

export const presetQueries: ReadonlyArray<{ label: string; query: string }> = [
  {
    label: "user + nested posts (per-field resolution, nested arg `first`)",
    query: `{ user(id: "u1") { name posts(first: 2) { title } } }`,
  },
  {
    label: "deep: users -> posts -> author (recursion via Schema.suspend)",
    query: `{ users { name posts(first: 1) { title author { name } } } }`,
  },
  {
    label: "mutation: createPost then select fields off the payload",
    query: `mutation { createPost(authorId: "u2", title: "Fresh Post") { id title author { name } } }`,
  },
  {
    label: "plain fields only (no resolvers fire)",
    query: `{ user(id: "u2") { id name } }`,
  },
];
