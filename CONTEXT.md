# effect-graphql-provider

A library for defining a GraphQL API from effect `Schema` types and Effect-based resolvers, and serving it.

## Language

**Provider**:
The GraphQL API this library produces and serves — defined as a set of root operations and augmentations over Schema-defined types. The package's namesake; the thing a user declares.
_Avoid_: provider layer, server, gateway

**Adapter**:
A server backend that serves a Provider over a transport (effect-platform is primary; Yoga, Apollo, others optional).
_Avoid_: provider, provider layer

**Augmentation**:
A relationship field layered onto an existing type from the Provider root, declared separately from that type's own shape. The mechanism for cross-type and recursive relationships.
_Avoid_: extension, plugin

**Root operation**:
A top-level entry field of the Provider — a query or mutation (subscription later) — reachable without a parent object. Distinguished from augmentations, which require a parent.
_Avoid_: endpoint

**Result union**:
The GraphQL union derived for a root operation or augmentation that declares typed errors — its success type plus one member per tagged error, mirroring the field's `Exit<A, E>`. Defects are not members (they are masked). A non-object success is wrapped so it can be a union member.
_Avoid_: error payload

**ProviderRequest**:
The transport-agnostic request the per-request context layer is built from — headers, method, URL, body. Each adapter populates it from its native request, keeping the request layer independent of any concrete server.
_Avoid_: HttpServerRequest, raw request

## Example dialogue

> **Dev:** Where does `User.posts` live — on the `User` type?
> **Expert:** No. `User` is just shape. `posts` is an *augmentation* — a relationship field layered onto `User` from the Provider root.
> **Dev:** And if I want to run it behind Apollo instead of effect-platform?
> **Expert:** That's an *adapter* choice. The Provider is unchanged; the adapter is the server backend that serves it. Don't call the adapter a "provider."
> **Dev:** Is `createPost` an augmentation too?
> **Expert:** No — it has no parent, so it's a *root operation*.
