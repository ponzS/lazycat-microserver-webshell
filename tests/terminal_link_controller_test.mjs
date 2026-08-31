import assert from "node:assert/strict";
import test from "node:test";

import {
  createTerminalLinkController,
  findFirstTerminalURL,
  findTerminalURLAtPosition,
} from "../runtime/static/terminal/interaction/index.js";

const createLine = (value, { wrapped = false } = {}) => {
  const cells = Array.from(value, (chars) => ({
    getChars: () => chars,
    getWidth: () => 1,
  }));
  return {
    isWrapped: wrapped,
    length: cells.length,
    getCell: (index) => cells[index] || null,
  };
};

const createTerminal = (lines) => ({
  buffer: {
    active: {
      length: lines.length,
      getLine: (index) => lines[index] || null,
    },
  },
  canvas: {
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 300, bottom: 40 }),
  },
  cols: 30,
  rows: 2,
  viewportY: 0,
  getViewportY() { return this.viewportY; },
  renderer: { charWidth: 10, charHeight: 20 },
  wasmTerm: { getScrollbackLength: () => 0 },
});

test("terminal link model finds schemes, trims punctuation, and maps wrapped cells", () => {
  assert.equal(
    findFirstTerminalURL("open https://example.test/path?value=1, then continue"),
    "https://example.test/path?value=1",
  );
  assert.equal(findFirstTerminalURL("connect ssh://host.test/path"), "ssh://host.test/path");
  assert.equal(findFirstTerminalURL("no link"), "");

  const term = createTerminal([
    createLine("visit https://exam", { wrapped: true }),
    createLine("ple.test/path, done"),
  ]);
  const link = findTerminalURLAtPosition({ term }, 15, 25);
  assert.deepEqual(link, {
    url: "https://example.test/path",
    start: { row: 0, col: 6 },
    end: { row: 1, col: 12 },
  });
  assert.equal(findTerminalURLAtPosition({ term }, 250, 25), null);
});

test("terminal link controller owns open/copy feedback and rejects disposed work", async () => {
  const opened = [];
  const copied = [];
  const toasts = [];
  const controller = createTerminalLinkController({
    windowObject: {
      open: (...args) => opened.push(args),
    },
    copyText: async (value) => {
      copied.push(value);
      return true;
    },
    showToast: (message) => toasts.push(message),
  });

  controller.start();
  controller.start();
  assert.equal(controller.open("https://example.test"), true);
  assert.deepEqual(opened, [["https://example.test", "_blank", "noopener,noreferrer"]]);
  assert.equal(await controller.copy("https://example.test"), true);
  assert.deepEqual(copied, ["https://example.test"]);
  assert.deepEqual(toasts, ["链接已复制。"]);

  let resolveCopy;
  const pendingController = createTerminalLinkController({
    copyText: () => new Promise((resolve) => { resolveCopy = resolve; }),
    showToast: (message) => toasts.push(message),
  });
  const pending = pendingController.copy("https://late.test");
  pendingController.dispose();
  pendingController.dispose();
  resolveCopy(true);
  assert.equal(await pending, false);
  assert.deepEqual(toasts, ["链接已复制。"]);
  assert.equal(pendingController.open("https://after-dispose.test"), false);
  assert.equal(pendingController.findFirst("https://after-dispose.test"), "");
  assert.equal(pendingController.findAtPosition({}, 0, 0), null);
});
