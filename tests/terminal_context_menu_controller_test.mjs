import assert from "node:assert/strict";
import test from "node:test";

import {
  createTerminalContextMenuController,
  createTerminalInteractionLifecycle,
} from "../runtime/static/terminal/interaction/index.js";

const createViewHarness = () => {
  let desktopOpen = false;
  let mobileOpen = false;
  const calls = [];
  const view = {
    elements: {
      desktopMenu: {},
      mobileGrid: {},
      mobileHandle: {},
      mobileScrim: {},
    },
    canOpenMobile: () => true,
    closeDesktop() {
      desktopOpen = false;
      calls.push("close-desktop");
    },
    closeMobile() {
      mobileOpen = false;
      calls.push("close-mobile");
    },
    containsDesktopTarget: (target) => target?.insideDesktop === true,
    desktopActionFromTarget: (target) => String(target?.action || ""),
    dispose() {
      desktopOpen = false;
      mobileOpen = false;
      calls.push("dispose-view");
    },
    isDesktopOpen: () => desktopOpen,
    isMobileOpen: () => mobileOpen,
    mobileActionFromTarget: (target) => String(target?.action || ""),
    openMobile() {
      mobileOpen = true;
      calls.push("open-mobile");
    },
    renderDesktop(options) {
      desktopOpen = true;
      calls.push({
        type: "desktop",
        target: { ...options.target },
        visible: {
          screenshot: options.isActionVisible("capture-long-screenshot"),
          openLink: options.isActionVisible("open-link"),
          renameTab: options.isActionVisible("rename-tab"),
        },
      });
      return true;
    },
    renderMobile(options) {
      calls.push({
        type: "mobile",
        enabled: {
          copy: options.isActionEnabled("copy"),
          openLink: options.isActionEnabled("open-link"),
          movePane: options.isActionEnabled("move-pane-new-tab"),
          closeOtherTabs: options.isActionEnabled("close-other-tabs"),
        },
      });
      return true;
    },
  };
  return { calls, view };
};

const createLifecycleHarness = () => {
  const paneBindings = new Map();
  const tabBindings = new Map();
  let handlers = null;
  let starts = 0;
  let disposes = 0;
  return {
    factory(options) {
      handlers = options.handlers;
      return {
        bindPane(target, binding) {
          paneBindings.set(target, binding);
          return () => paneBindings.delete(target);
        },
        bindTab(target, listener) {
          tabBindings.set(target, listener);
          return () => tabBindings.delete(target);
        },
        dispose() {
          disposes += 1;
          paneBindings.clear();
          tabBindings.clear();
        },
        start() {
          starts += 1;
        },
      };
    },
    get disposes() { return disposes; },
    get handlers() { return handlers; },
    paneBindings,
    get starts() { return starts; },
    tabBindings,
  };
};

const createWorkspace = () => {
  const paneA = { id: "pane-a", closed: false, selectAllBufferActive: false };
  const paneB = { id: "pane-b", closed: false, selectAllBufferActive: false };
  const paneC = { id: "pane-c", closed: false, selectAllBufferActive: false };
  const tabA = { id: "tab-a", activePaneId: paneA.id, panes: new Map([[paneA.id, paneA], [paneB.id, paneB]]) };
  const tabB = { id: "tab-b", activePaneId: paneC.id, panes: new Map([[paneC.id, paneC]]) };
  const tabs = new Map([[tabA.id, tabA], [tabB.id, tabB]]);
  return { paneA, paneB, paneC, tabA, tabB, tabs };
};

