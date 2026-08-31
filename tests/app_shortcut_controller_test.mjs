import assert from "node:assert/strict";
import test from "node:test";

import { createAppShortcutController } from "../runtime/static/app/shortcuts/index.js";

class FakeElement {
  constructor(kind = "div") {
    this.kind = kind;
    this.classList = { contains: (value) => value === this.kind };
    this.isContentEditable = false;
    this.closestCalls = [];
  }

  closest(selector) {
    this.closestCalls.push(selector);
    if (selector === ".terminal-host" && this.kind === "terminal-host") {
      return this;
    }
    if (selector.includes("input") && this.kind === "input") {
      return this;
    }
    return null;
  }
}

class FakeInput extends FakeElement {}
class FakeTextArea extends FakeElement {}
class FakeSelect extends FakeElement {}

class FakeKeyboardEvent {
  constructor(init = {}) {
    Object.assign(this, init);
    this.type = "keydown";
    this.defaultPrevented = false;
    this.propagationStopped = false;
    this.immediatePropagationStopped = false;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }

  stopPropagation() {
    this.propagationStopped = true;
  }

  stopImmediatePropagation() {
    this.immediatePropagationStopped = true;
  }
}

const createHarness = () => {
  const calls = [];
  const tab = { id: "tab-1", activePaneId: "pane-1" };
  const session = { id: "pane-1", term: { scrollPages: (delta) => calls.push(["scroll", delta]) } };
  const documentObject = {
    documentElement: {},
    fullscreenElement: null,
  };
  const controller = createAppShortcutController({
    documentObject,
    KeyboardEventCtor: FakeKeyboardEvent,
    ElementCtor: FakeElement,
    HTMLInputElementCtor: FakeInput,
    HTMLTextAreaElementCtor: FakeTextArea,
    HTMLSelectElementCtor: FakeSelect,
    getCurrentTab: () => tab,
    getOrderedTabs: () => [tab, { id: "tab-2" }],
    getActiveSession: () => session,
    setActiveTabByOffset: (offset) => calls.push(["offset", offset]),
    setActiveTabByIndex: (index) => calls.push(["index", index]),
    createUserTab: async () => calls.push(["new"]),
    closeTab: (id) => calls.push(["close", id]),
    closeOtherTabs: (id) => calls.push(["close-other", id]),
    renameTab: async (id) => calls.push(["rename", id]),
    moveTab: (id, position) => calls.push(["move", id, position]),
    splitPane: (id, paneID, direction) => calls.push(["split", id, paneID, direction]),
    closePane: (id, paneID) => calls.push(["close-pane", id, paneID]),
    selectPaneInDirection: (direction) => calls.push(["select", direction]),
    resolveDesktopShortcutAction: (shortcut) => shortcut === "next" ? "next_tab" : "",
    isAppearancePickerOpen: () => false,
    isSettingsOpen: () => false,
    isDevicesPanelOpen: () => false,
    isInstanceSwitcherOpen: () => false,
    isAttachmentsOpen: () => false,
    isTerminalOverviewOpen: () => false,
    setActiveTabByOffset: (offset) => calls.push(["offset", offset]),
    openTheme: () => calls.push(["theme"]),
    openInstanceSwitcher: async () => calls.push(["switcher"]),
    copyTerminal: async () => calls.push(["copy"]),
    focusForNativePaste: () => calls.push(["focus-paste"]),
    openSearch: () => calls.push(["search"]),
    selectAllTerminal: () => calls.push(["select-all"]),
    importAttachmentFromClipboard: async () => calls.push(["attachment-clipboard"]),
    selectAttachmentFiles: () => calls.push(["attachment-file"]),
    pasteTerminal: async () => calls.push(["paste"]),
    closeContextMenu: () => calls.push(["close-menu"]),
    showToast: (message) => calls.push(["toast", message]),
    getShortcutKey: (event) => event.shortcut || "",
    isNativePaste: () => false,
    isShiftInsertPaste: () => false,
  });
  return { calls, controller, documentObject, tab };
};

test("desktop shortcut actions dispatch only injected commands", async () => {
  const harness = createHarness();
  await harness.controller.runAction("new_tab");
  await harness.controller.runAction("rename_tab");
  await harness.controller.runAction("move_tab_right");
  await harness.controller.runAction("vertical_split");
  await harness.controller.runAction("select_left");
  await harness.controller.runAction("tab_2");
  assert.deepEqual(harness.calls, [
    ["new"],
    ["rename", "tab-1"],
    ["move", "tab-1", "right"],
    ["split", "tab-1", "pane-1", "vertical"],
    ["select", "left"],
    ["index", 1],
  ]);
});

test("keydown filtering handles shortcuts, paste and interactive targets", async () => {
  const harness = createHarness();
  const event = new FakeKeyboardEvent({ key: "ArrowRight", shortcut: "next", target: new FakeElement() });
  assert.equal(harness.controller.handleKeydown(event), true);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(harness.calls.slice(-2), [["close-menu"], ["offset", 1]]);

  const interactive = new FakeKeyboardEvent({ shortcut: "next", target: new FakeInput("input") });
  assert.equal(harness.controller.handleKeydown(interactive), false);

  harness.controller.dispose();
  assert.equal(harness.controller.handleKeydown(event), false);
  assert.equal(await harness.controller.runAction("new_tab"), false);
  assert.equal(harness.controller.dispose(), false);
});

test("Shift+Insert uses the injected native paste path", async () => {
  const harness = createHarness();
  const pasteController = createAppShortcutController({
    ...createHarness(),
    KeyboardEventCtor: FakeKeyboardEvent,
    ElementCtor: FakeElement,
    HTMLInputElementCtor: FakeInput,
    HTMLTextAreaElementCtor: FakeTextArea,
    HTMLSelectElementCtor: FakeSelect,
    getShortcutKey: () => "",
    isShiftInsertPaste: () => true,
    isNativePaste: () => false,
    focusForNativePaste: () => harness.calls.push(["focus-paste"]),
    closeContextMenu: () => harness.calls.push(["close-menu"]),
    pasteTerminal: async () => harness.calls.push(["paste"]),
  });
  const event = new FakeKeyboardEvent({ target: new FakeElement() });
  assert.equal(pasteController.handleKeydown(event), true);
  await Promise.resolve();
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(harness.calls.slice(-3), [["focus-paste"], ["close-menu"], ["paste"]]);
  pasteController.dispose();
});
