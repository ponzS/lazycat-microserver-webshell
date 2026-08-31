import assert from "node:assert/strict";
import test from "node:test";

import { createTerminalOverviewController } from "../runtime/static/terminal/overview/index.js";

const createWindowHarness = () => {
  let nextHandle = 1;
  const frames = new Map();
  const idle = new Map();
  const timers = new Map();
  const historyCalls = [];
  const location = { href: "https://example.test/webshell/?name=demo" };
  const history = {
    state: {},
    pushState(state, _title, url) {
      this.state = { ...state };
      historyCalls.push({ type: "push", state: { ...state }, url: String(url) });
      location.href = String(url);
    },
    replaceState(state, _title, url) {
      this.state = { ...state };
      historyCalls.push({ type: "replace", state: { ...state }, url: String(url) });
      location.href = String(url);
    },
  };
  const windowObject = {
    history,
    location,
    innerWidth: 390,
    performance: { now: () => 1000 },
    visualViewport: { width: 390, height: 844 },
    requestAnimationFrame(callback) {
      const handle = nextHandle++;
      frames.set(handle, callback);
      return handle;
    },
    cancelAnimationFrame(handle) {
      frames.delete(handle);
    },
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
  };
  return {
    historyCalls,
    idle,
    timers,
    windowObject,
    runFrames() {
      while (frames.size > 0) {
        const pending = [...frames.values()];
        frames.clear();
        for (const callback of pending) callback();
      }
    },
    runIdle() {
      const pending = [...idle.values()];
      idle.clear();
      for (const callback of pending) callback({ didTimeout: false, timeRemaining: () => 50 });
    },
  };
};

const createViewHarness = () => {
  let open = false;
  const calls = [];
  const root = {};
  const grid = {};
  return {
    calls,
    view: {
      elements: { root, grid, toggle: {}, close: {}, newTab: {} },
      clear() { calls.push("clear"); },
      closestCard(target) { return target?.card || null; },
      closestCardButton(target) { return target?.cardButton || null; },
      closestCloseButton(target) { return target?.closeButton || null; },
      drawPreview() { calls.push("draw"); },
      focusActiveCard() { calls.push("focus"); },
      isBackdropTarget(target) { return target === root || target === grid; },
      isHeaderTarget(target) { return target?.header === true; },
      isOpen() { return open; },
      renderTabs({ orderedTabs, activeTabId, mobileLayout }) {
        calls.push(["render", orderedTabs.map((tab) => tab.id), activeTabId, mobileLayout]);
        return [];
      },
      setOpen(value) {
        open = value;
        calls.push(value ? "open" : "close");
      },
    },
  };
};

const createLifecycleHarness = () => {
  let handlers = null;
  let starts = 0;
  let disposes = 0;
  const transient = new Map();
  return {
    factory(options) {
      handlers = options.handlers;
      return {
        dispose() {
          disposes += 1;
          transient.clear();
        },
        listenTransient(_target, type, listener) {
          transient.set(type, listener);
          return () => transient.delete(type);
        },
        start() { starts += 1; },
      };
    },
    get disposes() { return disposes; },
    get handlers() { return handlers; },
    get starts() { return starts; },
    transient,
  };
};

const createTabs = () => {
  const paneA = { id: "pane-a", tabId: "tab-a", renderReady: true, hasPresentedFrame: true };
  const paneB = { id: "pane-b", tabId: "tab-b", renderReady: false, hasPresentedFrame: false };
  const tabA = { id: "tab-a", label: "A", panes: new Map([[paneA.id, paneA]]) };
  const tabB = { id: "tab-b", label: "B", panes: new Map([[paneB.id, paneB]]) };
  return { paneA, paneB, tabA, tabB, tabs: new Map([[tabA.id, tabA], [tabB.id, tabB]]) };
};

