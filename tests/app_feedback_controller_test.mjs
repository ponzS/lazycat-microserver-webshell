import assert from "node:assert/strict";
import test from "node:test";

import { createAppFeedbackController } from "../runtime/static/app/feedback/index.js";

const makeWindow = () => {
  let nextID = 0;
  const timers = new Map();
  return {
    timers,
    setTimeout(callback) {
      const id = ++nextID;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    runTimers() {
      for (const callback of [...timers.values()]) callback();
      timers.clear();
    },
  };
};

test("feedback controller owns toast timer and startup error panel", () => {
  const windowObject = makeWindow();
  const toast = { hidden: true, textContent: "" };
  const panel = { hidden: true };
  const text = { textContent: "" };
  const controller = createAppFeedbackController({ windowObject, toast, startupErrorPanel: panel, startupErrorText: text });
  assert.equal(controller.showToast("hello"), true);
  assert.equal(toast.hidden, false);
  assert.equal(toast.textContent, "hello");
  assert.equal(controller.showStartupError("  failed  "), true);
  assert.equal(text.textContent, "failed");
  assert.equal(panel.hidden, false);
  windowObject.runTimers();
  assert.equal(toast.hidden, true);
  assert.equal(controller.hideStartupError(), true);
  assert.equal(panel.hidden, true);
  assert.equal(text.textContent, "");
});

test("feedback dispose fences late toast callbacks and is idempotent", () => {
  const windowObject = makeWindow();
  const toast = { hidden: true, textContent: "" };
  const controller = createAppFeedbackController({ windowObject, toast });
  controller.showToast("before dispose");
  assert.equal(controller.dispose(), true);
  assert.equal(windowObject.timers.size, 0);
  assert.equal(controller.dispose(), false);
  assert.equal(controller.showToast("after dispose"), false);
  assert.equal(toast.textContent, "before dispose");
});
