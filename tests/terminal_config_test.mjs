import assert from "node:assert/strict";
import test from "node:test";

import {
  TERMINAL_RUNTIME_CONFIG,
  TERMINAL_STORAGE_PREFIX,
} from "../runtime/static/terminal/config/index.js";

test("terminal config exposes stable defaults and is immutable", () => {
  assert.equal(TERMINAL_STORAGE_PREFIX, "webshell");
  assert.equal(TERMINAL_RUNTIME_CONFIG.touchShortcutMoveThresholdPx, 8);
  assert.equal(TERMINAL_RUNTIME_CONFIG.terminalClientDirectWebSocketCapacity, 3);
  assert.equal(TERMINAL_RUNTIME_CONFIG.terminalCacheV2ReplayTimeoutMs, 2000);
  assert.equal(Object.isFrozen(TERMINAL_RUNTIME_CONFIG), true);

  assert.throws(() => {
    TERMINAL_RUNTIME_CONFIG.touchShortcutMoveThresholdPx = 99;
  }, TypeError);
  assert.equal(TERMINAL_RUNTIME_CONFIG.touchShortcutMoveThresholdPx, 8);
});
