import assert from "node:assert/strict";
import test from "node:test";

import {
  createTerminalKeyOverridesController,
  isPrintableAsciiCharacter,
  terminalAltMetaInputFromEvent,
} from "../runtime/static/terminal/input/key_overrides/index.js";

class FakeKeyboardEvent {
  constructor(key, options = {}) {
    this.type = "keydown";
    this.key = key;
    Object.assign(this, options);
  }

  getModifierState(name) {
    return name === "AltGraph" && this.altGraph === true;
  }
}

const makeSession = () => {
  const term = {
    customKeyEventHandler: null,
    inputs: [],
    attachCustomKeyEventHandler(handler) {
      this.customKeyEventHandler = handler;
    },
    input(value, user = false) {
      this.inputs.push({ value, user });
    },
  };
  return { closed: false, term };
};

test("Alt printable input uses ESC prefix and respects AltGraph", () => {
  assert.equal(isPrintableAsciiCharacter("a"), true);
  assert.equal(isPrintableAsciiCharacter("é"), false);
  assert.equal(
    terminalAltMetaInputFromEvent(new FakeKeyboardEvent("a", { altKey: true }), {
      KeyboardEventCtor: FakeKeyboardEvent,
    }),
    "\x1ba",
  );
  assert.equal(
    terminalAltMetaInputFromEvent(new FakeKeyboardEvent("a", { altKey: true, altGraph: true }), {
      KeyboardEventCtor: FakeKeyboardEvent,
    }),
    "",
  );
});

test("custom key handler maps font, Alt, sticky and backtab paths", () => {
  const session = makeSession();
  const events = [];
  let sticky = false;
  const controller = createTerminalKeyOverridesController({
    KeyboardEventCtor: FakeKeyboardEvent,
    handleFontSizeShortcut: (event) => event.key === "=",
    hasStickyModifiers: () => sticky,
    shouldApplyStickyTextInput: (value) => value === "x",
    consumeStickyInput: (value) => `sticky:${value}`,
    sendInput: (_session, value) => events.push(value),
  });
  assert.equal(controller.installSession(session), true);
  assert.equal(controller.installSession(session), true);
  assert.equal(session.term.customKeyEventHandler(new FakeKeyboardEvent("=", {})), true);
  assert.equal(session.term.inputs.length, 0);
  assert.equal(
    session.term.customKeyEventHandler(new FakeKeyboardEvent("a", { altKey: true })),
    true,
  );
  assert.deepEqual(session.term.inputs.at(-1), { value: "\x1ba", user: true });
  sticky = true;
  assert.equal(session.term.customKeyEventHandler(new FakeKeyboardEvent("x")), true);
  assert.deepEqual(events, ["sticky:x"]);
  assert.equal(session.term.customKeyEventHandler(new FakeKeyboardEvent("Tab", { shiftKey: true })), true);
  assert.deepEqual(session.term.inputs.at(-1), { value: "\x1b[Z", user: true });
});

test("session cleanup and dispose fence late callbacks", () => {
  const session = makeSession();
  const cleanups = [];
  const controller = createTerminalKeyOverridesController({
    KeyboardEventCtor: FakeKeyboardEvent,
    registerSessionCleanup: (_session, cleanup) => cleanups.push(cleanup),
  });
  assert.equal(controller.installSession(session), true);
  const handler = session.term.customKeyEventHandler;
  cleanups[0]();
  assert.equal(handler(new FakeKeyboardEvent("a", { altKey: true })), false);
  assert.equal(session.term.customKeyEventHandler, null);
  assert.equal(controller.dispose(), true);
  assert.equal(controller.installSession(makeSession()), false);
});
