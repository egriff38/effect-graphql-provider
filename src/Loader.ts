// Request-scoped, tick-batched loader (DataLoader semantics) — ADR 0003. `load` calls made in
// the same microtask are coalesced into a single `batch` call, so sibling GraphQL resolvers
// (which graphql-js invokes as separate fibers in one tick) collapse N+1 into one fetch.
// Provide it in a request `Layer` (Layer.effect) so its queue + cache reset per request.

import { Effect } from "effect";

export interface Loader<K, V> {
  readonly load: (key: K) => Effect.Effect<V, unknown, never>;
}

interface Pending<K, V> {
  readonly key: K;
  readonly resolve: (value: V) => void;
  readonly reject: (error: unknown) => void;
}

/**
 * Create a loader from a batch function. `batch` receives the coalesced keys and returns one
 * value per key (same order). Its required services `R` are captured at creation, so `load`
 * itself needs no services.
 */
export const createLoader = <K, V, E, R>(
  batch: (keys: ReadonlyArray<K>) => Effect.Effect<ReadonlyArray<V>, E, R>,
): Effect.Effect<Loader<K, V>, never, R> =>
  Effect.gen(function*() {
    const context = yield* Effect.context<R>();
    const cache = new Map<K, Promise<V>>();
    let queue: Array<Pending<K, V>> = [];
    let scheduled = false;

    const flush = () => {
      const pending = queue;
      queue = [];
      scheduled = false;
      const keys = pending.map((p) => p.key);
      Effect.runFork(
        batch(keys).pipe(
          Effect.provideContext(context),
          Effect.match({
            onSuccess: (values: ReadonlyArray<V>) => {
              pending.forEach((p, index) => p.resolve(values[index]));
            },
            onFailure: (error: E) => {
              pending.forEach((p) => p.reject(error));
            },
          }),
        ),
      );
    };

    const load = (key: K): Effect.Effect<V, unknown, never> =>
      Effect.tryPromise(() => {
        const cached = cache.get(key);
        if (cached) return cached;
        const promise = new Promise<V>((resolve, reject) => {
          queue.push({ key, resolve, reject });
          if (!scheduled) {
            scheduled = true;
            queueMicrotask(flush);
          }
        });
        cache.set(key, promise);
        return promise;
      });

    return { load };
  });