test("context menu controller keeps pane targets dynamic and routes explicit commands", () => {
  const viewHarness = createViewHarness();
  const lifecycle = createLifecycleHarness();
  const workspace = createWorkspace();
  const actions = [];
  let activeTab = workspace.tabA;
  let activePane = workspace.paneA;
  let paneTarget = { type: "pane", tabId: "tab-a", paneId: "pane-a", link: "https://example.test/a" };
  const controller = createTerminalContextMenuController({
    view: viewHarness.view,
    lifecycleFactory: lifecycle.factory.bind(lifecycle),
    getTabById: (tabId) => workspace.tabs.get(tabId) || null,
    getOrderedTabs: () => [...workspace.tabs.values()],
    getCurrentTab: () => activeTab,
    getActiveSession: () => activePane,
    hasSelection: () => true,
    isTouchShortcutLayout: () => false,
    splitPane: (tabId, paneId, direction) => actions.push(`split:${tabId}:${paneId}:${direction}`),
    moveTab: (tabId, position) => actions.push(`move:${tabId}:${position}`),
  });

  controller.start();
  controller.start();
  assert.equal(lifecycle.starts, 1);

  const shell = {};
  const cleanupPane = controller.bindPane(shell, {
    activate: () => actions.push("activate-pane"),
    getTarget: () => paneTarget ? { ...paneTarget } : null,
  });
  const paneBinding = lifecycle.paneBindings.get(shell);
  paneBinding.onContextMenu({ clientX: 12, clientY: 18, preventDefault() {} });
  let render = viewHarness.calls.findLast((entry) => entry?.type === "desktop");
  assert.deepEqual(render.target, paneTarget);
  assert.deepEqual(render.visible, { screenshot: false, openLink: true, renameTab: true });

  lifecycle.handlers.onDesktopAction({ target: { action: "split-vertical" } });
  assert.ok(actions.includes("split:tab-a:pane-a:vertical"));

  workspace.tabA.panes.delete(workspace.paneA.id);
  workspace.tabB.panes.set(workspace.paneA.id, workspace.paneA);
  paneTarget = { type: "pane", tabId: "tab-b", paneId: "pane-a", link: "" };
  paneBinding.onContextMenu({ clientX: 20, clientY: 30, preventDefault() {} });
  render = viewHarness.calls.findLast((entry) => entry?.type === "desktop");
  assert.deepEqual(render.target, paneTarget);
  assert.equal(render.visible.openLink, false);

  paneTarget = null;
  paneBinding.onContextMenu({ clientX: 25, clientY: 35, preventDefault() {} });
  assert.equal(controller.isDesktopOpen(), false);

  const tabButton = {};
  const cleanupTab = controller.bindTab(tabButton, {
    activate: () => actions.push("activate-tab"),
    getTarget: () => ({ type: "tab", tabId: "tab-b", paneId: "pane-c" }),
  });
  lifecycle.tabBindings.get(tabButton)({ clientX: 8, clientY: 9, preventDefault() {} });
  lifecycle.handlers.onDesktopAction({ target: { action: "move-tab-first" } });
  assert.ok(actions.includes("move:tab-b:first"));

  cleanupPane();
  cleanupPane();
  cleanupTab();
  cleanupTab();
  assert.equal(lifecycle.paneBindings.has(shell), false);
  assert.equal(lifecycle.tabBindings.has(tabButton), false);

  activeTab = workspace.tabB;
  activePane = workspace.paneC;
  controller.dispose();
  controller.dispose();
  assert.equal(lifecycle.disposes, 1);
});

