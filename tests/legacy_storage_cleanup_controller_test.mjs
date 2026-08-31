import assert from "node:assert/strict";
import test from "node:test";

import { createLegacyWebShellStorageCleanupController } from "../runtime/static/app/bootstrap/legacy_storage_cleanup_controller.js";

test("legacy cleanup unregisters only this WebShell worker and known caches", async () => {
  const unregistered = [];
  const deleted = [];
  const registration = (scriptURL, id) => ({
    active: { scriptURL },
    unregister: async () => unregistered.push(id),
  });
  const controller = createLegacyWebShellStorageCleanupController({
    windowObject: { location: { href: "https://example.test/webshell/?name=demo" } },
    navigatorObject: {
      serviceWorker: {
        getRegistrations: async () => [
          registration("https://example.test/webshell/service-worker.js", "webshell"),
          registration("https://example.test/other/service-worker.js", "other"),
        ],
      },
    },
    cacheStorage: {
      keys: async () => ["lcmd-webshell-app-shell-old", "lcmd-webshell-terminal-v2", "another-app-cache"],
      delete: async (name) => deleted.push(name),
    },
  });

  assert.equal(await controller.cleanup(), true);
  assert.deepEqual(unregistered, ["webshell"]);
  assert.deepEqual(deleted.sort(), ["lcmd-webshell-app-shell-old", "lcmd-webshell-terminal-v2"]);
  assert.equal(await controller.cleanup(), true);
  assert.deepEqual(unregistered, ["webshell"]);
});

test("disposed cleanup controller does not mutate browser storage", async () => {
  let registrationsRead = 0;
  const controller = createLegacyWebShellStorageCleanupController({
    navigatorObject: { serviceWorker: { getRegistrations: async () => { registrationsRead += 1; return []; } } },
    cacheStorage: { keys: async () => [] },
  });
  controller.dispose();
  assert.equal(await controller.cleanup(), false);
  assert.equal(registrationsRead, 0);
});
