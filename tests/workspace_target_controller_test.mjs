import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkspaceTargetController,
  createWorkspaceTargetLifecycle,
} from "../runtime/static/workspace/index.js";

test("target lifecycle owns selector, generation, stale checks, and disposal", () => {
  const lifecycle = createWorkspaceTargetLifecycle({ initialName: "alpha@deploy-a" });
  assert.equal(lifecycle.getActiveName(), "alpha@deploy-a");
  assert.equal(lifecycle.getGeneration(), 0);
  assert.equal(lifecycle.isCurrent("alpha@deploy-a", 0), true);
  assert.equal(lifecycle.setName(" beta@deploy-b "), 1);
  assert.equal(lifecycle.getActiveName(), "beta@deploy-b");
  assert.equal(lifecycle.isCurrent("alpha@deploy-a", 0), false);
  assert.equal(lifecycle.dispose(), true);
  assert.equal(lifecycle.isCurrent("beta@deploy-b", 1), false);
  assert.equal(lifecycle.setName("gamma"), 2);
  assert.equal(lifecycle.dispose(), false);
});

test("target controller orders target cleanup, reset, URL, and refresh", async () => {
  const calls = [];
  let disposed = false;
  const controller = createWorkspaceTargetController({
    initialName: "alpha",
    isDisposed: () => disposed,
    clearRefreshRetry: () => calls.push("clear-retry"),
    hideStartupError: () => calls.push("hide-error"),
    invalidateWorkspaceGeneration: () => calls.push("invalidate-workspace"),
    syncNetworkSockets: (options) => calls.push(["network", options]),
    onTargetChange: (event) => calls.push(["target", event.previousName, event.name, event.generation]),
    resetWorkspace: () => calls.push("reset-workspace"),
    updateLocation: (name, options) => calls.push(["location", name, options]),
    refreshWorkspaceWithRetry: async (options) => calls.push(["refresh", options]),
  });
  assert.equal(await controller.switchTo(" beta "), true);
  assert.equal(controller.getActiveName(), "beta");
  assert.equal(controller.getGeneration(), 1);
  assert.deepEqual(calls, [
    "clear-retry",
    "hide-error",
    "invalidate-workspace",
    ["network", { reset: true }],
    ["target", "alpha", "beta", 1],
    ["location", "beta", { replace: false, tabId: "" }],
    "reset-workspace",
    ["refresh", { focus: true, instanceName: "beta", generation: 1 }],
  ]);
  assert.equal(await controller.switchTo("beta"), false);
  disposed = true;
  assert.equal(controller.setActiveName("gamma"), 1);
  assert.equal(controller.dispose(), true);
  assert.equal(controller.dispose(), false);
});

test("target controller rejects stale sessions after a switch", () => {
  const controller = createWorkspaceTargetController({ initialName: "alpha" });
  const generation = controller.getGeneration();
  assert.equal(controller.isCurrentRequest("alpha", generation), true);
  assert.equal(controller.isCurrentSession({ name: "alpha" }), true);
  controller.setActiveName("beta");
  assert.equal(controller.isCurrentRequest("alpha", generation), false);
  assert.equal(controller.isCurrentSession({ name: "alpha" }), false);
  assert.equal(controller.isCurrentSession({ name: "beta" }), true);
});
