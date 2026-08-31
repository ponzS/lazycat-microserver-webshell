import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkspacePaneActivationController,
} from "../runtime/static/workspace/index.js";

const createClassList = () => {
  const values = new Set();
  return {
    has: (value) => values.has(value),
    toggle(value, enabled) {
      if (enabled) values.add(value);
      else values.delete(value);
    },
  };
};

class FakeElement {
  constructor() {
    this.closestValues = new Map();
  }

  closest(selector) {
    return this.closestValues.get(selector) || null;
  }
}

class FakeHTMLElement extends FakeElement {
  constructor(dataset = {}) {
    super();
    this.dataset = dataset;
  }
}

const createHarness = () => {
  const frames = new Map();
  let nextFrame = 1;
  const calls = [];
  const firstShell = new FakeHTMLElement({ paneId: "pane-1" });
  firstShell.classList = createClassList();
  const secondShell = new FakeHTMLElement({ paneId: "pane-2" });
  secondShell.classList = createClassList();
  const tabHost = new FakeHTMLElement({ tabId: "tab-1" });
  secondShell.closestValues.set(".terminal-pane", tabHost);
  const pointerTarget = new FakeElement();
  pointerTarget.closestValues.set(".pane-shell", secondShell);
  const first = { id: "pane-1", shellEl: firstShell, term: {} };
  const second = {
    id: "pane-2",
    shellEl: secondShell,
    term: { focus: () => calls.push("focus:pane-2") },
  };
  const tab = {
    id: "tab-1",
    activePaneId: first.id,
    panes: new Map([[first.id, first], [second.id, second]]),
  };
  let activeTabId = tab.id;
  const controller = createWorkspacePaneActivationController({
    documentObject: { elementFromPoint: () => pointerTarget },
    ElementCtor: FakeElement,
    HTMLElementCtor: FakeHTMLElement,
    getActiveTabId: () => activeTabId,
    getTabById: (tabId) => tabId === tab.id ? tab : null,
    activateTab: (tabId, options) => calls.push(["activate-tab", tabId, options]),
    resetSessionUserInput: (pane) => calls.push(`reset:${pane.id}`),
    refreshTabAutoLabel: () => calls.push("label"),
    syncCursorBlinkState: () => calls.push("cursor"),
    updateSelectionHandles: (pane) => calls.push(`selection:${pane.id}`),
    schedulePaneResize: (pane, options, scheduleOptions) => calls.push(["resize", pane.id, options, scheduleOptions]),
    claimCurrentDeviceSize: (pane, options) => calls.push(["claim", pane.id, options]),
    presentationIsCurrent: () => false,
    cancelPendingRender: () => calls.push("cancel-render"),
    connectPendingSession: (pane) => calls.push(`connect:${pane.id}`),
    checkSessionHealth: (pane, options) => calls.push(["health", pane.id, options]),
    syncConnectionDemands: (options) => calls.push(["sync", options]),
    postWorkspaceAction: (action, payload) => calls.push(["post", action, payload]),
    showToast: (message) => calls.push(`toast:${message}`),
    lifecycleOptions: {
      windowObject: {
        requestAnimationFrame(callback) {
          const id = nextFrame++;
          frames.set(id, callback);
          return id;
        },
        cancelAnimationFrame(id) {
          calls.push(`cancel-frame:${id}`);
          frames.delete(id);
        },
      },
    },
  });
  return {
    calls,
    controller,
    first,
    frames,
    second,
    setActiveTabId: (value) => { activeTabId = value; },
    tab,
  };
};

test("pane activation preserves visual, resize, connection and persistence ordering", () => {
  const harness = createHarness();
  assert.equal(harness.controller.activate(harness.tab, harness.second.id), true);
  assert.equal(harness.tab.activePaneId, harness.second.id);
  assert.equal(harness.first.shellEl.classList.has("active"), false);
  assert.equal(harness.second.shellEl.classList.has("active"), true);
  assert.deepEqual(harness.calls, [
    "reset:pane-2",
    "label",
    "cursor",
    "selection:pane-2",
    ["claim", "pane-2", { forceFullRender: true, hideUntilRender: true }],
    ["health", "pane-2", { connect: true, force: true }],
    ["sync", { reason: "active_pane_changed", interactionSession: null }],
    ["post", "activate_pane", { tab_id: "tab-1", pane_id: "pane-2" }],
  ]);
  [...harness.frames.values()][0]();
  assert.deepEqual(harness.calls.slice(-2), ["connect:pane-2", "focus:pane-2"]);
});

test("pane activation rejects stale focus and cancels pending frames on dispose", () => {
  const harness = createHarness();
  harness.controller.activate(harness.tab, harness.second.id);
  const firstFrame = [...harness.frames.values()][0];
  harness.tab.activePaneId = harness.first.id;
  firstFrame();
  assert.equal(harness.calls.includes("focus:pane-2"), false);

  harness.tab.activePaneId = harness.first.id;
  harness.controller.activate(harness.tab, harness.second.id);
  assert.equal(harness.controller.dispose(), true);
  assert.equal(harness.controller.dispose(), false);
  assert.equal(harness.controller.activate(harness.tab, harness.first.id), false);
  assert.ok(harness.calls.some((value) => String(value).startsWith("cancel-frame:")));
});

test("pane activation resolves a pane from a viewport point", () => {
  const harness = createHarness();
  harness.setActiveTabId("tab-other");
  assert.equal(harness.controller.focusAtPoint(12, 24), true);
  assert.deepEqual(harness.calls[0], ["activate-tab", "tab-1", { focus: false }]);
  assert.equal(harness.tab.activePaneId, harness.second.id);
  assert.equal(harness.controller.focusAtPoint(Number.NaN, 24), false);
});

test("re-activating the current pane does not schedule a resize by default", () => {
  const harness = createHarness();
  assert.equal(harness.controller.activate(harness.tab, harness.first.id), true);
  assert.equal(harness.calls.some((entry) => Array.isArray(entry) && entry[0] === "resize"), false);

  assert.equal(harness.controller.activate(harness.tab, harness.first.id, { resizeIfActive: true }), true);
  assert.equal(harness.calls.filter((entry) => Array.isArray(entry) && entry[0] === "resize").length, 1);
});

test("explicit interaction on the current pane claims without a passive resize", () => {
  const harness = createHarness();
  assert.equal(harness.controller.activate(harness.tab, harness.first.id, {
    focus: false,
    resize: false,
    userInteraction: true,
  }), true);

  assert.deepEqual(
    harness.calls.find((entry) => Array.isArray(entry) && entry[0] === "claim"),
    ["claim", "pane-1", { forceFullRender: false, hideUntilRender: false }],
  );
  assert.equal(harness.calls.some((entry) => Array.isArray(entry) && entry[0] === "resize"), false);
});
