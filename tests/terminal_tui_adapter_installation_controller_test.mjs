import assert from "node:assert/strict";
import test from "node:test";

import { createTerminalTUIAdapterInstaller } from "../runtime/static/terminal/tui_adapters/index.js";

class FakeElement {
  constructor(host = null) {
    this.host = host;
  }

  closest(selector) {
    return selector === ".terminal-host" ? this.host : null;
  }
}

const createSession = () => {
  const host = new FakeElement();
  const target = new FakeElement(host);
  return {
    id: "pane-1",
    tabId: "tab-1",
    shellEl: new FakeElement(),
    terminalHost: host,
    term: { renderer: { charHeight: 20 } },
    target,
  };
};

test("TUI installation controller routes tool adapters with explicit session actions", () => {
  const session = createSession();
  const calls = [];
  const captured = {};
  const mouse = {
    hasTracking: () => true,
    sendWheel: (...args) => calls.push(["wheel", args]),
    sendClick: (...args) => calls.push(["click", args]),
    claimEvent: (event) => calls.push(["claim", event]),
  };
  const installer = createTerminalTUIAdapterInstaller({
    ElementCtor: FakeElement,
    isTouchShortcutLayout: () => true,
    isMobileMenuOpen: () => false,
    isClaudeTouchSession: () => true,
    isClaudeContextMenuEvent: () => true,
    isClaudeDesktopSelectionEvent: () => true,
    getTerminalMouse: () => mouse,
    getTerminalIME: () => ({
      blurInput: (...args) => calls.push(["blur", args]),
      consumeKeyboardClaim: () => false,
    }),
    getTerminalSelection: () => ({
      cellFromPoint: () => ({ row: 1, col: 1 }),
      hasSelection: () => false,
    }),
    getTerminalResize: () => ({ claimSize: (...args) => calls.push(["claim-size", args]) }),
    getTabById: () => ({ id: "tab-1" }),
    setActivePane: (...args) => calls.push(["activate", args]),
    markContextMenuCandidate: (touch) => calls.push(["candidate", touch]),
    registerCleanup: (...args) => calls.push(["cleanup", args]),
    installClaudeFullscreenTouchAdapter: (options) => { captured.claude = options; },
    installOpencodeFullscreenTouchAdapter: (options) => { captured.opencode = options; },
    installHerdrFullscreenTouchAdapter: (options) => { captured.herdr = options; },
    installPiFullscreenTouchAdapter: (options) => { captured.pi = options; },
    installClaudeFullscreenContextMenuAdapter: (options) => { captured.context = options; },
    installClaudeFullscreenDesktopSelectionAdapter: (options) => { captured.desktop = options; },
    isOpencodeFullscreenTouchCandidate: () => true,
    isHerdrFullscreenTouchCandidate: () => true,
    isPiFullscreenTouchCandidate: () => true,
  });

  assert.equal(installer.installClaudeTouch(session), true);
  assert.equal(installer.installOpencodeTouch(session), true);
  assert.equal(installer.installHerdrTouch(session), true);
  assert.equal(installer.installPiTouch(session), true);
  assert.equal(installer.installClaudeContextMenu(session), true);
  assert.equal(installer.installClaudeDesktopSelection(session), true);
  assert.ok(captured.claude && captured.opencode && captured.herdr && captured.pi);
  assert.ok(captured.context && captured.desktop);

  const touchEvent = { touches: [{}], target: session.target };
  assert.equal(captured.claude.shouldStart(touchEvent), true);
  assert.equal(captured.opencode.shouldStart(touchEvent), true);
  assert.equal(captured.herdr.shouldStart(touchEvent), true);
  assert.equal(captured.pi.shouldStart(touchEvent), true);
  captured.claude.activatePane();
  captured.claude.prepareMouseInput();
  assert.ok(calls.some(([name]) => name === "activate"));
  assert.ok(calls.some(([name]) => name === "claim-size"));
});

test("TUI installation controller rejects invalid sessions and inactive layouts", () => {
  let installed = 0;
  const installer = createTerminalTUIAdapterInstaller({
    isTouchShortcutLayout: () => false,
    installOpencodeFullscreenTouchAdapter: () => { installed += 1; },
  });
  assert.equal(installer.installOpencodeTouch({}), false);
  assert.equal(installed, 0);
});
