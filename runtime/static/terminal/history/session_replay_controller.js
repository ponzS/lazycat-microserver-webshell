import { createTerminalSessionReplayLifecycle } from "./session_replay_lifecycle.js";
import {
  parseTerminalHistoryCursor,
  setTerminalReplayAuthorization,
  terminalReplayAuthorization,
  terminalReplayCommitIsPending,
  terminalReplayHasIdentifiedAuthorization,
  terminalReplayIsAuthorized,
  terminalReplayIsCommitted,
  terminalReplayRetryIsPaused,
  terminalSessionHistoryRangeForConnect,
} from "./session_replay_state.js";

const noop = () => {};

export function createTerminalSessionReplayController({
  windowObject = globalThis.window,
  getActiveName = () => "",
  isClientTarget = () => false,
  hasQueuedOutput = () => false,
  flushCache = () => Promise.resolve(),
  usesCacheV2 = () => false,
  withCacheTimeout = (promise) => promise,
  disableCache = noop,
  markRecoveryMetric = noop,
  scheduleCacheCompaction = noop,
  endRenderSuppression = noop,
  clearOutputOverload = noop,
  clearAttachReadyTimer = noop,
  appendDebugLog = noop,
  appendDebugError = noop,
  describeSession = (session) => `${session?.name || "unknown"}/${session?.id || "unknown"}`,
  clearUnifiedRetry = noop,
  isActivePane = () => false,
  hideStartupError = noop,
  notifyDirectReplayReady = noop,
  schedulePreviewCapture = noop,
  setPresentationReady = noop,
  ensurePresentation = noop,
  flushPendingInput = noop,
  syncConnectionDemands = noop,
  beginPresentationHold = noop,
  isMeasurable = () => false,
  canvasMatchesExpectedSize = () => false,
  recordEvent = noop,
  cacheCommitTimeoutMs = 3000,
  replayFailureLimit = 3,
  checkpointDelayMs = 48,
  lifecycle = createTerminalSessionReplayLifecycle({
    windowObject,
    getActiveName,
    isReplayCommitted: terminalReplayIsCommitted,
    isMeasurable,
    canvasMatchesExpectedSize,
    recordEvent,
    checkpointDelayMs,
  }),
} = {}) {
  let disposed = false;

  const finishIfReady = (session) => {
    if (
      disposed
      || !session
      || !terminalReplayCommitIsPending(session)
      || hasQueuedOutput(session)
      || session.cacheV2ReplayActive
      || !terminalReplayIsAuthorized(session)
      || session.closed
      || session.name !== getActiveName()
      || (session.historyProtocolActive && session.appliedHistoryCursor < session.historyReplayTargetCursor)
    ) {
      return false;
    }
    if (
      session.historyProtocolActive
      && !session.historyCacheDisabled
      && session.persistedHistoryCursor < session.historyReplayTargetCursor
    ) {
      if (!session.historyCacheReplayCommitPending) {
        session.historyCacheReplayCommitPending = true;
        const commitSeq = Number(session.historyCacheReplayCommitSeq || 0) + 1;
        session.historyCacheReplayCommitSeq = commitSeq;
        const historyGeneration = session.historyGeneration;
        const replayTargetCursor = session.historyReplayTargetCursor;
        const commit = flushCache(session);
        const waitForCommit = usesCacheV2(session)
          ? withCacheTimeout(commit, cacheCommitTimeoutMs, "Terminal cache commit timed out.")
          : commit;
        Promise.resolve(waitForCommit).catch((error) => disableCache(session, error)).finally(() => {
          if (
            session.historyCacheReplayCommitSeq === commitSeq
            && !session.closed
            && session.historyGeneration === historyGeneration
            && session.historyReplayTargetCursor === replayTargetCursor
          ) {
            markRecoveryMetric(session, "cacheCommitCompleteAt");
            scheduleCacheCompaction(session);
            session.historyCacheReplayCommitPending = false;
          }
        });
      }
    } else {
      markRecoveryMetric(session, "cacheCommitCompleteAt");
    }
    session.replayCompletionPending = false;
    if (session.replayController?.phase === "awaiting_commit") {
      session.replayController.commit();
    }
    if (session.replayController?.phase === "committed") {
      session.replayControllerLegacyActive = false;
      session.queueReplayControllerActive = false;
      session.queueReplayControllerLegacy = false;
    }
    session.replayFailureAttempts = 0;
    session.replayRetryPaused = false;
    session.lastReplayFailureReason = "";
    endRenderSuppression(session, { render: false, reason: "replay" });
    session.replayComplete = true;
    setTerminalReplayAuthorization(session, false);
    session.historyStateReady = true;
    session.historyCacheSnapshot = null;
    session.cacheV2WarmReplaySeq = Number(session.cacheV2WarmReplaySeq || 0) + 1;
    session.cacheV2WarmReplayActive = false;
    session.cacheV2WarmReplayReady = false;
    session.cacheV2WarmReplayPromise = null;
    session.cacheV2WarmReplaySnapshot = null;
    session.cacheV2ServerSnapshotPending = false;
    session.cacheV2ServerSnapshotStartCursor = 0n;
    session.agentPreparing = false;
    clearOutputOverload(session);
    session.allowGeneratedInputDuringReplay = false;
    clearAttachReadyTimer(session);
    if (Number(session.reconnectAttempts || 0) > 0) {
      appendDebugLog("info", "终端连接已恢复", describeSession(session));
    }
    session.reconnectAttempts = 0;
    session.connectionRetrying = false;
    if (session.shellEl?.dataset) {
      session.shellEl.dataset.connection = "open";
    }
    if (session.connectionChannel === "unified") {
      clearUnifiedRetry(session, { resetAttempts: true });
    }
    if (isActivePane(session)) {
      hideStartupError();
    }
    if (session.connectionChannel === "fast") {
      notifyDirectReplayReady(session, Number(session.connectionLeaseID || 0));
    } else if (session.connectionChannel === "unified") {
      schedulePreviewCapture(session, { immediate: true });
    }
    setPresentationReady(session, false);
    ensurePresentation(session, {
      reason: "history_replay_complete",
      forceHistory: true,
    });
    scheduleCacheCompaction(session);
    flushPendingInput(session);
    if (isClientTarget(getActiveName())) {
      syncConnectionDemands({ reason: "replay_ready" });
    }
    return true;
  };

  const noteFailure = (session, reason = "replay_failed") => {
    if (disposed || !session || session.closed || terminalReplayIsCommitted(session)) {
      return false;
    }
    session.replayFailureAttempts = Math.min(
      replayFailureLimit,
      Number(session.replayFailureAttempts || 0) + 1,
    );
    session.lastReplayFailureReason = String(reason || "replay_failed");
    if (session.replayFailureAttempts < replayFailureLimit) {
      return false;
    }
    session.replayRetryPaused = true;
    session.connectionRetrying = false;
    if (session.shellEl?.dataset) {
      session.shellEl.dataset.connection = "error";
    }
    beginPresentationHold(session);
    appendDebugError(
      "终端历史回放已暂停",
      `${describeSession(session)}: ${session.lastReplayFailureReason}，请重新操作后继续。`,
    );
    return true;
  };

  const resumeRetry = (session, reason = "user_recovery") => {
    if (disposed || !session || session.closed || !session.replayRetryPaused) {
      return false;
    }
    session.replayRetryPaused = false;
    session.replayFailureAttempts = 0;
    session.lastReplayFailureReason = "";
    session.resetOnNextReplay = true;
    session.connectionRetrying = true;
    if (session.shellEl?.dataset) {
      session.shellEl.dataset.connection = "reconnecting";
    }
    appendDebugLog("info", "终端历史回放恢复重试", `${describeSession(session)}: ${reason}`);
    return true;
  };

  const discardSession = (session) => {
    if (!session) {
      return false;
    }
    lifecycle.clearCheckpoint(session);
    session.replayCompletionPending = false;
    session.historyCacheReplayCommitSeq = Number(session.historyCacheReplayCommitSeq || 0) + 1;
    session.historyCacheReplayCommitPending = false;
    return true;
  };

  const disposeSession = (session) => {
    discardSession(session);
    return lifecycle.disposeSession(session);
  };

  const dispose = () => {
    if (disposed) {
      return false;
    }
    disposed = true;
    lifecycle.dispose();
    return true;
  };

  return Object.freeze({
    authorization: terminalReplayAuthorization,
    commitIsPending: terminalReplayCommitIsPending,
    discardSession,
    dispose,
    disposeSession,
    finishIfReady,
    hasIdentifiedAuthorization: terminalReplayHasIdentifiedAuthorization,
    isAuthorized: terminalReplayIsAuthorized,
    isCommitted: terminalReplayIsCommitted,
    isRetryPaused: terminalReplayRetryIsPaused,
    noteFailure,
    parseCursor: parseTerminalHistoryCursor,
    rangeForConnect: terminalSessionHistoryRangeForConnect,
    resumeRetry,
    schedulePresentationCheckpoint: lifecycle.scheduleCheckpoint,
    setAuthorization: setTerminalReplayAuthorization,
  });
}
