import { Effect, Layer, Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";
import { printSchema } from "graphql";
import { describe, expect, it } from "vitest";
import { Provider } from "../src/index.ts";

class Address extends Schema.Class<Address>("Address")({
  street: Schema.String,
  city: Schema.String,
}) {}

class User extends Schema.Class<User>("User")({
  id: Schema.String,
  address: Address, // Address in OUTPUT position
}) {}

const provider = Provider.make({
  app: Layer.empty,
  request: Layer.empty,
  query: {
    user: Provider.field({
      rpc: Rpc.make("user", { success: User }),
      resolve: () => Effect.succeed({ id: "u1", address: { street: "1 St", city: "Town" } }),
    }),
  },
  mutation: {
    updateAddress: Provider.field({
      // Address in INPUT position (a structured argument)
      rpc: Rpc.make("updateAddress", { payload: { userId: Schema.String, address: Address }, success: User }),
      resolve: () => Effect.succeed({ id: "u1", address: { street: "2 St", city: "Town" } }),
    }),
  },
});

describe("input/output type split", () => {
  it("derives a distinct *Input type for a shape used as an argument", () => {
    const sdl = printSchema(Provider.toSchema(provider));
    expect(sdl).toContain("type Address {"); // output object
    expect(sdl).toContain("input AddressInput {"); // distinct input object
    expect(sdl).toContain("address: Address!"); // output position on User
    expect(sdl).toContain("updateAddress(userId: String!, address: AddressInput!): User!");
  });
});
