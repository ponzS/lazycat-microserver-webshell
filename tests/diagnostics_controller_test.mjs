import assert from "node:assert/strict";
import test from "node:test";

import {
  createDiagnosticsController,
  createStartupDiagnostics,
} from "../runtime/static/diagnostics/index.js";

class FakeElement {
  constructor() {
    this.children = [];
    this.className = "";
    this.classList = { add() {} };
    this.dataset = {};
    this.disabled = false;
    this.hidden = false;
    this.checked = false;
    this.isConnected = false;
    this.listeners = new Map();
    this.scrollHeight = 0;
    this.scrollTop = 0;
    this.textContent = "";
    this.title = "";
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  append(...children) {
    for (const child of children) {
      this.appendChild(child);
    }
  }

  appendChild(child) {
    child.isConnected = true;
    this.children.push(child);
    this.scrollHeight = this.children.length;
    return child;
  }

  dispatch(type) {
    for (const listener of Array.from(this.listeners.get(type) || [])) {
      listener({ type, target: this });
    }
  }

  remove() {
    this.isConnected = false;
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  setAttribute(name, value) {
    this[name] = String(value);
  }
}

const diagnosticElementIDs = [
  "debugLogPanel",
  "debugLogList",
  "debugLogCopy",
  "debugLogClear",
  "initializationPerformancePanel",
  "initializationPerformanceStatus",
  "initializationPerformanceCopy",
  "initializationPerformanceTotal",
  "initializationPerformanceList",
  "performanceTaskMeter",
  "performanceTaskMeterList",
  "settingsDebugModeToggle",
  "settingsDebugLogToggle",
  "settingsNetworkMonitorToggle",
  "settingsDebugOptions",
  "settingsPerformanceMeterToggle",
  "settingsPerformanceTasksToggle",
  "settingsInitializationPerformanceToggle",
  "terminalNetworkMonitor",
  "terminalNetworkMonitorStatus",
  "terminalNetworkMonitorChannels",
  "terminalNetworkMonitorRate",
  "terminalNetworkMonitorRateDetail",
  "terminalNetworkMonitorUsage",
  "terminalNetworkMonitorUsageDetail",
];

const createHarness = () => {
  const elements = new Map(diagnosticElementIDs.map((id) => [id, new FakeElement()]));
  const documentObject = {
    createElement: () => new FakeElement(),
    getElementById: (id) => elements.get(id) || null,
  };
  const storageValues = new Map([
    ["webshell.debugMode", "true"],
    ["webshell.debugLog", "true"],
    ["webshell.networkMonitor", "true"],
    ["webshell.performanceMeter", "true"],
    ["webshell.performanceTasks", "true"],
  ]);
  const storage = {
    getItem: (key) => storageValues.get(key) || null,
    setItem: (key, value) => storageValues.set(key, String(value)),
  };
  const windowListeners = new Map();
  const intervals = new Set();
  const frames = new Set();
  let nextID = 1;
  const windowObject = {
    addEventListener(type, listener) {
      const listeners = windowListeners.get(type) || new Set();
      listeners.add(listener);
      windowListeners.set(type, listeners);
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    removeEventListener(type, listener) {
      windowListeners.get(type)?.delete(listener);
    },
    requestAnimationFrame() {
      const id = nextID++;
      frames.add(id);
      return id;
    },
    setInterval() {
      const id = nextID++;
      intervals.add(id);
      return id;
    },
  };
  const consoleObject = {
    error() {},
    warn() {},
  };
  return {
    consoleObject,
    documentObject,
    elements,
    frames,
    intervals,
    storage,
    storageValues,
    terminalArea: new FakeElement(),
    windowListeners,
    windowObject,
  };
};

test("diagnostics owns debug resources and rejects a late network monitor load after disable", async () => {
  const harness = createHarness();
  const originalWarn = harness.consoleObject.warn;
  let resolveNetworkModule;
  let monitorCreations = 0;
  let debugModeChanges = 0;
  const copiedInitializationData = [];
  const networkModulePromise = new Promise((resolve) => {
    resolveNetworkModule = resolve;
  });
  const controller = createDiagnosticsController({
    ...harness,
    startupDiagnostics: createStartupDiagnostics({ now: () => 10 }),
    getNetworkContext: () => ({ layout: "unified", online: true, retrying: false, sockets: [] }),
    networkModuleLoader: () => networkModulePromise,
    onDebugModeChange: () => {
      debugModeChanges += 1;
    },
    copyText: async (text) => {
      copiedInitializationData.push(text);
      return true;
    },
    now: () => 20,
  });

  assert.notEqual(harness.consoleObject.warn, originalWarn);
  controller.start();
  controller.start();
  assert.equal(debugModeChanges, 1);
  assert.equal(harness.frames.size, 1);
  assert.equal(harness.windowListeners.get("error")?.size, 1);

  assert.equal(harness.elements.get("settingsInitializationPerformanceToggle").checked, false);
  const initializationToggle = harness.elements.get("settingsInitializationPerformanceToggle");
  initializationToggle.checked = true;
  initializationToggle.dispatch("change");
  assert.equal(harness.storageValues.get("webshell.initializationPerformance"), "true");
  assert.equal(harness.elements.get("initializationPerformancePanel")?.hidden, false);
  controller.recordTerminalSessionEvent({ id: "pane-init" }, "presentation_commit_complete", {
    reason: "render_commit",
    renderReady: true,
    resizeAckPending: false,
    liveCanvas: { width: 390, height: 713 },
  });
  harness.elements.get("initializationPerformanceCopy").dispatch("click");
  await Promise.resolve();
  assert.equal(copiedInitializationData.length, 1);
  assert.match(copiedInitializationData[0], /初始化性能/);
  assert.match(copiedInitializationData[0], /终端渲染完成/);
  assert.match(copiedInitializationData[0], /"reason":"render_commit"/);
  assert.match(copiedInitializationData[0], /"liveCanvas":\{"width":390/);
  initializationToggle.checked = false;
  initializationToggle.dispatch("change");

  const debugToggle = harness.elements.get("settingsDebugModeToggle");
  debugToggle.checked = false;
  debugToggle.dispatch("change");
  assert.equal(controller.isDebugModeEnabled(), false);
  assert.equal(debugModeChanges, 2);
  assert.equal(harness.storageValues.get("webshell.debugMode"), "false");
  assert.equal(harness.storageValues.get("webshell.networkMonitor"), "true");
  assert.equal(harness.frames.size, 0);
  assert.equal(harness.intervals.size, 0);
  assert.equal(harness.consoleObject.warn, originalWarn);
  assert.equal(harness.windowListeners.get("error")?.size || 0, 0);

  resolveNetworkModule({
    createTerminalNetworkMonitor() {
      monitorCreations += 1;
      return {
        attachSocket() {},
        detachAll() {},
        dispose() {},
        sample() {},
        setLayout() {},
        snapshot: () => null,
      };
    },
  });
  await networkModulePromise;
  await Promise.resolve();
  assert.equal(monitorCreations, 0);

  controller.dispose();
  controller.dispose();
  debugToggle.checked = true;
  debugToggle.dispatch("change");
  assert.equal(controller.isDebugModeEnabled(), false);
  assert.equal(debugModeChanges, 2);
});

test("terminal diagnostic timeline stays module-owned instead of mutating the session", () => {
  const harness = createHarness();
  harness.storageValues.set("webshell.debugMode", "false");
  harness.storageValues.set("webshell.debugLog", "false");
  const controller = createDiagnosticsController({
    ...harness,
    startupDiagnostics: createStartupDiagnostics({ now: () => 0 }),
    now: () => 25,
  });
  const session = {
    id: "pane-1",
    name: "demo",
    connectionChannelGeneration: 2,
    terminalReplayGeneration: 3,
    historyGeneration: "history-1",
    requestedResizeEpoch: "42",
    receivedHistoryCursor: 10n,
    appliedHistoryCursor: 8n,
    presentedHistoryCursor: 8n,
  };

  controller.recordTerminalSessionEvent(session, "resize_request");
  assert.equal(Object.hasOwn(session, "terminalEventTimeline"), false);
  controller.dispose();
});

test("runtime diagnostic timeline carries resume generation and redacts sensitive details", () => {
  const harness = createHarness();
  harness.storageValues.set("webshell.debugMode", "false");
  harness.storageValues.set("webshell.debugLog", "false");
  const controller = createDiagnosticsController({
    ...harness,
    startupDiagnostics: createStartupDiagnostics({ now: () => 0 }),
    now: () => 30,
  });
  const session = {
    id: "pane-1",
    name: "demo",
    connectionChannelGeneration: 2,
    terminalReplayGeneration: 3,
    historyGeneration: "history-1",
    receivedHistoryCursor: 10n,
    appliedHistoryCursor: 10n,
    presentedHistoryCursor: 10n,
  };

  controller.recordRuntimeEvent("resume_signal", {
    source: "focus",
    resumeGeneration: 7,
    token: "must-not-be-retained",
  });
  controller.recordTerminalSessionEvent(session, "presentation_commit_complete");

  assert.deepEqual(controller.runtimeTimelineSnapshot(), [{
    at: 30,
    type: "resume_signal",
    source: "focus",
    resumeGeneration: 7,
    token: "[redacted]",
  }]);
  assert.equal(controller.runtimeTimelineSnapshot()[0].token, "[redacted]");
  assert.equal(controller.runtimeTimelineSnapshot()[0].payload, undefined);
  assert.equal(Object.hasOwn(session, "terminalEventTimeline"), false);
  controller.dispose();
});
