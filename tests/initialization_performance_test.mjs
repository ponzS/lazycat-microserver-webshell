import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  createInitializationPerformance,
  createStartupDiagnostics,
} from "../runtime/static/diagnostics/index.js";

test("initialization performance panel keeps its event target and scroll list", () => {
  const style = fs.readFileSync(new URL("../runtime/static/style.css", import.meta.url), "utf8");
  assert.match(style, /\.initialization-performance-panel \{[\s\S]*?pointer-events: auto;[\s\S]*?user-select: text;[\s\S]*?touch-action: pan-y;/);
  assert.match(style, /\.initialization-performance-list \{[\s\S]*?overflow: auto;/);
  assert.match(style, /\.initialization-performance-row\.is-pending/);
});


test("initialization performance is disabled by default and freezes after first terminal render", () => {
  let clock = 100;
  const startup = createStartupDiagnostics({ now: () => clock });
  const changes = [];
  const performance = createInitializationPerformance({
    startupDiagnostics: startup,
    now: () => clock,
    onChange: (snapshot) => changes.push(snapshot),
  });

  assert.equal(performance.snapshot().status, "idle");
  performance.recordStartupEvent("should_not_be_recorded");
  assert.equal(changes.length, 0);

  performance.setEnabled(true);
  performance.recordStartupEvent("物理通道服务端已就绪", {
    serverPrepareDurationMs: 42,
    serverAgentEnsureDurationMs: 30,
    cookie: "must-not-be-retained",
  });
  let collecting = performance.snapshot();
  assert.equal(collecting.status, "collecting");
  assert.ok(collecting.rows.some((row) => row.name === "物理通道服务端已就绪"));
  assert.equal(collecting.rows.at(-1)?.pending, true);
  assert.equal(collecting.totalMs, 0);
  clock = 130;
  assert.equal(performance.refresh(), true);
  collecting = performance.snapshot();
  assert.equal(collecting.totalMs, 30);
  assert.equal(collecting.rows.at(-1)?.durationMs, 30);
  assert.equal(changes.at(-1)?.totalMs, 30);
  clock = 150;
  startup.mark("ghosttyReadyAt");
  performance.recordStartupEvent("Ghostty WASM 已就绪");
  const session = { id: "pane-1" };
  performance.recordTerminalEvent(session, "connect_session_start", {
    reason: "test_connect",
    renderReady: false,
    token: "must-not-be-retained",
  });
  clock = 180;
  performance.recordTerminalEvent(session, "agent_attach_ready", {
    serverUnixMs: 1700000000200,
    agentAttachPrepareDurationMs: 80,
    agentHistorySnapshotDurationMs: 50,
    selector: "must-not-be-retained",
  });
  collecting = performance.snapshot();
  assert.equal(collecting.sessionID, "pane-1");
  assert.ok(collecting.rows.some((row) => row.name === "agent_attach_ready"));
  assert.equal(collecting.rows.at(-1)?.pending, true);
  assert.match(collecting.rows.at(-1)?.label || "", /Agent attach 准备完成/);
  clock = 220;
  performance.recordTerminalEvent(session, "history_replay_start");
  clock = 420;
  performance.recordTerminalEvent(session, "presentation_commit_complete");

  const result = performance.snapshot();
  assert.equal(result.status, "complete");
  assert.equal(result.sessionID, "pane-1");
  assert.equal(result.totalMs, 320);
  assert.ok(result.rows.some((row) => row.label === "Ghostty WASM 已就绪"));
  assert.deepEqual(result.rows.find((row) => row.name === "物理通道服务端已就绪"), {
    name: "物理通道服务端已就绪",
    label: "物理通道服务端已就绪",
    source: "终端初始化",
    durationMs: 0,
    elapsedMs: 0,
    details: {
      serverPrepareDurationMs: 42,
      serverAgentEnsureDurationMs: 30,
    },
  });
  assert.ok(result.rows.some((row) => row.label === "终端渲染完成"));
  assert.equal(result.rows.some((row) => row.pending), false);
  assert.deepEqual(result.rows.find((row) => row.name === "connect_session_start")?.details, {
    reason: "test_connect",
    renderReady: false,
  });
  assert.deepEqual(result.rows.find((row) => row.name === "agent_attach_ready")?.details, {
    serverUnixMs: 1700000000200,
    agentAttachPrepareDurationMs: 80,
    agentHistorySnapshotDurationMs: 50,
  });
  const rowCount = result.rows.length;

  clock = 900;
  assert.equal(performance.refresh(), false);
  performance.recordTerminalEvent({ id: "pane-1" }, "socket_open");
  assert.equal(performance.snapshot().rows.length, rowCount);
  assert.equal(performance.snapshot().totalMs, 320);
  assert.ok(changes.length > 0);
});

test("initialization performance ignores other panes and can be hidden without resetting the frozen result", () => {
  let clock = 50;
  const startup = createStartupDiagnostics({ now: () => clock });
  const performance = createInitializationPerformance({ startupDiagnostics: startup, now: () => clock });
  performance.setEnabled(true);
  performance.recordTerminalEvent({ id: "pane-1" }, "connect_session_start");
  performance.recordStartupEvent("终端 WebSocket 已打开");
  clock = 100;
  performance.recordTerminalEvent({ id: "pane-2" }, "presentation_commit_complete");
  assert.equal(performance.snapshot().status, "complete");
  assert.equal(performance.snapshot().sessionID, "pane-2");
  assert.equal(performance.snapshot().rows.find((row) => row.name === "终端 WebSocket 已打开")?.source, "终端初始化");
  const totalMs = performance.snapshot().totalMs;
  performance.recordTerminalEvent({ id: "pane-1" }, "presentation_commit_complete");
  assert.equal(performance.snapshot().totalMs, totalMs);
  performance.setEnabled(false);
  assert.equal(performance.snapshot().enabled, false);
  assert.equal(performance.snapshot().status, "complete");
});
