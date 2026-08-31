import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkspacePresentationController,
  workspacePathBasenameLabel,
} from "../runtime/static/workspace/index.js";

const classList = () => {
  const values = new Set();
  return {
    add: (value) => values.add(value),
    remove: (value) => values.delete(value),
    has: (value) => values.has(value),
  };
};

test("workspace presentation derives labels and mobile focus prompt", () => {
  assert.equal(workspacePathBasenameLabel("/"), "ROOT");
  assert.equal(workspacePathBasenameLabel("/home/user/project/"), "project");
  assert.equal(workspacePathBasenameLabel(""), "");

  const textarea = {};
  const pane = { id: "pane-1", cwd: "/home/user/project", term: { textarea } };
  const tab = { id: "tab-1", label: "Shell", activePaneId: pane.id, panes: new Map([[pane.id, pane]]) };
  const tabs = new Map([[tab.id, tab]]);
  const mobileTitle = {};
  const documentObject = { activeElement: null, title: "" };
  const controller = createWorkspacePresentationController({
    documentObject,
    mobileActiveTabTitle: mobileTitle,
    getTabs: () => tabs,
    getActiveTabId: () => tab.id,
    getCurrentTab: () => tab,
    getMobileDoubleTapReminderEnabled: () => true,
    requiresTouchKeyboardDoubleTap: () => true,
  });

  assert.equal(controller.updateMobileActiveTabTitle(), "双击屏幕开启键盘输入");
  documentObject.activeElement = textarea;
  assert.equal(controller.updateMobileActiveTabTitle(), "project");
  assert.equal(mobileTitle.textContent, "project");
  assert.equal(mobileTitle.title, "project");
});

test("workspace presentation owns auto labels, notifications and cursor blink", () => {
  const rendered = [];
  const activePane = {
    id: "pane-1",
    cwd: "/srv/app",
    term: { options: { cursorBlink: false } },
  };
  const backgroundPane = {
    id: "pane-2",
    title: "Build",
    term: { options: { cursorBlink: true } },
    hasUserInputSinceFocus: true,
  };
  const activeTab = {
    id: "tab-1",
    label: "old",
    activePaneId: activePane.id,
    panes: new Map([[activePane.id, activePane]]),
    button: { classList: classList() },
  };
  const backgroundTab = {
    id: "tab-2",
    label: "Build",
    activePaneId: backgroundPane.id,
    panes: new Map([[backgroundPane.id, backgroundPane]]),
    button: { classList: classList() },
  };
  backgroundPane.tabId = backgroundTab.id;
  const tabs = new Map([[activeTab.id, activeTab], [backgroundTab.id, backgroundTab]]);
  const documentObject = { title: "" };
  const controller = createWorkspacePresentationController({
    documentObject,
    getTabs: () => tabs,
    getActiveTabId: () => activeTab.id,
    getCurrentTab: () => activeTab,
    renderTabLabel: (tab) => rendered.push(tab.id),
  });

  assert.equal(controller.refreshTabAutoLabel(activeTab), true);
  assert.equal(activeTab.label, "app");
  assert.deepEqual(rendered, [activeTab.id]);
  controller.syncCursorBlinkState();
  assert.equal(activePane.term.options.cursorBlink, true);
  assert.equal(backgroundPane.term.options.cursorBlink, false);

  assert.equal(controller.markSessionTitleNotification(backgroundPane), true);
  assert.equal(backgroundTab.hasNotification, true);
  assert.equal(backgroundTab.button.classList.has("has-notification"), true);
  assert.equal(documentObject.title, "* app - LightOS WebShell");
  assert.equal(controller.clearTabNotification(backgroundTab), true);
  assert.equal(documentObject.title, "app - LightOS WebShell");

  assert.equal(controller.markSessionActivityNotification(backgroundPane, false, true), true);
  assert.equal(backgroundPane.notifyWhenIdle, true);
  assert.equal(controller.markSessionIdleNotification(backgroundPane, true, false), true);
  controller.resetSessionUserInput(backgroundPane);
  assert.equal(backgroundPane.hasUserInputSinceFocus, false);
  assert.equal(backgroundPane.notifyWhenIdle, false);
});

test("workspace empty state follows the tab registry", () => {
  const tabs = new Map();
  const emptyState = { hidden: true };
  const mobileTitle = {};
  const controller = createWorkspacePresentationController({
    documentObject: { title: "" },
    emptyState,
    mobileActiveTabTitle: mobileTitle,
    getTabs: () => tabs,
    getCurrentTab: () => null,
  });

  assert.equal(controller.updateEmptyState(), true);
  assert.equal(emptyState.hidden, false);
  assert.equal(mobileTitle.textContent, "终端");
  tabs.set("tab-1", { id: "tab-1", panes: new Map() });
  assert.equal(controller.updateEmptyState(), false);
  assert.equal(emptyState.hidden, true);
});
