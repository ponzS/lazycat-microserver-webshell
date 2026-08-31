import assert from "node:assert/strict";
import test from "node:test";

import { createAppCommandController } from "../runtime/static/app/commands/index.js";

class FakeTarget {
  constructor() {
    this.listeners = new Map();
    this.scrollLeft = 0;
  }

  addEventListener(type, listener, options) {
    const entries = this.listeners.get(type) || [];
    entries.push({ listener, options });
    this.listeners.set(type, entries);
  }

  removeEventListener(type, listener, options) {
    const entries = this.listeners.get(type) || [];
    this.listeners.set(type, entries.filter((entry) => (
      entry.listener !== listener || entry.options !== options
    )));
  }

  dispatch(type, init = {}) {
    const event = {
      type,
      deltaX: 0,
      deltaY: 0,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...init,
    };
    for (const { listener } of [...(this.listeners.get(type) || [])]) {
      listener(event);
    }
    return event;
  }
}

const createHarness = () => {
  const calls = [];
  const newTabButton = new FakeTarget();
  const emptyStateAction = new FakeTarget();
  const tabsElement = new FakeTarget();
  const controller = createAppCommandController({
    getActiveName: () => "demo",
    getCurrentTab: () => ({ id: "tab-1", activePaneId: "pane-1" }),
    postWorkspaceAction: async (...args) => calls.push(["workspace", ...args]),
    closeTab: (id) => calls.push(["close", id]),
    renameTab: (id) => calls.push(["rename", id]),
    swapRecentTabs: () => calls.push(["swap"]),
    setActiveTabByOffset: (offset) => calls.push(["offset", offset]),
    splitPane: (...args) => calls.push(["split", ...args]),
    openOverview: () => calls.push(["overview"]),
    openSearch: () => calls.push(["search"]),
    openAttachments: () => calls.push(["attachments"]),
    importAttachmentFromClipboard: () => calls.push(["attachment-clipboard"]),
    selectAttachmentFiles: () => calls.push(["attachment-file"]),
    copySession: (session) => calls.push(["copy", session?.id]),
    pasteSession: (session) => calls.push(["paste", session?.id]),
    scrollSession: (session, delta) => calls.push(["scroll", session?.id, delta]),
    adjustTerminalFontSize: (delta) => calls.push(["zoom", delta]),
    openMobileMenu: () => calls.push(["mobile-menu"]),
    showToast: (message) => calls.push(["toast", message]),
  });
  return { calls, controller, newTabButton, emptyStateAction, tabsElement };
};

test("application commands dispatch injected workspace and terminal intents", async () => {
  const harness = createHarness();
  const session = { id: "pane-1" };
  await harness.controller.runAction("new_tab");
  await harness.controller.runAction("rename_tab");
  await harness.controller.runAction("swap_recent_tab");
  await harness.controller.runAction("next_tab");
  await harness.controller.runAction("vertical_split");
  await harness.controller.runAction("overview");
  await harness.controller.runAction("attachment_file");
  await harness.controller.runAction("copy", session);
  await harness.controller.runAction("page_down", session);
  await harness.controller.runAction("zoom-in");
  assert.deepEqual(harness.calls, [
    ["workspace", "create_tab", { tab_id: "tab-1", pane_id: "pane-1" }],
    ["rename", "tab-1"],
    ["swap"],
    ["offset", 1],
    ["split", "tab-1", "pane-1", "vertical"],
    ["overview"],
    ["attachment-file"],
    ["copy", "pane-1"],
    ["scroll", "pane-1", 1],
    ["zoom", 1],
  ]);
});

test("createUserTab reports missing target and command lifecycle fences late actions", async () => {
  const calls = [];
  const controller = createAppCommandController({
    getActiveName: () => "",
    showToast: (message) => calls.push(message),
  });
  assert.equal(await controller.createUserTab(), false);
  assert.deepEqual(calls, ["No running container is available."]);
  assert.equal(controller.dispose(), true);
  assert.equal(await controller.runAction("new_tab"), false);
  assert.equal(controller.dispose(), false);
});

test("shell controls install once, scroll vertically and clean listeners", async () => {
  const harness = createHarness();
  assert.equal(harness.controller.install({
    newTabButton: harness.newTabButton,
    emptyStateAction: harness.emptyStateAction,
    tabsElement: harness.tabsElement,
  }), true);
  assert.equal(harness.controller.install({
    newTabButton: harness.newTabButton,
    emptyStateAction: harness.emptyStateAction,
    tabsElement: harness.tabsElement,
  }), false);
  harness.newTabButton.dispatch("click");
  harness.emptyStateAction.dispatch("click");
  const wheel = harness.tabsElement.dispatch("wheel", { deltaY: 24, deltaX: 2 });
  await Promise.resolve();
  assert.equal(harness.tabsElement.scrollLeft, 24);
  assert.equal(wheel.defaultPrevented, true);
  assert.equal(harness.calls.filter(([name]) => name === "workspace").length, 2);
  assert.equal(harness.controller.dispose(), true);
  assert.equal(harness.newTabButton.listeners.get("click")?.length || 0, 0);
  assert.equal(harness.emptyStateAction.listeners.get("click")?.length || 0, 0);
  assert.equal(harness.tabsElement.listeners.get("wheel")?.length || 0, 0);
});