test("overview controller renders live or held frames when no persisted source is available", async () => {
  const windowHarness = createWindowHarness();
  const viewHarness = createViewHarness();
  const lifecycle = createLifecycleHarness();
  const { tabs } = createTabs();
  const actions = [];
  const controller = createTerminalOverviewController({
    documentObject: { documentElement: {}, body: {} },
    windowObject: windowHarness.windowObject,
    view: viewHarness.view,
    lifecycleFactory: lifecycle.factory.bind(lifecycle),
    getOrderedTabs: () => [...tabs.values()],
    getActiveTabId: () => "tab-a",
    prepareOpen: () => actions.push("prepare-open"),
    activateTab: (tabId) => actions.push(`activate:${tabId}`),
    closeTab: (tabId) => actions.push(`close:${tabId}`),
    createTab: async () => actions.push("create"),
  });

  controller.start();
  controller.start();
  assert.equal(lifecycle.starts, 1);
  assert.equal(windowHarness.idle.size, 0);

  controller.open();
  assert.equal(controller.isOpen(), true);
  assert.equal(viewHarness.calls.filter((entry) => Array.isArray(entry) && entry[0] === "render").length, 1);
  windowHarness.runFrames();
  assert.equal(viewHarness.calls.filter((entry) => Array.isArray(entry) && entry[0] === "render").length, 2);
  assert.ok(viewHarness.calls.includes("focus"));
  assert.deepEqual(actions, ["prepare-open"]);

  lifecycle.handlers.onRootClick({ target: { cardButton: { dataset: { tabId: "tab-b" } } } });
  assert.deepEqual(actions, ["prepare-open", "activate:tab-b"]);
  assert.equal(controller.isOpen(), false);

  controller.open();
  lifecycle.handlers.onRootClick({
    preventDefault() {},
    stopPropagation() {},
    target: { closeButton: { dataset: { tabOverviewClose: "tab-b" } } },
  });
  assert.ok(actions.includes("close:tab-b"));

  lifecycle.handlers.onNewTab({ preventDefault() {} });
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(actions.includes("create"));
  assert.equal(controller.isOpen(), false);

  controller.scheduleRender();
  controller.dispose();
  controller.dispose();
  assert.equal(lifecycle.disposes, 1);
  assert.equal(windowHarness.idle.size, 0);
  assert.equal(controller.isOpen(), false);
});

test("overview controller prefers live and hold frames before persisted previews", async () => {
  const windowHarness = createWindowHarness();
  const lifecycle = createLifecycleHarness();
  const paneLive = {
    id: "pane-live",
    tabId: "tab-live",
    renderReady: true,
    hasPresentedFrame: true,
    term: { canvas: { id: "live", width: 100, height: 50 } },
  };
  const paneHold = {
    id: "pane-hold",
    tabId: "tab-hold",
    renderReady: false,
    hasPresentedFrame: false,
    terminalFrameHold: { id: "hold", width: 100, height: 50 },
  };
  const paneStored = { id: "pane-stored", tabId: "tab-stored" };
  const paneMissing = { id: "pane-missing", tabId: "tab-missing" };
  const panes = [paneLive, paneHold, paneStored, paneMissing];
  const tabs = panes.map((pane) => ({
    id: pane.tabId,
    activePaneId: pane.id,
    panes: new Map([[pane.id, pane]]),
  }));
  const sources = [];
  const prepared = [];
  const deleted = [];
  let previewDisposed = 0;
  let previewCleaned = 0;
  const persisted = { id: "stored", width: 100, height: 50 };
  const previewController = {
    capture: () => true,
    captureAll: () => 4,
    cleanup: () => { previewCleaned += 1; },
    delete: (pane) => { deleted.push(pane.id); return Promise.resolve(true); },
    dispose: () => { previewDisposed += 1; },
    get: (pane) => pane === paneStored ? persisted : null,
    prepare: (pane) => { prepared.push(pane.id); return Promise.resolve(null); },
  };
  let open = false;
  const controller = createTerminalOverviewController({
    documentObject: { documentElement: {}, body: {} },
    windowObject: windowHarness.windowObject,
    lifecycleFactory: lifecycle.factory.bind(lifecycle),
    getOrderedTabs: () => tabs,
    getActiveTabId: () => "tab-live",
    isFrameHoldCurrent: (pane) => pane === paneHold,
    previewController,
    view: {
      elements: { root: {}, grid: {} },
      drawPreview(_canvas, tab, sourceForPane) {
        sources.push(sourceForPane(tab.panes.get(tab.activePaneId))?.id || "");
      },
      focusActiveCard() {},
      isOpen: () => open,
      renderTabs: ({ orderedTabs }) => orderedTabs.map((tab) => ({ canvas: {}, tab })),
      setOpen: (value) => { open = value; },
    },
  });

  controller.start();
  controller.open();
  assert.deepEqual(sources, ["live", "hold", "stored", ""]);
  assert.deepEqual(prepared, ["pane-missing"]);
  assert.equal(previewCleaned, 1);
  assert.equal(controller.capturePreview(paneLive), true);
  assert.equal(controller.captureAllPreviews(panes), 4);
  await controller.deletePreview(paneMissing);
  assert.deepEqual(deleted, ["pane-missing"]);
  controller.dispose();
  assert.equal(previewDisposed, 1);
});

