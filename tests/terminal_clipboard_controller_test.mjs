import assert from "node:assert/strict";
import test from "node:test";

import {
  createBrowserClipboardAdapter,
  createTerminalClipboardController,
  createTerminalClipboardLifecycle,
} from "../runtime/static/terminal/interaction/index.js";

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
    this.listeners.set(type, (this.listeners.get(type) || []).filter((candidate) => candidate !== listener));
  }

  emit(type, event = {}) {
    for (const listener of [...(this.listeners.get(type) || [])]) {
      listener(event);
    }
  }
}

const createTerminal = ({ selection = "selected", bracketed = false } = {}) => {
  let cleared = 0;
  const text = "full buffer";
  const cells = Array.from(text, (chars) => ({ getChars: () => chars, getWidth: () => 1 }));
  return {
    buffer: {
      active: {
        length: 1,
        getLine: () => ({
          isWrapped: false,
          length: cells.length,
          getCell: (index) => cells[index] || null,
        }),
      },
    },
    rows: 1,
    wasmTerm: {
      getScrollbackLength: () => 0,
      hasBracketedPaste: () => bracketed,
    },
    clearSelection() { cleared += 1; },
    getSelection: () => selection,
    get cleared() { return cleared; },
  };
};

test("browser clipboard adapter uses secure APIs, fallback copy, and permission errors", async () => {
  const writes = [];
  const secure = createBrowserClipboardAdapter({
    navigatorObject: {
      clipboard: {
        writeText: async (value) => writes.push(value),
        readText: async () => "from clipboard",
      },
    },
    windowObject: { isSecureContext: true },
  });
  assert.equal(await secure.copyText("hello"), true);
  assert.deepEqual(writes, ["hello"]);
  assert.equal(await secure.readText(), "from clipboard");

  let removed = 0;
  const textarea = {
    style: {},
    setAttribute() {},
    select() {},
    remove() { removed += 1; },
  };
  const fallback = createBrowserClipboardAdapter({
    documentObject: {
      body: { appendChild() {} },
      createElement: () => textarea,
      execCommand: () => true,
    },
    navigatorObject: { clipboard: { writeText: async () => { throw new Error("denied"); } } },
    windowObject: { isSecureContext: true },
  });
  assert.equal(await fallback.copyText("fallback"), true);
  assert.equal(textarea.value, "fallback");
  assert.equal(removed, 1);

  const denied = createBrowserClipboardAdapter({
    navigatorObject: { clipboard: { readText: async () => { throw Object.assign(new Error("not allowed"), { name: "NotAllowedError" }); } } },
    windowObject: { isSecureContext: true },
  });
  await assert.rejects(() => denied.readText(), /当前页面策略禁止主动读取剪贴板/);
});

test("clipboard controller owns selected text, bracketed paste, feedback, and stale async guards", async () => {
  const copied = [];
  const sent = [];
  const calls = [];
  let resolveRead;
  const adapter = {
    copyText: async (value) => { copied.push(value); return true; },
    readText: () => new Promise((resolve) => { resolveRead = resolve; }),
  };
  const term = createTerminal({ bracketed: true });
  const session = { id: "pane-1", term, closed: false };
  let fullBufferSelection = false;
  const controller = createTerminalClipboardController({
    adapter,
    getActiveSession: () => session,
    getSelectionText: () => fullBufferSelection ? "full buffer" : term.getSelection(),
    clearSelectionState: () => { fullBufferSelection = false; },
    sendInput: (_session, data) => sent.push(data),
    updateSelectionUI: () => calls.push("update-selection"),
    showToast: (message) => calls.push(message),
  });
  controller.start();

  assert.equal(controller.getSelectedText(), "selected");
  assert.equal(await controller.copySession(), true);
  assert.deepEqual(copied, ["selected"]);
  assert.equal(term.cleared, 1);
  assert.deepEqual(calls, ["已复制。", "update-selection"]);

  fullBufferSelection = true;
  assert.equal(controller.getSelectedText(), "full buffer");
  assert.equal(await controller.copySession(), true);
  assert.equal(copied.at(-1), "full buffer");
  assert.equal(fullBufferSelection, false);

  assert.equal(await controller.pasteSession(session, "paste"), true);
  assert.deepEqual(sent, ["\x1b[200~paste\x1b[201~"]);

  const pending = controller.pasteSession(session);
  session.closed = true;
  resolveRead("late paste");
  assert.equal(await pending, false);
  assert.equal(sent.length, 1);

  controller.dispose();
  controller.dispose();
  assert.equal(await controller.copyText("after dispose"), false);
});

