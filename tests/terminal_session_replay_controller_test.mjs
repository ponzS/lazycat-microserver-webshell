import assert from "node:assert/strict";
import test from "node:test";

import {
  createTerminalSessionReplayController,
  parseTerminalHistoryCursor,
  setTerminalReplayAuthorization,
  terminalReplayHasIdentifiedAuthorization,
  terminalReplayIsAuthorized,
  terminalSessionHistoryRangeForConnect,
} from "../runtime/static/terminal/history/index.js";

const createClock = () => {
  let nextID = 1;
  const timers = new Map();
  return {
    windowObject: {
      setTimeout(callback) {
        const id = nextID++;
        timers.set(id, callback);
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    },
    run() {
      for (const [id, callback] of Array.from(timers)) {
        timers.delete(id);
        callback();
      }
    },
    size: () => timers.size,
  };
};

test("session replay state owns cursor parsing, connect ranges, and authorization", () => {
  assert.equal(parseTerminalHistoryCursor("42"), 42n);
  assert.equal(parseTerminalHistoryCursor("-1"), null);
  assert.equal(parseTerminalHistoryCursor("1.5"), null);

  const session = {
    appliedHistoryCursor: 9n,
    historyGeneration: "history-1",
    historyStateReady: true,
    localBaseCursor: 2n,
    replayAuthorization: false,
    replayVerified: false,
    resetOnNextReplay: false,
  };
  assert.deepEqual(terminalSessionHistoryRangeForConnect(session), {
    generation: "history-1",
    baseCursor: 2n,
    endCursor: 9n,
    source: "memory",
  });
  session.historyStateReady = false;
  session.historyCacheSnapshot = {
    baseCursor: 1n,
    endCursor: 8n,
    historyGeneration: "history-1",
  };
  assert.equal(terminalSessionHistoryRangeForConnect(session).source, "cache");
  session.historyCacheSnapshot.historyGeneration = "history-old";
  assert.equal(terminalSessionHistoryRangeForConnect(session), null);

  assert.equal(setTerminalReplayAuthorization(session, "identified"), "identified");
  assert.equal(terminalReplayIsAuthorized(session), true);
  assert.equal(terminalReplayHasIdentifiedAuthorization(session), true);
  assert.equal(setTerminalReplayAuthorization(session, "invalid"), false);
  assert.equal(terminalReplayIsAuthorized(session), false);
});

test("replay checkpoint lifecycle rejects stale generation and never commits a frame", () => {
  const clock = createClock();
  const events = [];
  const session = {
    appliedHistoryCursor: 12n,
    closed: false,
    connectionEpoch: 4,
    name: "target-1",
    replayController: { phase: "replaying" },
    replayPresentationCheckpointPending: false,
    replayPresentationCheckpointTimer: 0,
    terminalReplayGeneration: 3,
  };
  const controller = createTerminalSessionReplayController({
    windowObject: clock.windowObject,
    getActiveName: () => "target-1",
    isMeasurable: () => true,
    canvasMatchesExpectedSize: () => true,
    recordEvent: (_session, event, details) => events.push({ event, details }),
  });

  assert.equal(controller.schedulePresentationCheckpoint(session), true);
  assert.equal(clock.size(), 1);
  session.terminalReplayGeneration += 1;
  clock.run();
  assert.deepEqual(events, []);

  assert.equal(controller.schedulePresentationCheckpoint(session), true);
  clock.run();
  assert.deepEqual(events, [{
    event: "replay_presentation_checkpoint_skipped",
    details: { cursor: "12", reason: "replay_not_committed" },
  }]);
  assert.equal(controller.dispose(), true);
});

test("replay failure pauses only after the bounded limit and can be resumed", () => {
  const holds = [];
  const errors = [];
  const logs = [];
  const session = {
    closed: false,
    connectionRetrying: true,
    lastReplayFailureReason: "",
    replayController: { phase: "replaying" },
    replayFailureAttempts: 0,
    replayRetryPaused: false,
    resetOnNextReplay: false,
    shellEl: { dataset: {} },
  };
  const controller = createTerminalSessionReplayController({
    replayFailureLimit: 3,
    beginPresentationHold: (currentSession) => holds.push(currentSession),
    appendDebugError: (...args) => errors.push(args),
    appendDebugLog: (...args) => logs.push(args),
  });

  assert.equal(controller.noteFailure(session, "first"), false);
  assert.equal(controller.noteFailure(session, "second"), false);
  assert.equal(controller.noteFailure(session, "third"), true);
  assert.equal(session.replayRetryPaused, true);
  assert.equal(session.shellEl.dataset.connection, "error");
  assert.equal(holds.length, 1);
  assert.equal(errors.length, 1);

  assert.equal(controller.resumeRetry(session, "user"), true);
  assert.equal(session.replayRetryPaused, false);
  assert.equal(session.replayFailureAttempts, 0);
  assert.equal(session.resetOnNextReplay, true);
  assert.equal(session.shellEl.dataset.connection, "reconnecting");
  assert.equal(logs.length, 1);
});

test("replay cannot finish before the received cursor reaches the target", () => {
  const session = {
    appliedHistoryCursor: 8n,
    closed: false,
    historyProtocolActive: true,
    historyReplayTargetCursor: 8n,
    receivedHistoryCursor: 7n,
    name: "target-1",
    replayAuthorization: "identified",
    replayCompletionPending: true,
  };
  const controller = createTerminalSessionReplayController({
    getActiveName: () => "target-1",
    hasQueuedOutput: () => false,
  });

  assert.equal(controller.finishIfReady(session), false);
  assert.equal(session.replayCompletionPending, true);
});

test("replay commit finishes state before requesting the only visible full presentation", () => {
  const events = [];
  const replayController = {
    phase: "awaiting_commit",
    commit() {
      events.push("commit");
      this.phase = "committed";
    },
  };
  const session = {
    agentPreparing: true,
    allowGeneratedInputDuringReplay: true,
    appliedHistoryCursor: 8n,
    closed: false,
    connectionChannel: "unified",
    connectionRetrying: true,
    historyCacheDisabled: false,
    historyCacheReplayCommitPending: false,
    historyCacheSnapshot: {},
    historyGeneration: "history-1",
    historyProtocolActive: true,
    historyReplayTargetCursor: 8n,
    historyStateReady: false,
    id: "pane-1",
    name: "target-1",
    persistedHistoryCursor: 0n,
    reconnectAttempts: 2,
    replayAuthorization: "identified",
    replayCompletionPending: true,
    replayController,
    replayFailureAttempts: 2,
    replayRetryPaused: true,
    shellEl: { dataset: {} },
    tabId: "tab-1",
  };
  const controller = createTerminalSessionReplayController({
    getActiveName: () => "target-1",
    hasQueuedOutput: () => false,
    markRecoveryMetric: (_session, key) => events.push(`metric:${key}`),
    endRenderSuppression: () => events.push("end-suppression"),
    clearOutputOverload: () => events.push("clear-overload"),
    clearAttachReadyTimer: () => events.push("clear-attach-timer"),
    appendDebugLog: () => events.push("connection-restored-log"),
    clearUnifiedRetry: () => events.push("clear-unified-retry"),
    isActivePane: () => true,
    hideStartupError: () => events.push("hide-startup-error"),
    flushCache: () => events.push("flush-client-history"),
    recordEvent: (_session, event, details) => events.push({ event, details }),
    setPresentationReady: (_session, ready) => events.push(`presentation-ready:${ready}`),
    ensurePresentation: () => events.push("ensure-final-presentation"),
    flushPendingInput: () => events.push("flush-input"),
  });

  assert.equal(controller.finishIfReady(session), true);
  assert.equal(session.replayComplete, true);
  assert.equal(session.historyStateReady, true);
  assert.equal(session.replayAuthorization, false);
  assert.equal(session.shellEl.dataset.connection, "open");
  assert.equal(events.filter((entry) => entry.event === "replay_output_drained").length, 1);
  assert.ok(events.indexOf("commit") < events.indexOf("presentation-ready:false"));
  assert.ok(events.indexOf("end-suppression") < events.indexOf("ensure-final-presentation"));
  assert.equal(events.filter((event) => event === "ensure-final-presentation").length, 1);
  assert.equal(events.includes("flush-client-history"), false);
});

test("stale client IndexedDB commit cannot update a replacement replay generation", async () => {
  let resolveCommit;
  const session = {
    appliedHistoryCursor: 5n,
    closed: false,
    connectionChannel: "fast",
    historyCacheDisabled: false,
    historyCacheReplayCommitPending: false,
    historyCacheReplayCommitSeq: 0,
    historyGeneration: "history-1",
    historyProtocolActive: true,
    historyReplayTargetCursor: 5n,
    name: "client:target-1",
    persistedHistoryCursor: 1n,
    replayAuthorization: "identified",
    replayController: {
      phase: "awaiting_commit",
      commit() {
        this.phase = "committed";
      },
    },
    shellEl: { dataset: {} },
  };
  const controller = createTerminalSessionReplayController({
    getActiveName: () => "client:target-1",
    isClientTarget: (name) => String(name).startsWith("client:"),
    flushCache: () => new Promise((resolve) => { resolveCommit = resolve; }),
  });

  assert.equal(controller.finishIfReady(session), true);
  session.historyGeneration = "history-2";
  resolveCommit();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(session.historyCacheReplayCommitPending, true);
});