test("overview controller owns mobile history guard and browser-back opening", () => {
  const windowHarness = createWindowHarness();
  const viewHarness = createViewHarness();
  const lifecycle = createLifecycleHarness();
  const { tabs } = createTabs();
  let blocked = false;
  const controller = createTerminalOverviewController({
    documentObject: { documentElement: { clientWidth: 390 }, body: {} },
    windowObject: windowHarness.windowObject,
    view: viewHarness.view,
    lifecycleFactory: lifecycle.factory.bind(lifecycle),
    getOrderedTabs: () => [...tabs.values()],
    getActiveTabId: () => "tab-a",
    getActiveName: () => "demo",
    workspaceLocationURL: (name, tabId) => `https://example.test/webshell/?name=${name}&tab=${tabId}`,
    isMobileLayout: () => true,
    isBlockingOverlayOpen: () => blocked,
  });

  controller.start();
  assert.equal(windowHarness.historyCalls[0].type, "push");
  assert.equal(windowHarness.historyCalls[0].state.webshellMobileOverviewGuard, true);

  controller.updateWorkspaceLocation({
    name: "demo-2",
    url: "https://example.test/webshell/?name=demo-2",
    replace: false,
  });
  assert.equal(windowHarness.historyCalls.at(-1).state.webshellMobileOverviewGuard, true);

  windowHarness.windowObject.history.state = { name: "demo" };
  assert.equal(controller.consumeHistoryBack(), true);
  assert.equal(controller.isOpen(), true);
  assert.ok(windowHarness.historyCalls.some((call) => call.type === "replace" && call.state.name === "demo"));

  controller.close();
  blocked = true;
  windowHarness.windowObject.history.state = { name: "demo" };
  assert.equal(controller.consumeHistoryBack(), true);
  assert.equal(controller.isOpen(), false);
});

test("overview controller opens from both mobile viewport edges", () => {
  for (const [startX, moveX] of [[2, 70], [388, 320]]) {
    const windowHarness = createWindowHarness();
    const viewHarness = createViewHarness();
    const lifecycle = createLifecycleHarness();
    const { tabs } = createTabs();
    const controller = createTerminalOverviewController({
      documentObject: { documentElement: { clientWidth: 390 }, body: {} },
      windowObject: windowHarness.windowObject,
      view: viewHarness.view,
      lifecycleFactory: lifecycle.factory.bind(lifecycle),
      getOrderedTabs: () => [...tabs.values()],
      getActiveTabId: () => "tab-a",
      isMobileLayout: () => true,
    });
    controller.start();
    lifecycle.handlers.onEdgeSwipeStart({ touches: [{ clientX: startX, clientY: 100 }] });
    let prevented = 0;
    lifecycle.handlers.onEdgeSwipeMove({
      touches: [{ clientX: moveX, clientY: 102 }],
      preventDefault() { prevented += 1; },
      stopPropagation() {},
    });
    assert.equal(controller.isOpen(), true);
    assert.ok(prevented > 0);
    controller.dispose();
  }
});
