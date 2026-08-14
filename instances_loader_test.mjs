import assert from "node:assert/strict";
import test from "node:test";

import { createInstancesLoader } from "./runtime/static/instances_loader.js";

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
});

test("transient gateway failures retry and share one inflight load", async () => {
  const replies = [
    response(502, "admin-info is starting"),
    response(503, JSON.stringify({ error: "instances are not ready" })),
    response(200, JSON.stringify([{ name: "alpha", status: "running" }])),
  ];
  const waits = [];
  let fetches = 0;
  const loader = createInstancesLoader({
    fetchImpl: async () => {
      fetches += 1;
      return replies.shift();
    },
    retryDelays: [10, 20],
    wait: async (delay) => waits.push(delay),
  });

  const first = loader.load();
  const second = loader.load();
  assert.strictEqual(second, first);
  assert.deepEqual(await first, [{ name: "alpha", status: "running" }]);
  assert.equal(fetches, 3);
  assert.deepEqual(waits, [10, 20]);
});

test("network errors retry but authorization failures do not", async () => {
  let networkFetches = 0;
  const networkLoader = createInstancesLoader({
    fetchImpl: async () => {
      networkFetches += 1;
      if (networkFetches === 1) {
        throw new Error("connection refused");
      }
      return response(200, "[]");
    },
    retryDelays: [0],
    wait: async () => {},
  });
  assert.deepEqual(await networkLoader.load(), []);
  assert.equal(networkFetches, 2);

  let authorizationFetches = 0;
  const authorizationLoader = createInstancesLoader({
    fetchImpl: async () => {
      authorizationFetches += 1;
      return response(403, "account cannot access instances");
    },
    retryDelays: [0, 0],
    wait: async () => {},
  });
  await assert.rejects(
    authorizationLoader.load(),
    /Failed to load instances \(403\): account cannot access instances/,
  );
  assert.equal(authorizationFetches, 1);
});

test("final gateway error includes the provider stage detail", async () => {
  let fetches = 0;
  const loader = createInstancesLoader({
    fetchImpl: async () => {
      fetches += 1;
      return response(504, JSON.stringify({
        error: "instances client-instances upstream failed after 3 attempt(s): gateway timeout",
      }));
    },
    retryDelays: [0],
    wait: async () => {},
  });
  await assert.rejects(
    loader.load(),
    /client-instances upstream failed after 3 attempt\(s\): gateway timeout/,
  );
  assert.equal(fetches, 2);
});

test("invalid successful JSON is not retried", async () => {
  let fetches = 0;
  const loader = createInstancesLoader({
    fetchImpl: async () => {
      fetches += 1;
      return response(200, "not-json");
    },
    retryDelays: [0, 0],
    wait: async () => {},
  });
  await assert.rejects(loader.load(), /Invalid instances response/);
  assert.equal(fetches, 1);
});

test("disposing a load prevents a late response from updating instance state", async () => {
  let resolveFetch;
  let applied = null;
  const loader = createInstancesLoader({
    fetchImpl: () => new Promise((resolve) => {
      resolveFetch = resolve;
    }),
    onInstances: (instances) => {
      applied = instances;
    },
  });
  const pending = loader.load();
  loader.dispose();
  resolveFetch(response(200, `[{"name":"late"}]`));

  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(applied, null);
});
