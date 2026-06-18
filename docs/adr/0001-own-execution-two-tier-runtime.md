# Own GraphQL execution on effect-platform; two-tier runtime

The Provider owns request execution: it serves the derived GraphQL schema from an effect-platform `HttpApp`/`HttpRouter` route that builds a per-request Effect `Context` + `Scope`, runs `graphql()` with resolvers bound to a long-lived app `Runtime`, and finalizes the scope on response. Foreign servers (Yoga, Apollo) are optional thin *adapters*.

The runtime is two-tier: an app `Layer` is built once at startup (pools, config) and backs a long-lived `Runtime`; per request we build a request `Context` from a user-supplied `Layer<RequestServices, E, ProviderRequest | AppServices>`, evaluated inside the request `Scope`. Auth and dataloaders are ordinary services in that layer (loaders via `Layer.scoped` get the correct request lifetime). The boundary to adapters is an abstract `ProviderRequest` (headers/method/url/body): each adapter populates it from its native request, so the request layer never depends on a concrete transport. A resolver's requirements `R` are satisfied by app services ∪ request services.

## Considered Options

- **BYO-server (emit schema + context factory only)** — rejected: cedes control of the scope/error/tracing lifecycle and pushes every integration onto the host.
- **Equal-weight per-server adapters, no primary** — rejected: maximal portability but a large surface to build and keep in sync before anything ships.
- **Single global Layer / fresh-Layer-per-request** — rejected: no request-scoped cleanup (loader-cache leakage across requests) / rebuilds expensive services every request.

## Consequences

- The derived schema stays standard graphql-js, so adapters remain thin (just the context bridge).
- The native RPC transport for root operations (issue #3) shares this same runtime.
- The prototype's `R = never` on resolvers is a stopgap to be replaced by this model.
