import assert from "node:assert/strict";
import test from "node:test";

import {
  createAppPasteController,
  formatPastedAttachmentPaths,
  nativePasteFiles,
  nativePasteText,
} from "../runtime/static/app/index.js";

const deferred = () => {
  let resolve;
  const promise = new Promise((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
};

const fakeEvent = ({ files = [], items = [], text = "" } = {}) => ({
  clipboardData: {
    files,
    items,
    getData: (type) => type === "text/plain" || type === "text" ? text : "",
  },
  prevented: 0,
  stopped: 0,
  immediate: 0,
  preventDefault() { this.prevented += 1; },
  stopPropagation() { this.stopped += 1; },
  stopImmediatePropagation() { this.immediate += 1; },
});

test("paste model prefers DataTransfer file items and formats paths without newlines", () => {
  const file = { name: "screen.png", size: 12, type: "image/png" };
  const data = {
    files: [{ name: "duplicate.png", size: 12, type: "image/png" }],
    items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
    getData: (type) => type === "text/plain" ? "derived text" : "",
  };
  assert.deepEqual(nativePasteFiles(data), [file]);
  assert.equal(nativePasteText(data), "derived text");
  assert.equal(
    formatPastedAttachmentPaths(["/tmp/one.png", "/tmp/it's two.png", "/tmp/bad\npath"]),
    "'/tmp/one.png' '/tmp/it'\"'\"'s two.png'",
  );
});

test("native file paste uploads once, ignores derived text, and returns paths to the origin session", async () => {
  const pending = deferred();
  const uploaded = [];
  const pasted = [];
  const calls = [];
  const session = { id: "pane-a", tabId: "tab-a", name: "alpha", closed: false };
  const file = { name: "screen.png", size: 12, type: "image/png" };
  const controller = createAppPasteController({
    uploadFiles: async (files, options) => {
      uploaded.push({ files, session: options.session });
      return pending.promise;
    },
    pasteText: async (target, text) => { pasted.push([target.id, text]); return true; },
    isSessionValid: (target, result) => !target.closed && result?.tabId === target.tabId,
    reassertSize: (target) => calls.push(["resize", target.id]),
  });
  controller.start();
  const event = fakeEvent({
    files: [file],
    items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
    text: "must-not-be-sent",
  });
  const handled = controller.handleNativePaste(session, event);
  assert.equal(handled.handled, true);
  assert.equal(handled.kind, "files");
  await Promise.resolve();
  assert.deepEqual(uploaded, [{ files: [file], session }]);
  assert.deepEqual(calls, [["resize", "pane-a"]]);
  assert.deepEqual([event.prevented, event.stopped, event.immediate], [1, 1, 1]);
  const duplicate = controller.handleNativePaste(session, event);
  assert.equal(duplicate.duplicate, true);
  assert.equal(uploaded.length, 1);
  pending.resolve({ paths: ["/tmp/screen one.png"], tabId: "tab-a" });
  assert.equal(await handled.completion, true);
  assert.deepEqual(pasted, [["pane-a", "'/tmp/screen one.png'"]]);
});

test("native text paste is sent once and stale file continuations are rejected", async () => {
  const pending = deferred();
  const pasted = [];
  const session = { id: "pane-a", tabId: "tab-a", closed: false };
  const controller = createAppPasteController({
    uploadFiles: async () => pending.promise,
    pasteText: async (_target, text) => { pasted.push(text); return true; },
    isSessionValid: (target) => !target.closed,
  });
  controller.start();
  const textEvent = fakeEvent({ text: "hello" });
  const textResult = controller.handleNativePaste(session, textEvent);
  assert.equal(textResult.kind, "text");
  assert.equal(await textResult.completion, true);
  assert.deepEqual(pasted, ["hello"]);

  const file = { name: "late.bin", size: 1, type: "application/octet-stream" };
  const fileResult = controller.handleNativePaste(session, fakeEvent({ files: [file] }));
  session.closed = true;
  pending.resolve({ paths: ["/tmp/late.bin"], tabId: "tab-a" });
  assert.equal(await fileResult.completion, false);
  assert.deepEqual(pasted, ["hello"]);
  assert.equal(controller.dispose(), true);
  assert.equal(controller.dispose(), false);
  assert.equal(controller.handleNativePaste({ closed: false }, fakeEvent({ text: "after" })).handled, false);
});

test("unsupported clipboard data and synchronous adapter failures are visible and contained", async () => {
  const toasts = [];
  const file = { name: "broken.bin", size: 1, type: "application/octet-stream" };
  const controller = createAppPasteController({
    uploadFiles: () => { throw new Error("upload adapter failed"); },
    showToast: (message) => toasts.push(message),
  });
  controller.start();
  const unsupported = controller.handleNativePaste({ closed: false }, fakeEvent());
  assert.equal(unsupported.kind, "unsupported");
  assert.equal(await unsupported.completion, false);
  const failed = controller.handleNativePaste({ closed: false }, fakeEvent({ files: [file] }));
  assert.equal(await failed.completion, false);
  assert.deepEqual(toasts, [
    "剪贴板没有可粘贴的文本或文件。",
    "upload adapter failed",
  ]);
});