test("clipboard read denial focuses the native paste target after actionable feedback", async () => {
  const calls = [];
  const session = { id: "pane-1", term: createTerminal(), closed: false };
  const controller = createTerminalClipboardController({
    adapter: {
      copyText: async () => true,
      readText: async () => { throw new Error("当前页面策略禁止主动读取剪贴板，请使用系统粘贴快捷键。"); },
    },
    getActiveSession: () => session,
    focusForNativePaste: (target) => calls.push(["focus", target.id]),
    showToast: (message) => calls.push(["toast", message]),
  });
  controller.start();
  assert.equal(await controller.pasteSession(), false);
  assert.deepEqual(calls, [
    ["toast", "当前页面策略禁止主动读取剪贴板，请使用系统粘贴快捷键。"],
    ["focus", "pane-1"],
  ]);
});

test("desktop clipboard binding owns drag copy, middle paste, activation, and cleanup", async () => {
  const documentObject = new FakeEventTarget();
  const shell = new FakeEventTarget();
  const host = {};
  const target = { closest: (selector) => selector === ".terminal-host" ? host : null };
  const copied = [];
  const sent = [];
  const calls = [];
  const session = {
    id: "pane-1",
    closed: false,
    shellEl: shell,
    terminalHost: host,
    term: createTerminal({ selection: "dragged" }),
  };
  const controller = createTerminalClipboardController({
    documentObject,
    adapter: {
      copyText: async (value) => { copied.push(value); return true; },
      readText: async () => "middle paste",
    },
    lifecycleFactory: (options) => createTerminalClipboardLifecycle(options),
    getSelectionText: () => session.term.getSelection(),
    clearSelectionState: () => calls.push("clear-selection-state"),
    isDesktopMouseClipboardEnabled: () => true,
    activateSession: () => calls.push("activate"),
    reassertSessionSize: () => calls.push("reassert-size"),
    prepareSelectionManager: () => calls.push("prepare-selection"),
    sendInput: (_session, data) => sent.push(data),
    dragThresholdPx: 4,
  });
  controller.start();
  const cleanup = controller.bindDesktopSession(session);
  assert.deepEqual(calls, ["prepare-selection"]);

  shell.emit("mousedown", { button: 0, target, clientX: 10, clientY: 10 });
  assert.deepEqual(calls, ["prepare-selection", "clear-selection-state"]);
  documentObject.emit("mousemove", { clientX: 18, clientY: 10 });
  documentObject.emit("mouseup", { button: 0 });
  await Promise.resolve();
  assert.deepEqual(copied, ["dragged"]);

  const middleDown = { button: 1, target, prevented: false, preventDefault() { this.prevented = true; } };
  shell.emit("mousedown", middleDown);
  assert.equal(middleDown.prevented, true);
  const aux = { button: 1, target, prevented: false, preventDefault() { this.prevented = true; } };
  shell.emit("auxclick", aux);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(aux.prevented, true);
  assert.deepEqual(calls, ["prepare-selection", "clear-selection-state", "activate", "activate", "reassert-size"]);
  assert.deepEqual(sent, ["middle paste"]);

  cleanup();
  cleanup();
  shell.emit("mousedown", { button: 0, target, clientX: 0, clientY: 0 });
  documentObject.emit("mousemove", { clientX: 20, clientY: 0 });
  documentObject.emit("mouseup", { button: 0 });
  await Promise.resolve();
  assert.deepEqual(copied, ["dragged"]);

  controller.dispose();
  controller.dispose();
});