test("mobile actions keep availability, click gate and touch context suppression inside the controller", async () => {
  const viewHarness = createViewHarness();
  const lifecycle = createLifecycleHarness();
  const workspace = createWorkspace();
  const actions = [];
  let now = 1000;
  let mobileLayout = false;
  const controller = createTerminalContextMenuController({
    view: viewHarness.view,
    lifecycleFactory: lifecycle.factory.bind(lifecycle),
    windowObject: { performance: { now: () => now } },
    getTabById: (tabId) => workspace.tabs.get(tabId) || null,
    getOrderedTabs: () => [...workspace.tabs.values()],
    getCurrentTab: () => workspace.tabA,
    getActiveSession: () => workspace.paneA,
    getSelectionText: () => "visit https://example.test/path",
    findFirstURLInText: () => "https://example.test/path",
    hasSelection: () => false,
    isMobileLayout: () => mobileLayout,
    isTouchShortcutLayout: () => true,
    isTouchSelectionLayout: () => true,
    prepareMobileOpen: () => actions.push("prepare-mobile"),
    pasteSession: (pane) => actions.push(`paste:${pane.id}`),
  });

  assert.equal(controller.openMobile(), true);
  const render = viewHarness.calls.findLast((entry) => entry?.type === "mobile");
  assert.deepEqual(render.enabled, {
    copy: false,
    openLink: true,
    movePane: true,
    closeOtherTabs: true,
  });
  assert.equal(controller.isMobileOpen(), true);
  assert.deepEqual(actions, ["prepare-mobile"]);

  const gatedEvent = {
    target: { action: "paste" },
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
  };
  now = 1200;
  lifecycle.handlers.onMobileAction(gatedEvent);
  assert.equal(gatedEvent.prevented, true);
  assert.equal(gatedEvent.stopped, true);
  assert.deepEqual(actions, ["prepare-mobile"]);

  now = 1401;
  lifecycle.handlers.onMobileAction({ target: { action: "copy" } });
  assert.deepEqual(actions, ["prepare-mobile"]);
  lifecycle.handlers.onMobileAction({ target: { action: "paste" } });
  await Promise.resolve();
  assert.deepEqual(actions, ["prepare-mobile", "paste:pane-a"]);
  assert.equal(controller.isMobileOpen(), false);

  now = 2000;
  controller.markTouchCandidate({ clientX: 40, clientY: 60 });
  assert.equal(controller.shouldSuppressContextMenu({ pointerType: "mouse", clientX: 50, clientY: 70 }), true);
  now = 3501;
  assert.equal(controller.shouldSuppressContextMenu({ pointerType: "mouse", clientX: 50, clientY: 70 }), false);
  assert.equal(controller.shouldSuppressContextMenu({ pointerType: "touch", clientX: 0, clientY: 0 }), true);

  mobileLayout = true;
  const shell = {};
  controller.bindPane(shell, { activate: () => actions.push("activate-touch") });
  const event = {
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
  };
  lifecycle.paneBindings.get(shell).onCapture(event);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.ok(actions.includes("activate-touch"));
});

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }

  emit(type, event = {}) {
    for (const listener of [...(this.listeners.get(type) || [])]) {
      listener(event);
    }
  }
}

test("interaction lifecycle removes permanent and dynamic listeners idempotently", () => {
  const documentObject = new FakeEventTarget();
  const windowObject = new FakeEventTarget();
  const desktopMenu = new FakeEventTarget();
  const mobileGrid = new FakeEventTarget();
  const mobileHandle = new FakeEventTarget();
  const mobileScrim = new FakeEventTarget();
  const pane = new FakeEventTarget();
  const tab = new FakeEventTarget();
  const calls = [];
  const lifecycle = createTerminalInteractionLifecycle({
    documentObject,
    windowObject,
    elements: { desktopMenu, mobileGrid, mobileHandle, mobileScrim },
    handlers: {
      onDesktopAction: () => calls.push("desktop"),
      onDocumentKeydown: () => calls.push("keydown"),
      onDocumentPointerDown: () => calls.push("pointerdown"),
      onMobileAction: () => calls.push("mobile"),
      onMobileClose: () => calls.push("mobile-close"),
      onResize: () => calls.push("resize"),
    },
  });

  lifecycle.start();
  lifecycle.start();
  const cleanupPane = lifecycle.bindPane(pane, {
    onCapture: () => calls.push("pane-capture"),
    onContextMenu: () => calls.push("pane-menu"),
  });
  const cleanupTab = lifecycle.bindTab(tab, () => calls.push("tab-menu"));

  desktopMenu.emit("click");
  mobileGrid.emit("click");
  mobileHandle.emit("click");
  mobileScrim.emit("click");
  documentObject.emit("pointerdown");
  documentObject.emit("keydown");
  windowObject.emit("resize");
  pane.emit("contextmenu");
  tab.emit("contextmenu");
  assert.deepEqual(calls, [
    "desktop",
    "mobile",
    "mobile-close",
    "mobile-close",
    "pointerdown",
    "keydown",
    "resize",
    "pane-capture",
    "pane-menu",
    "tab-menu",
  ]);

  cleanupPane();
  cleanupPane();
  cleanupTab();
  cleanupTab();
  lifecycle.dispose();
  lifecycle.dispose();
  pane.emit("contextmenu");
  tab.emit("contextmenu");
  documentObject.emit("keydown");
  assert.equal(calls.length, 10);
});
