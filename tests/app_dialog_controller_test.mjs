import assert from "node:assert/strict";
import test from "node:test";

import { createDialogController } from "../runtime/static/app/index.js";

class FakeElement {
  constructor() {
    this.hidden = false;
    this.dataset = {};
    this.textContent = "";
    this.value = "";
    this.listeners = new Map();
    this.focusCount = 0;
    this.selectCount = 0;
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
      target: this,
      currentTarget: this,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...init,
    };
    for (const { listener } of [...(this.listeners.get(type) || [])]) {
      listener(event);
    }
    return event;
  }

  count(type) {
    return (this.listeners.get(type) || []).length;
  }

  focus() {
    this.focusCount += 1;
  }

  select() {
    this.selectCount += 1;
  }
}

const createWindow = () => {
  let nextTimer = 1;
  const timers = new Map();
  return {
    setTimeout(callback) {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    runTimers() {
      for (const [id, callback] of [...timers]) {
        timers.delete(id);
        callback();
      }
    },
    confirm: () => true,
    prompt: (_title, value) => value,
  };
};

const createHarness = () => {
  const elements = {
    backdrop: new FakeElement(),
    panel: new FakeElement(),
    title: new FakeElement(),
    message: new FakeElement(),
    input: new FakeElement(),
    ok: new FakeElement(),
    cancel: new FakeElement(),
    container: new FakeElement(),
    scrim: new FakeElement(),
    handle: new FakeElement(),
    mobileTitle: new FakeElement(),
    mobileMessage: new FakeElement(),
    actions: new FakeElement(),
    mobileOK: new FakeElement(),
    mobileCancel: new FakeElement(),
  };
  const windowObject = createWindow();
  let focusCount = 0;
  let actionSheetCloseCount = 0;
  const controller = createDialogController({
    windowObject,
    documentObject: {},
    dialog: elements,
    mobileSheet: {
      container: elements.container,
      scrim: elements.scrim,
      handle: elements.handle,
      title: elements.mobileTitle,
      message: elements.mobileMessage,
      actions: elements.actions,
      ok: elements.mobileOK,
      cancel: elements.mobileCancel,
    },
    isMobileLayout: () => true,
    closeMobileActionSheet: () => {
      actionSheetCloseCount += 1;
    },
    focusActiveTerminal: () => {
      focusCount += 1;
    },
  });
  return {
    controller,
    elements,
    windowObject,
    getFocusCount: () => focusCount,
    getActionSheetCloseCount: () => actionSheetCloseCount,
  };
};

test("dialog controller resolves confirm and prompt through its owned DOM", async () => {
  const harness = createHarness();
  const { controller, elements, windowObject } = harness;
  assert.equal(controller.install(), true);

  const confirmation = controller.confirmDialog("Delete item", {
    title: "Danger",
    okText: "Delete",
    cancelText: "Keep",
    danger: true,
  });
  assert.equal(controller.isDialogOpen(), true);
  assert.equal(elements.backdrop.hidden, false);
  assert.equal(elements.backdrop.dataset.mode, "confirm");
  assert.equal(elements.backdrop.dataset.danger, "true");
  assert.equal(elements.title.textContent, "Danger");
  assert.equal(elements.message.textContent, "Delete item");
  assert.equal(elements.ok.textContent, "Delete");
  assert.equal(elements.cancel.textContent, "Keep");
  elements.panel.dispatch("submit");
  assert.equal(await confirmation, true);
  assert.equal(controller.isDialogOpen(), false);
  assert.equal(elements.backdrop.hidden, true);

  const prompt = controller.promptDialog("Rename", "old");
  assert.equal(elements.input.hidden, false);
  assert.equal(elements.input.value, "old");
  windowObject.runTimers();
  assert.equal(elements.input.focusCount, 1);
  assert.equal(elements.input.selectCount, 1);
  elements.input.value = "  new-name  ";
  elements.panel.dispatch("submit");
  assert.equal(await prompt, "new-name");
  windowObject.runTimers();
  assert.equal(harness.getFocusCount(), 2);
});

test("dialog controller closes the previous request and handles Escape", async () => {
  const harness = createHarness();
  const { controller, elements } = harness;
  controller.install();

  const first = controller.openDialog({ message: "first" });
  const second = controller.openDialog({ message: "second" });
  assert.equal(await first, false);
  assert.equal(controller.isDialogOpen(), true);
  const event = controller.handleEscape({ key: "Escape", preventDefault() { this.prevented = true; } });
  assert.equal(event, true);
  assert.equal(await second, false);
  assert.equal(elements.backdrop.hidden, true);
});

test("mobile close sheet owns focus, layout and cleanup", async () => {
  const harness = createHarness();
  const { controller, elements, windowObject } = harness;
  controller.install();

  const pending = controller.confirmMobileSheet({
    title: "Running command",
    message: "Stop it?",
    okText: "Stop",
    cancelText: "Wait",
    actionsLayout: "vertical-ok-first",
    initialFocus: "ok",
  });
  assert.equal(elements.container.hidden, false);
  assert.equal(elements.mobileTitle.textContent, "Running command");
  assert.equal(elements.mobileMessage.textContent, "Stop it?");
  assert.equal(elements.actions.dataset.layout, "vertical-ok-first");
  assert.equal(harness.getActionSheetCloseCount(), 1);
  windowObject.runTimers();
  assert.equal(elements.mobileOK.focusCount, 1);
  elements.mobileOK.dispatch("click");
  assert.equal(await pending, true);

  const escaped = controller.confirmMobileClose();
  assert.equal(controller.handleEscape({ key: "Escape", preventDefault() {} }), true);
  assert.equal(await escaped, false);

  const disposedPending = controller.confirmDialog("dispose");
  assert.equal(controller.dispose(), true);
  assert.equal(await disposedPending, false);
  assert.equal(controller.dispose(), false);
  assert.equal(elements.panel.count("submit"), 0);
  assert.equal(controller.openDialog({ message: "after dispose" }) instanceof Promise, true);
  assert.equal(await controller.openDialog({ message: "after dispose" }), false);
});
