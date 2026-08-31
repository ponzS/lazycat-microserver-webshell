import assert from "node:assert/strict";
import test from "node:test";

import {
  createTerminalPolicyController,
  isGrokExecutableToken,
  isGrokTerminalSession,
  isOfficialGrokEntrypoint,
  terminalCommandLineTokens,
  terminalLocationDescription,
} from "../runtime/static/terminal/policy/index.js";

test("terminal policy identifies exact Grok entrypoints without substring matches", () => {
  assert.deepEqual(
    terminalCommandLineTokens("node '/opt/@xai-official/grok/bin.js' --safe"),
    ["node", "/opt/@xai-official/grok/bin.js", "--safe"],
  );
  assert.equal(isGrokExecutableToken("/usr/local/bin/grok-1.2.3"), true);
  assert.equal(isOfficialGrokEntrypoint("@xai-official/grok"), true);
  assert.equal(isOfficialGrokEntrypoint("my-grok-wrapper"), false);
  assert.equal(isGrokTerminalSession({ command: "bash", processCommandLine: "node @xai-official/grok" }), true);
  assert.equal(isGrokTerminalSession({ command: "bash", title: "Grok" }), true);
  assert.equal(isGrokTerminalSession({ command: "bash", processCommandLine: "node my-grok-wrapper" }), false);
});

test("terminal policy routes Claude candidates and scrolls only eligible sessions", () => {
  const candidateCalls = [];
  const cancelled = [];
  const normalized = [];
  const scrolled = [];
  const session = {
    name: "demo",
    tabId: "tab-1",
    id: "pane-1",
    term: {
      scrollAnimationFrame: 42,
      scrollToBottom: () => scrolled.push("bottom"),
      stopTouchInertia: () => scrolled.push("inertia-stop"),
    },
  };
  const controller = createTerminalPolicyController({
    windowObject: { cancelAnimationFrame: (id) => cancelled.push(id) },
    captureViewport: () => ({ atBottom: true }),
    normalizeBottomViewport: (term) => normalized.push(term),
    hasMouseTracking: () => true,
    isTouchSelectionLayout: () => true,
    shouldSuppressContextMenu: () => true,
    claudeTouchCandidate: (...args) => { candidateCalls.push(["touch", ...args]); return true; },
    claudeContextMenuCandidate: (...args) => { candidateCalls.push(["menu", ...args]); return true; },
    claudeDesktopSelectionCandidate: (...args) => { candidateCalls.push(["selection", ...args]); return true; },
  });

  assert.equal(controller.isClaudeFullscreenTouchSession(session), true);
  assert.equal(controller.isClaudeFullscreenContextMenuEvent(session, { button: 2 }), true);
  assert.equal(controller.isClaudeFullscreenDesktopSelectionEvent(session, {
    button: 0,
    ctrlKey: true,
  }), true);
  assert.equal(candidateCalls[0][1], session);
  assert.deepEqual(candidateCalls[0][2], { mouseTracking: true });
  assert.deepEqual(candidateCalls[1][2], {
    mouseTracking: true,
    button: 2,
    contextMenuSuppressed: true,
  });
  assert.deepEqual(candidateCalls[2][2], {
    mouseTracking: true,
    button: 0,
    touchSelectionLayout: true,
    applicationModifier: true,
  });

  assert.equal(controller.scrollTerminalToBottomForUserInput(session), true);
  assert.deepEqual(cancelled, [42]);
  assert.deepEqual(normalized, [session.term]);
  assert.deepEqual(scrolled, ["inertia-stop"]);
  assert.equal(session.term.scrollAnimationFrame, undefined);
  assert.equal(controller.terminalLocationDescription(session), terminalLocationDescription(session));
});

test("terminal policy rejects closed/dialog sessions and fences disposal", () => {
  let dialogOpen = true;
  const controller = createTerminalPolicyController({ isDialogOpen: () => dialogOpen });
  const session = { closed: false, term: { scrollToBottom() {} } };
  assert.equal(controller.scrollTerminalToBottomForUserInput(session), false);
  dialogOpen = false;
  session.closed = true;
  assert.equal(controller.scrollTerminalToBottomForUserInput(session), false);
  assert.equal(controller.dispose(), true);
  session.closed = false;
  assert.equal(controller.scrollTerminalToBottomForUserInput(session), false);
  assert.equal(controller.dispose(), false);
  assert.equal(controller.isDisposed(), true);
});
