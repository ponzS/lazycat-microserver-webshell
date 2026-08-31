import assert from "node:assert/strict";
import test from "node:test";

import {
  createTerminalCacheController,
  normalizeTerminalCacheWorkspaceIdentity,
  terminalCachePreviewFingerprint,
  terminalCacheWorkspaceIdentityKey,
} from "../runtime/static/terminal/history/index.js";

const createWindowHarness = () => {
  let nextHandle = 1;
  const idle = new Map();
  const timers = new Map();
  return {
    idle,
    timers,
    windowObject: {
      requestIdleCallback(callback) {
        const handle = nextHandle++;
        idle.set(handle, callback);
        return handle;
      },
      cancelIdleCallback(handle) {
        idle.delete(handle);
      },
      setTimeout(callback) {
        const handle = nextHandle++;
        timers.set(handle, callback);
        return handle;
      },
      clearTimeout(handle) {
        timers.delete(handle);
      },
    },
    runIdle() {
      const callbacks = Array.from(idle.values());
      idle.clear();
      callbacks.forEach((callback) => callback());
    },
  };
};

const workspaceIdentity = {
  cacheProtocolVersion: 2,
  cacheScopeID: "scope-1",
  selector: "target-1",
  workspaceGeneration: "workspace-1",
};

test("cache identity model rejects incomplete and client workspace identities", () => {
  const isClient = (name) => String(name).startsWith("client:");
  assert.equal(normalizeTerminalCacheWorkspaceIdentity({}, "target-1", isClient), null);
  assert.equal(normalizeTerminalCacheWorkspaceIdentity({
    selector: "client:phone",
    cache_protocol_version: 2,
    cache_scope_id: "scope",
    workspace_generation: "generation",
  }, "", isClient), null);
  assert.deepEqual(normalizeTerminalCacheWorkspaceIdentity({
    selector: "target-1",
    cache_protocol_version: 2,
    cache_scope_id: "scope-1",
    workspace_generation: "workspace-1",
  }, "", isClient), workspaceIdentity);
  assert.equal(terminalCacheWorkspaceIdentityKey(workspaceIdentity), '[2,"scope-1","target-1","workspace-1"]');
});

test("cache preview fingerprint keeps stable identity serialization", () => {
  assert.equal(
    terminalCachePreviewFingerprint({
      theme: "dark",
      foreground: "#ffffff",
      background: "#000000",
      fontSize: 14,
      fontFamily: "monospace",
      lineHeight: 1,
    }),
    '{"theme":"dark","foreground":"#ffffff","background":"#000000","fontSize":14,"fontFamily":"monospace","lineHeight":1}',
  );
});

test("cache controller owns workspace epoch and session protocol identity", () => {
  const controller = createTerminalCacheController({
    cacheV2: { available: true },
    legacyCache: {},
    isClientTarget: (name) => String(name).startsWith("client:"),
    getActiveName: () => "target-1",
  });
  const inputIdentity = { ...workspaceIdentity };
  assert.equal(controller.setWorkspaceIdentity(inputIdentity), true);
  inputIdentity.cacheScopeID = "mutated";
  assert.equal(controller.getWorkspaceIdentity().cacheScopeID, "scope-1");
  assert.equal(controller.getWorkspaceEpoch(), 1);
  assert.equal(controller.setWorkspaceIdentity({ ...workspaceIdentity }), false);

  const session = {
    cacheV2Epoch: 1,
    cacheV2WorkspaceIdentity: { ...workspaceIdentity },
    closed: false,
    historyGeneration: "history-1",
    id: "pane-1",
    name: "target-1",
    tabId: "tab-1",
  };
  assert.equal(controller.hasProtocol(session), true);
  assert.equal(controller.usesV2(session), true);
  assert.deepEqual(controller.identity(session), {
    ...workspaceIdentity,
    historyGeneration: "history-1",
    paneID: "pane-1",
    tabID: "tab-1",
  });
  session.cacheV2Epoch = 0;
  assert.equal(controller.hasProtocol(session), false);
  assert.equal(controller.usesLegacy({ name: "client:phone" }), true);
});

test("orphan preview cleanup is lifecycle-owned and rejects stale workspace callbacks", async () => {
  const clock = createWindowHarness();
  const cleanups = [];
  const logs = [];
  let renders = 0;
  const pane = { closed: false, id: "pane-1", name: "target-1" };
  const controller = createTerminalCacheController({
    windowObject: clock.windowObject,
    cacheV2: {
      available: true,
      cleanupOrphanedPreviews(options) {
        cleanups.push(options);
        return Promise.resolve({ removedPreviews: 1 });
      },
    },
    legacyCache: {},
    getActiveName: () => "target-1",
    getTabs: () => [{ id: "tab-1", panes: new Map([[pane.id, pane]]) }],
    appendDebugLog: (...args) => logs.push(args),
    scheduleOverviewRender: () => { renders += 1; },
  });
  controller.setWorkspaceIdentity(workspaceIdentity);
  assert.equal(controller.scheduleOrphanPreviewCleanup(), true);
  assert.equal(controller.scheduleOrphanPreviewCleanup(), false);
  assert.equal(clock.idle.size, 1);
  clock.runIdle();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(cleanups.length, 1);
  assert.deepEqual(cleanups[0].paneIdentities, [{ tabID: "tab-1", paneID: "pane-1" }]);
  assert.equal(logs.length, 1);
  assert.equal(renders, 1);

  assert.equal(controller.scheduleOrphanPreviewCleanup(), true);
  controller.setWorkspaceIdentity({ ...workspaceIdentity, workspaceGeneration: "workspace-2" });
  assert.equal(clock.idle.size, 0);
  assert.equal(controller.dispose(), true);
  assert.equal(controller.scheduleOrphanPreviewCleanup(), false);
  assert.equal(controller.dispose(), false);
});

test("recovery metrics use the recent workspace timing and report only once", () => {
  const traces = [];
  const reports = [];
  let currentNow = 140;
  const controller = createTerminalCacheController({
    cacheV2: { available: true },
    legacyCache: {},
    getActiveName: () => "target-1",
    getLatestWorkspaceRecoveryMetrics: () => ({
      readyAt: 120,
      selector: "target-1",
      startedAt: 100,
    }),
    getStartupMetrics: () => ({ navigationStartedAt: 50, moduleStartedAt: 60 }),
    now: () => currentNow,
    appendStartupTrace: (...args) => traces.push(args),
    consoleObject: { info: (...args) => reports.push(args) },
  });
  controller.setWorkspaceIdentity(workspaceIdentity);
  const session = {
    cacheV2Epoch: 1,
    cacheV2WorkspaceIdentity: { ...workspaceIdentity },
    closed: false,
    id: "pane-1",
    name: "target-1",
    replayComplete: false,
    terminalReplayGeneration: 3,
  };
  const metrics = controller.startRecoveryMetrics(session);
  assert.equal(metrics.startedAt, 100);
  assert.equal(metrics.workspaceReadyAt, 120);
  currentNow = 170;
  assert.equal(controller.markRecoveryMetric(session, "realCanvasVisibleAt"), true);
  assert.equal(controller.markRecoveryMetric(session, "realCanvasVisibleAt"), false);
  assert.equal(controller.reportRecoveryMetrics(session), false);
  session.replayComplete = true;
  assert.equal(controller.reportRecoveryMetrics(session), true);
  assert.equal(controller.reportRecoveryMetrics(session), false);
  assert.equal(traces.length, 1);
  assert.equal(reports.length, 1);
});
