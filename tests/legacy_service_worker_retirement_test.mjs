import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const workerPath = new URL(
  "../runtime/static/app/bootstrap/legacy_service_worker_retirement.js",
  import.meta.url,
);

const dispatchExtendableEvent = async (listener) => {
  let pending = null;
  listener({
    waitUntil(value) {
      pending = Promise.resolve(value);
    },
  });
  assert.ok(pending, "worker event must extend its lifetime");
  await pending;
};

test("retirement worker unregisters itself, removes only legacy caches, and reloads controlled windows", async () => {
  const source = await readFile(workerPath, "utf8");
  const listeners = new Map();
  const events = [];
  const deleted = [];
  let matchOptions = null;
  const clients = [
    {
      url: "https://example.test/webshell/?name=one",
      navigate: async (url) => events.push(`navigate:${url}`),
    },
    {
      url: "https://example.test/webshell/?name=two",
      navigate() {
        events.push("navigate:two");
        throw new Error("closed client");
      },
    },
  ];
  const selfObject = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    async skipWaiting() {
      events.push("skip-waiting");
    },
    clients: {
      async matchAll(options) {
        matchOptions = { ...options };
        events.push("match-clients");
        return clients;
      },
    },
    registration: {
      async unregister() {
        events.push("unregister");
        return true;
      },
    },
  };
  const cacheStorage = {
    async keys() {
      events.push("cache-keys");
      return [
        "lcmd-webshell-app-shell-old",
        "lcmd-webshell-terminal-v2",
        "another-app-cache",
      ];
    },
    async delete(name) {
      deleted.push(name);
      events.push(`cache-delete:${name}`);
      if (name === "lcmd-webshell-app-shell-old") {
        throw new Error("cache already removed");
      }
      return true;
    },
  };

  vm.runInNewContext(source, {
    caches: cacheStorage,
    self: selfObject,
  }, { filename: workerPath.pathname });

  assert.equal(listeners.has("fetch"), false);
  assert.equal(listeners.has("install"), true);
  assert.equal(listeners.has("activate"), true);

  await dispatchExtendableEvent(listeners.get("install"));
  await dispatchExtendableEvent(listeners.get("activate"));

  assert.deepEqual(matchOptions, { type: "window" });
  assert.deepEqual(deleted.sort(), [
    "lcmd-webshell-app-shell-old",
    "lcmd-webshell-terminal-v2",
  ]);
  assert.ok(events.indexOf("unregister") > events.indexOf("cache-keys"));
  assert.ok(events.indexOf("navigate:https://example.test/webshell/?name=one") > events.indexOf("unregister"));
  assert.ok(events.includes("navigate:two"));
});

test("retirement worker has no cache, fetch, or client-claim implementation", async () => {
  const source = await readFile(workerPath, "utf8");
  for (const forbidden of [
    'addEventListener("fetch"',
    "caches.open(",
    "clients.claim(",
    "includeUncontrolled",
    "manifest.webmanifest",
  ]) {
    assert.equal(source.includes(forbidden), false, `unexpected retirement behavior: ${forbidden}`);
  }
});
