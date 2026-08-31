import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTerminalCheckpoint,
  terminalCheckpointCapabilities,
  terminalCheckpointCapabilitiesForTerminal,
  exportTerminalCheckpoint,
  importTerminalCheckpoint,
  terminalCheckpointIsUsable,
  negotiateTerminalCheckpointProtocol,
  terminalCheckpointProtocol,
} from "../runtime/static/terminal/history/index.js";

const checkpoint = (overrides = {}) => ({
  protocol: terminalCheckpointProtocol,
  checkpoint_id: "cp-7",
  identity: {
    selector: "demo@owner",
    pane_id: "pane-1",
    history_generation: "history-4",
  },
  checkpoint_cursor: "1000",
  geometry: { cols: 120, rows: 32 },
  state: {
    modes: {
      alternate_screen: false,
      origin: false,
      wraparound: true,
      insert: false,
      application_cursor: false,
      bracketed_paste: false,
    },
    cursor: { row: 4, col: 12, visible: true },
    screen: {
      rows: 32,
      cols: 120,
      alternate: false,
      lines: Array.from({ length: 32 }, () => ({ text: "", wrapped: false })),
    },
  },
  tail: { start_cursor: "1000", end_cursor: "1012", byte_length: 12 },
  ...overrides,
});

test("checkpoint export and import both pass through semantic validation", () => {
  let imported = null;
  const adapter = {
    exportSemanticState() { return checkpoint(); },
    importSemanticState(state) { imported = state; },
  };
  const exported = exportTerminalCheckpoint(adapter, {
    identity: { selector: "demo@owner", paneID: "pane-1", historyGeneration: "history-4" },
    checkpointCursor: "1000",
  });
  assert.equal(exported.protocol, terminalCheckpointProtocol);
  const restored = importTerminalCheckpoint(adapter, exported, {
    expectedIdentity: exported.identity,
  });
  assert.equal(restored.checkpointID, "cp-7");
  assert.equal(imported.screen.rows, 32);
});

test("checkpoint export rejects invalid adapter state", () => {
  let imported = false;
  const adapter = {
    exportSemanticState() {
      const value = checkpoint();
      delete value.state.modes.bracketed_paste;
      return value;
    },
    importSemanticState() { imported = true; },
  };
  assert.throws(() => exportTerminalCheckpoint(adapter, {
    identity: { selector: "demo@owner", paneID: "pane-1", historyGeneration: "history-4" },
    checkpointCursor: "1000",
  }), /mode bracketed_paste is missing/);
  assert.equal(imported, false);
});

test("checkpoint import rejects a stale identity before touching the adapter", () => {
  let imported = false;
  const adapter = {
    exportSemanticState() { return checkpoint(); },
    importSemanticState() { imported = true; },
  };
  assert.throws(() => importTerminalCheckpoint(adapter, checkpoint(), {
    expectedIdentity: { selector: "demo@owner", paneID: "pane-9", historyGeneration: "history-4" },
  }), /identity does not match/);
  assert.equal(imported, false);
});

test("checkpoint capability detects a complete adapter object", () => {
  assert.equal(terminalCheckpointCapabilitiesForTerminal({
    getSemanticCheckpointAdapter() {
      return { exportSemanticState() {}, importSemanticState() {} };
    },
  }).length, 1);
});

test("current terminal API does not advertise an incomplete checkpoint adapter", () => {
  assert.equal(terminalCheckpointCapabilitiesForTerminal({ getMode() { return true; } }).length, 0);
  assert.equal(terminalCheckpointCapabilitiesForTerminal({
    exportSemanticState() {},
    importSemanticState() {},
  }).length, 1);
});

test("checkpoint capability stays disabled without semantic state import and export", () => {
  assert.deepEqual(terminalCheckpointCapabilities({ semanticStateExport: true }), []);
  assert.deepEqual(terminalCheckpointCapabilities({ semanticStateImport: true }), []);
});

test("checkpoint capability negotiates the smaller bounded tail", () => {
  const local = terminalCheckpointCapabilities({ semanticStateExport: true, semanticStateImport: true });
  const negotiated = negotiateTerminalCheckpointProtocol({
    localCapabilities: local,
    remoteCapabilities: [{ protocol: terminalCheckpointProtocol, maxTailBytes: 1024 * 1024 }],
  });
  assert.deepEqual(negotiated, { protocol: terminalCheckpointProtocol, maxTailBytes: 1024 * 1024 });
});

test("checkpoint capability rejects a remote offer without a bounded tail", () => {
  const local = terminalCheckpointCapabilities({ semanticStateExport: true, semanticStateImport: true });
  assert.equal(negotiateTerminalCheckpointProtocol({
    localCapabilities: local,
    remoteCapabilities: [{ protocol: terminalCheckpointProtocol, maxTailBytes: 0 }],
  }), null);
});
test("semantic checkpoint validates identity, state, and bounded tail", () => {
  const normalized = normalizeTerminalCheckpoint(checkpoint());
  assert.equal(normalized.checkpointCursor, "1000");
  assert.equal(normalized.tail.endCursor, "1012");
  assert.equal(normalized.state.screen.lines.length, 32);
});

test("semantic checkpoint rejects incomplete modes and inconsistent geometry", () => {
  const incomplete = checkpoint();
  delete incomplete.state.modes.bracketed_paste;
  assert.equal(terminalCheckpointIsUsable(incomplete), false);
  assert.equal(terminalCheckpointIsUsable(checkpoint({ geometry: { cols: 80, rows: 24 } })), false);
});

test("semantic checkpoint rejects a cursor outside the screen", () => {
  const value = checkpoint();
  value.state.cursor.row = 32;
  assert.equal(terminalCheckpointIsUsable(value), false);
});
test("semantic checkpoint rejects an arbitrary tail cursor", () => {
  assert.equal(terminalCheckpointIsUsable(checkpoint({
    tail: { start_cursor: "999", end_cursor: "1011", byte_length: 12 },
  })), false);
});

test("semantic checkpoint rejects identity changes", () => {
  assert.throws(() => normalizeTerminalCheckpoint(checkpoint(), {
    expectedIdentity: {
      selector: "demo@owner",
      paneID: "pane-2",
      historyGeneration: "history-4",
    },
  }), /identity does not match/);
});

test("semantic checkpoint rejects an oversized tail window", () => {
  assert.equal(terminalCheckpointIsUsable(checkpoint({
    tail: { start_cursor: "1000", end_cursor: String(1000 + 33 * 1024 * 1024), byte_length: 33 * 1024 * 1024 },
  })), false);
});

test("semantic checkpoint rejects missing screen semantics", () => {
  const value = checkpoint();
  delete value.state.screen;
  assert.equal(terminalCheckpointIsUsable(value), false);
});
