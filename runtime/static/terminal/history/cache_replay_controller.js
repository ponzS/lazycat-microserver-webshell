const noop = () => {};

export function createTerminalCacheReplayController({
  consoleObject = globalThis.console,
  cacheV2,
  usesV2,
  withProgressTimeout,
  markRecoveryMetric = noop,
  disableSession = noop,
  resetSession = noop,
  writeOutput = noop,
  flushOutput = noop,
  beginPresentationHold = noop,
  holdPresentationFrame = noop,
  markPresentationSyncPending = noop,
  resetTerminalForHistoryReplay = () => false,
  noteReplayFailure = () => false,
  closeSocketForReconnect = noop,
  scheduleReconnect = noop,
  startAttachReadyTimer = noop,
  isReplayCommitted = () => false,
  setReplayAuthorization = noop,
  isSocketOpen = () => false,
  replayTimeoutMs = 2000,
} = {}) {
  const warmReplayMatchesSnapshot = (session, snapshot) => Boolean(
    session
    && snapshot
    && session.cacheV2WarmReplaySnapshot === snapshot
    && session.cacheV2WarmReplayGeneration === session.terminalReplayGeneration
    && (session.cacheV2WarmReplayActive || session.cacheV2WarmReplayReady)
  );

  const drainNetworkQueue = (session) => {
    const queued = session.cacheV2NetworkQueue;
    session.cacheV2NetworkQueue = [];
    session.cacheV2NetworkQueueBytes = 0;
    for (const data of queued) {
      writeOutput(session, data);
    }
    flushOutput(session, { force: true });
  };

  const failWarmReplay = (session, replaySeq, error) => {
    if (!session || session.closed || session.cacheV2WarmReplaySeq !== replaySeq) {
      return false;
    }
    if (session.hasPresentedFrame && !session.terminalFrameHeld) {
      beginPresentationHold(session);
    }
    session.cacheV2WarmReplayActive = false;
    session.cacheV2WarmReplayReady = false;
    session.cacheV2WarmReplaySnapshot = null;
    session.cacheV2ReplayActive = false;
    session.cacheV2ServerSnapshotPending = false;
    session.cacheV2NetworkQueue = [];
    session.cacheV2NetworkQueueBytes = 0;
    session.resetOnNextReplay = true;
    markPresentationSyncPending(session);
    disableSession(session, error);
    if (noteReplayFailure(session, error?.message || "local_cache_replay_failed")) {
      return true;
    }
    const socket = session.socket;
    if (socket) {
      closeSocketForReconnect(session, socket, "Terminal local cache replay failed.");
    } else {
      scheduleReconnect(session, { immediate: true });
    }
    return true;
  };

  const stageWarmReplay = (session, snapshot) => {
    if (
      !usesV2(session)
      || !snapshot?.historyGeneration
      || session.resetOnNextReplay
      || session.closed
    ) {
      return false;
    }
    if (
      session.cacheV2WarmReplayReady
      && session.cacheV2WarmReplaySnapshot === snapshot
      && session.appliedHistoryCursor === snapshot.endCursor
    ) {
      session.cacheV2WarmReplayGeneration = session.terminalReplayGeneration;
      session.replayFitGeneration = session.measuredFitGeneration;
      return true;
    }
    if (warmReplayMatchesSnapshot(session, snapshot)) {
      return true;
    }
    if (!resetTerminalForHistoryReplay(session)) {
      return false;
    }
    const replayGeneration = session.terminalReplayGeneration;
    const replaySeq = Number(session.cacheV2WarmReplaySeq || 0) + 1;
    session.cacheV2WarmReplaySeq = replaySeq;
    session.cacheV2WarmReplayGeneration = replayGeneration;
    session.cacheV2WarmReplayActive = true;
    session.cacheV2WarmReplayReady = false;
    session.cacheV2WarmReplaySnapshot = snapshot;
    session.cacheV2ServerSnapshotPending = false;
    session.cacheV2ReplayActive = true;
    session.cacheV2NetworkQueue = [];
    session.cacheV2NetworkQueueBytes = 0;
    session.historyGeneration = snapshot.historyGeneration;
    session.historyProtocolActive = true;
    session.historySyncMode = "cache-warm";
    session.historyStateReady = false;
    session.localBaseCursor = snapshot.baseCursor;
    session.receivedHistoryCursor = snapshot.baseCursor;
    session.appliedHistoryCursor = snapshot.baseCursor;
    session.persistedHistoryCursor = snapshot.endCursor;
    session.replayFitGeneration = session.measuredFitGeneration;
    return true;
  };

  const runWarmReplay = (session, snapshot) => {
    if (!stageWarmReplay(session, snapshot)) {
      return false;
    }
    if (session.cacheV2WarmReplayReady || session.cacheV2WarmReplayPromise) {
      return true;
    }
    const replayGeneration = session.cacheV2WarmReplayGeneration;
    const replaySeq = session.cacheV2WarmReplaySeq;
    let replayPromise = null;
    replayPromise = withProgressTimeout((reportProgress) => cacheV2.readChunks(snapshot, ({
      data,
      startCursor,
      endCursor,
    }) => {
      reportProgress();
      if (
        session.closed
        || session.cacheV2WarmReplaySeq !== replaySeq
        || session.terminalReplayGeneration !== replayGeneration
      ) {
        throw new Error("terminal warm cache replay session changed");
      }
      writeOutput(session, data, {
        historySource: "cache-v2",
        startCursor,
        endCursor,
      });
      flushOutput(session, { force: true });
      if (session.cacheV2RecoveryMetrics) {
        session.cacheV2RecoveryMetrics.localReplayBytes += data.byteLength;
      }
      reportProgress();
    }), replayTimeoutMs, "Terminal warm cache replay made no progress.").then(() => {
      if (
        session.closed
        || session.cacheV2WarmReplaySeq !== replaySeq
        || session.terminalReplayGeneration !== replayGeneration
      ) {
        return;
      }
      flushOutput(session, { force: true });
      if (session.appliedHistoryCursor !== snapshot.endCursor) {
        throw new Error("terminal warm cache replay did not reach its manifest cursor");
      }
      session.cacheV2WarmReplayActive = false;
      session.cacheV2WarmReplayReady = true;
      markRecoveryMetric(session, "localReplayCompleteAt");
      consoleObject?.info?.("[terminal-cache-v2] warm replay ready", JSON.stringify({
        chunks: snapshot.chunks.length,
        bytes: Number(snapshot.endCursor - snapshot.baseCursor),
      }));
      if (!session.cacheV2ServerSnapshotPending) {
        session.cacheV2ReplayActive = false;
        drainNetworkQueue(session);
      }
      if (
        session.connectionChannel === "unified"
        && isSocketOpen(session.socket)
        && !isReplayCommitted(session)
      ) {
        startAttachReadyTimer(session, session.socket);
      }
    }).catch((error) => {
      failWarmReplay(session, replaySeq, error);
    }).finally(() => {
      if (session.cacheV2WarmReplayPromise === replayPromise) {
        session.cacheV2WarmReplayPromise = null;
      }
    });
    session.cacheV2WarmReplayPromise = replayPromise;
    return true;
  };

  const startWarmReplay = (session, snapshot) => {
    if (!stageWarmReplay(session, snapshot)) {
      return false;
    }
    return runWarmReplay(session, snapshot);
  };

  const applyServerSnapshot = (session, currentSocket, rejectHistorySync) => {
    if (!session.cacheV2ServerSnapshotPending || session.socket !== currentSocket) {
      return false;
    }
    const queued = session.cacheV2NetworkQueue;
    const snapshotStartCursor = session.cacheV2ServerSnapshotStartCursor;
    session.cacheV2WarmReplaySeq = Number(session.cacheV2WarmReplaySeq || 0) + 1;
    session.cacheV2WarmReplayActive = false;
    session.cacheV2WarmReplayReady = false;
    session.cacheV2WarmReplaySnapshot = null;
    session.cacheV2ServerSnapshotPending = false;
    session.cacheV2ServerSnapshotStartCursor = 0n;
    session.cacheV2ReplayActive = false;
    session.cacheV2NetworkQueue = [];
    session.cacheV2NetworkQueueBytes = 0;
    if (session.hasPresentedFrame && !session.terminalFrameHeld) {
      holdPresentationFrame(session);
    }
    if (!resetTerminalForHistoryReplay(session)) {
      rejectHistorySync("terminal reset for server snapshot failed");
      return true;
    }
    session.historyProtocolActive = true;
    session.historySyncMode = "snapshot";
    session.localBaseCursor = snapshotStartCursor;
    session.receivedHistoryCursor = snapshotStartCursor;
    session.appliedHistoryCursor = snapshotStartCursor;
    session.persistedHistoryCursor = snapshotStartCursor;
    session.historyStateReady = false;
    setReplayAuthorization(session, "identified");
    session.replayCompletionPending = true;
    resetSession(session, session.historyGeneration, snapshotStartCursor);
    try {
      for (const data of queued) {
        writeOutput(session, data);
      }
      if (session.receivedHistoryCursor !== session.historyReplayTargetCursor) {
        throw new Error("server snapshot did not reach its target cursor");
      }
      session.cacheV2WarmReplayGeneration = session.terminalReplayGeneration;
      session.cacheV2WarmReplayReady = true;
      flushOutput(session, { force: true });
    } catch (error) {
      rejectHistorySync(error?.message || "server snapshot replay failed");
    }
    return true;
  };

  const beginReplay = (session, snapshot, deltaFromCursor, currentSocket, rejectHistorySync) => {
    const replayGeneration = session.terminalReplayGeneration;
    session.cacheV2ReplayActive = true;
    session.cacheV2NetworkQueue = [];
    session.cacheV2NetworkQueueBytes = 0;
    let replayPromise = null;
    replayPromise = withProgressTimeout((reportProgress) => cacheV2.readChunks(snapshot, ({
      data,
      startCursor,
      endCursor,
    }) => {
      reportProgress();
      if (session.socket !== currentSocket || session.terminalReplayGeneration !== replayGeneration) {
        throw new Error("terminal cache replay session changed");
      }
      writeOutput(session, data, {
        historySource: "cache-v2",
        startCursor,
        endCursor,
      });
      flushOutput(session, { force: true });
      if (session.cacheV2RecoveryMetrics) {
        session.cacheV2RecoveryMetrics.localReplayBytes += data.byteLength;
      }
      reportProgress();
    }), replayTimeoutMs, "Terminal cache replay made no progress.").then(() => {
      if (session.socket !== currentSocket || session.terminalReplayGeneration !== replayGeneration) {
        return;
      }
      if (session.receivedHistoryCursor !== deltaFromCursor) {
        throw new Error("cached terminal history did not reach requested cursor");
      }
      markRecoveryMetric(session, "localReplayCompleteAt");
      session.cacheV2ReplayActive = false;
      drainNetworkQueue(session);
    }).catch((error) => {
      if (session.socket !== currentSocket || session.terminalReplayGeneration !== replayGeneration) {
        return;
      }
      session.cacheV2ReplayActive = false;
      session.cacheV2NetworkQueue = [];
      session.cacheV2NetworkQueueBytes = 0;
      rejectHistorySync(error?.message || "terminal cache replay failed");
    }).finally(() => {
      if (session.cacheV2ReplayPromise === replayPromise) {
        session.cacheV2ReplayPromise = null;
      }
    });
    session.cacheV2ReplayPromise = replayPromise;
    return true;
  };

  return Object.freeze({
    applyServerSnapshot,
    beginReplay,
    drainNetworkQueue,
    failWarmReplay,
    runWarmReplay,
    stageWarmReplay,
    startWarmReplay,
    warmReplayMatchesSnapshot,
  });
}
