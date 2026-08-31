import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTerminalLogicalLines,
  createTerminalSearchController,
  createTerminalSearchLifecycle,
  findTerminalSearchMatches,
  terminalFullBufferText,
  terminalLogicalLineAt,
} from "../runtime/static/terminal/interaction/index.js";

const createLine = (text, { wrapped = false } = {}) => {
  const cells = Array.from(text, (chars) => ({
    getChars: () => chars,
    getWidth: () => 1,
  }));
  return {
    isWrapped: wrapped,
    length: cells.length,
    getCell: (index) => cells[index] || null,
  };
};

const createTerminal = (lines, { cols = 80, rows = 3, scrollback = 0 } = {}) => {
  const selections = [];
  const scrolls = [];
  return {
    buffer: {
      active: {
        length: lines.length,
        getLine: (index) => lines[index] || null,
      },
    },
    cols,
    rows,
    viewportY: 0,
    wasmTerm: { getScrollbackLength: () => scrollback },
    getViewportY() { return this.viewportY; },
    scrollToLine(value) {
      this.viewportY = value;
      scrolls.push(value);
    },
    select(col, row, length) {
      selections.push({ col, row, length });
    },
    focus() {},
    selections,
    scrolls,
  };
};

test("terminal text model preserves wrapped logical lines and cell positions", () => {
  const term = createTerminal([
    createLine("hello", { wrapped: true }),
    createLine(" world  "),
    createLine("HELLO"),
  ], { cols: 5, rows: 2, scrollback: 1 });

  const lines = buildTerminalLogicalLines(term);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, "hello world");
  assert.deepEqual(lines[0].positions[6], { row: 1, col: 1 });
  assert.equal(terminalFullBufferText(term), "hello world\nHELLO");
  assert.deepEqual(terminalLogicalLineAt(term, 1), lines[0]);
  assert.deepEqual(findTerminalSearchMatches(term, "WORLD"), [
    { row: 1, col: 1, length: 5 },
  ]);
  assert.deepEqual(findTerminalSearchMatches(term, "hello"), [
    { row: 0, col: 0, length: 5 },
    { row: 2, col: 0, length: 5 },
  ]);
});

const createViewHarness = () => {
  let open = false;
  let query = "";
  const counts = [];
  let focusCount = 0;
  return {
    view: {
      elements: { close: {}, input: {}, next: {}, previous: {} },
      canOpen: () => true,
      close: () => { open = false; },
      dispose: () => { open = false; },
      focusAndSelect: () => { focusCount += 1; },
      isOpen: () => open,
      open(value) {
        open = true;
        query = String(value || "");
        return true;
      },
      readQuery: () => query,
      setCount: (current, total) => counts.push([current, total]),
      setQuery: (value) => { query = String(value || ""); },
    },
    counts,
    get focusCount() { return focusCount; },
    get query() { return query; },
    isOpen: () => open,
  };
};

const createLifecycleHarness = () => {
  let handlers = null;
  let focusTask = null;
  let starts = 0;
  let disposes = 0;
  return {
    factory(options) {
      handlers = options.handlers;
      return {
        dispose() { disposes += 1; focusTask = null; },
        focusInput(callback) { focusTask = callback; },
        start() { starts += 1; },
      };
    },
    get disposes() { return disposes; },
    get handlers() { return handlers; },
    runFocus() { const task = focusTask; focusTask = null; task?.(); },
    get starts() { return starts; },
  };
};

test("search controller owns query, match navigation, selection seed and disposal", () => {
  const term = createTerminal([createLine("one two one")], { rows: 1 });
  const session = { id: "pane-1", term };
  const viewHarness = createViewHarness();
  const lifecycle = createLifecycleHarness();
  const calls = [];
  let seed = "  two\n value  ";
  const controller = createTerminalSearchController({
    view: viewHarness.view,
    lifecycleFactory: lifecycle.factory.bind(lifecycle),
    getActiveSession: () => session,
    getSearchSeed: () => seed,
    closeContextMenu: () => calls.push("close-menu"),
    refreshOverlayLayout: () => calls.push("refresh-layout"),
    focusSession: () => calls.push("focus-terminal"),
    showToast: (message) => calls.push(message),
  });

  controller.start();
  controller.start();
  assert.equal(lifecycle.starts, 1);
  assert.equal(controller.open(), true);
  assert.equal(controller.isOpen(), true);
  assert.deepEqual(calls, ["close-menu", "refresh-layout"]);
  lifecycle.runFocus();
  assert.equal(viewHarness.focusCount, 1);

  lifecycle.handlers.onInput({ target: { value: "one" } });
  assert.deepEqual(term.selections.at(-1), { col: 0, row: 0, length: 3 });
  assert.deepEqual(viewHarness.counts.at(-1), [1, 2]);

  lifecycle.handlers.onInputKeydown({ key: "Enter", preventDefault() {} });
  assert.deepEqual(term.selections.at(-1), { col: 8, row: 0, length: 3 });
  lifecycle.handlers.onInputKeydown({ key: "Enter", shiftKey: true, preventDefault() {} });
  assert.deepEqual(term.selections.at(-1), { col: 0, row: 0, length: 3 });

  assert.equal(controller.openFromSelection(), true);
  assert.equal(viewHarness.query, "two value");
  seed = "";
  assert.equal(controller.openFromSelection(), false);
  assert.ok(calls.includes("没有可搜索的选区。"));

  lifecycle.handlers.onClose();
  assert.equal(controller.isOpen(), false);
  assert.ok(calls.includes("focus-terminal"));

  controller.dispose();
  controller.dispose();
  assert.equal(lifecycle.disposes, 1);
  assert.equal(controller.open(), false);
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
    this.listeners.set(type, (this.listeners.get(type) || []).filter((candidate) => candidate !== listener));
  }

  emit(type, event = {}) {
    for (const listener of [...(this.listeners.get(type) || [])]) {
      listener(event);
    }
  }
}

test("search lifecycle removes listeners and cancels deferred focus idempotently", () => {
  const input = new FakeEventTarget();
  const previous = new FakeEventTarget();
  const next = new FakeEventTarget();
  const close = new FakeEventTarget();
  const calls = [];
  const timers = new Map();
  let timerID = 0;
  const windowObject = {
    setTimeout(callback) {
      timerID += 1;
      timers.set(timerID, callback);
      return timerID;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  const lifecycle = createTerminalSearchLifecycle({
    windowObject,
    elements: { close, input, next, previous },
    handlers: {
      onClose: () => calls.push("close"),
      onInput: () => calls.push("input"),
      onInputKeydown: () => calls.push("keydown"),
      onNext: () => calls.push("next"),
      onPrevious: () => calls.push("previous"),
    },
  });

  lifecycle.start();
  lifecycle.start();
  input.emit("input");
  input.emit("keydown");
  previous.emit("click");
  next.emit("click");
  close.emit("click");
  assert.deepEqual(calls, ["input", "keydown", "previous", "next", "close"]);

  lifecycle.focusInput(() => calls.push("stale-focus"));
  lifecycle.focusInput(() => calls.push("focus"));
  assert.equal(timers.size, 1);
  for (const callback of timers.values()) {
    callback();
  }
  timers.clear();
  assert.equal(calls.at(-1), "focus");

  lifecycle.focusInput(() => calls.push("disposed-focus"));
  lifecycle.dispose();
  lifecycle.dispose();
  assert.equal(timers.size, 0);
  input.emit("input");
  assert.equal(calls.at(-1), "focus");
});
