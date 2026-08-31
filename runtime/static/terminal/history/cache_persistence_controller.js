import { createTerminalCacheSessionLifecycle } from "./cache_session_lifecycle.js";

const noop = () => {};

export function createTerminalCachePersistenceController({
  windowObject = globalThis.window,
  consoleObject = globalThis.console,
  cacheV2,
  legacyCache,
  usesV2,
  usesLegacy,
  identity,
  storedSessionIdentity,
  withTimeout,
  previewView,
  getSessions = () => [],
  getActiveName = () => "",
  getHistoryWindowLines = () => 10000,
  getPreviewFingerprint = () => "",
  getTerminalSize = () => ({ cols: 0, rows: 0 }),
  canvasMatchesExpectedSize = () => false,
  isReplayCommitted = () => false,
  isPresentationCurrent = () => false,
  hasQueuedOutput = () => false,
  clearOverviewPreview = noop,
  scheduleOverviewRender = noop,
  appendDebugLog = noop,
  requestHistoryReplay = noop,
  now = () => globalThis.performance?.now?.() || Date.now(),
  wallNow = () => Date.now(),
  averageHistoryBytesPerLine = 350,
  legacyFlushBytes = 256 * 1024,
  cacheV2FlushBytes = 1024 * 1024,
  legacyFlushDelayMs = 50,
  cacheV2FlushDelayMs = 1000,
  previewDelayMs = 3000,
  previewRefreshMs = 2000,
  touchIntervalMs = 5 * 60 * 1000,
  manifestTimeoutMs = 1500,
  compactionMinChunks = 2,
  compactionTargetBytes = 1024 * 1024,
  lifecycle = createTerminalCacheSessionLifecycle({ windowObject }),
} = {}) {
  let disposed = false;

  const clearSessionSchedule = (session) => lifecycle.clearWriteSchedule(session);
  const clearPreparedPreview = (session) => previewView.clearPrepared(session);
  const hidePreview = (session) => previewView.hide(session);

  const disableSession = (session, error = null) => {
    if (!session) {
      return false;
    }
    clearSessionSchedule(session);
    lifecycle.cancelPreviewCapture(session);
    lifecycle.cancelCompaction(session);
    session.historyCacheDisabled = true;
    session.historyCacheWriteQueue = [];
    session.historyCacheWriteBytes = 0;
    session.historyCacheSnapshot = null;
    session.historyCacheReplayCommitSeq = Number(session.historyCacheReplayCommitSeq || 0) + 1;
    session.historyCacheReplayCommitPending = false;
    session.cacheV2WarmReplaySeq = Number(session.cacheV2WarmReplaySeq || 0) + 1;
    session.cacheV2WarmReplayActive = false;
    session.cacheV2WarmReplayReady = false;
    session.cacheV2WarmReplayPromise = null;
    session.cacheV2WarmReplaySnapshot = null;
    session.cacheV2ServerSnapshotPending = false;
    session.cacheV2ServerSnapshotStartCursor = 0n;
    session.cacheV2ReplayActive = false;
    session.cacheV2NetworkQueue = [];
    session.cacheV2NetworkQueueBytes = 0;
    session.cacheV2PreviewCaptureSeq = Number(session.cacheV2PreviewCaptureSeq || 0) + 1;
    session.cacheV2PreviewCapturePending = false;
    session.cacheV2PreviewCaptureRunning = false;
    hidePreview(session);
    clearPreparedPreview(session);
    clearOverviewPreview(session);
    if (error) {
      consoleObject?.warn?.("[terminal-history] local cache disabled", {
        name: session.name,
        pane: session.id,
        error: error?.message || String(error),
      });
    }
    const cacheIdentity = cacheV2?.available ? storedSessionIdentity(session) : null;
    if (cacheIdentity) {
      cacheV2.deletePane(cacheIdentity).catch(() => {});
    } else if (usesLegacy(session)) {
      legacyCache.deletePane(session.name, session.id).catch(() => {});
    }
    return true;
  };

  const prepareSession = async (session) => {
    if (!session || session.historyCacheLoaded) {
      if (session) {
        session.historyCacheLoaded = true;
      }
      return session?.historyCacheSnapshot || null;
    }
    if (session.historyCacheLoadPromise) {
      return session.historyCacheLoadPromise;
    }
    const cacheIdentity = identity(session);
    const legacy = usesLegacy(session);
    if (!cacheIdentity && !legacy) {
      session.historyCacheDisabled = true;
      session.historyCacheLoaded = true;
      session.historyCacheSnapshot = null;
      return null;
    }
    const loadSeq = Number(session.historyCacheLoadSeq || 0) + 1;
    session.historyCacheLoadSeq = loadSeq;
    const load = cacheIdentity
      ? withTimeout(
        cacheV2.loadManifest(cacheIdentity),
        manifestTimeoutMs,
        "Terminal cache manifest read timed out.",
      )
      : legacyCache.load(session.name, session.id);
    session.historyCacheLoadPromise = load
      .then((snapshot) => {
        if (
          session.closed
          || session.historyCacheLoadSeq !== loadSeq
          || (cacheIdentity && !usesV2(session))
          || (!cacheIdentity && !usesLegacy(session))
        ) {
          return null;
        }
        if (snapshot && !cacheV2.historyWindowMatches(snapshot, getHistoryWindowLines())) {
          session.historyCacheSnapshot = null;
          session.historyCacheLoaded = true;
          session.historyCacheWindowMismatch = true;
          return null;
        }
        session.historyCacheSnapshot = snapshot;
        if (snapshot) {
          session.historyGeneration = snapshot.historyGeneration || snapshot.generation;
          session.localBaseCursor = snapshot.baseCursor;
          session.persistedHistoryCursor = snapshot.endCursor;
        }
        return snapshot;
      })
      .catch((error) => {
        if (session.historyCacheLoadSeq === loadSeq) {
          disableSession(session, error);
        }
        return null;
      })
      .finally(() => {
        if (session.historyCacheLoadSeq !== loadSeq) {
          return;
        }
        session.historyCacheLoaded = true;
        session.historyCacheLoadPromise = null;
      });
    return session.historyCacheLoadPromise;
  };

  const schedulePreviewCapture = (session, { immediate = false } = {}) => {
    if (disposed || !usesV2(session) || session.closed) {
      return false;
    }
    session.cacheV2PreviewCapturePending = true;
    session.cacheV2PreviewCaptureAllowRecentOutput = true;
    if (session.cacheV2PreviewCaptureRunning) {
      return false;
    }
    if (session.cacheV2PreviewCaptureTimer || session.cacheV2PreviewCaptureIdle) {
      if (immediate && session.cacheV2PreviewCaptureTimer) {
        lifecycle.cancelPreviewCapture(session);
      } else {
        return false;
      }
    }
    const captureSeq = Number(session.cacheV2PreviewCaptureSeq || 0) + 1;
    session.cacheV2PreviewCaptureSeq = captureSeq;
    return lifecycle.schedulePreviewCapture(session, () => {
      session.cacheV2PreviewCaptureIdle = 0;
      session.cacheV2PreviewCaptureIdleKind = "";
      if (disposed || session.closed || session.cacheV2PreviewCaptureSeq !== captureSeq) {
        return;
      }
      session.cacheV2PreviewCapturePending = false;
      session.cacheV2PreviewCaptureRunning = true;
      capturePreview(session, captureSeq).catch((error) => {
        consoleObject?.warn?.("[terminal-cache-v2] preview capture failed", {
          name: session.name,
          pane: session.id,
          error: error?.message || String(error),
        });
      }).finally(() => {
        session.cacheV2PreviewCaptureRunning = false;
        if (session.cacheV2PreviewCapturePending && !session.closed && !disposed) {
          schedulePreviewCapture(session);
        }
      });
    }, {
      delayMs: immediate ? 0 : previewRefreshMs,
      idle: !immediate,
    });
  };

  const flushSession = (session) => {
    if (!session || session.historyCacheDisabled || session.historyCacheWriteQueue.length === 0) {
      return session?.historyCacheWritePromise || Promise.resolve();
    }
    clearSessionSchedule(session);
    const chunks = session.historyCacheWriteQueue;
    session.historyCacheWriteQueue = [];
    session.historyCacheWriteBytes = 0;
    const generation = session.historyGeneration;
    const cacheIdentity = identity(session, generation);
    const legacy = usesLegacy(session);
    if (!cacheIdentity && !legacy) {
      disableSession(session);
      return session.historyCacheWritePromise;
    }
    const historyWindowLines = getHistoryWindowLines();
    session.historyCacheWritePromise = session.historyCacheWritePromise
      .then(() => session.historyCacheResetPromise)
      .then(() => (cacheIdentity ? cacheV2 : legacyCache).append(
        ...(cacheIdentity
          ? [cacheIdentity, generation, chunks]
          : [session.name, session.id, generation, chunks]), {
          limitBytes: Math.max(1, Number(historyWindowLines || 0) * averageHistoryBytesPerLine),
          historyWindowLines,
        }))
      .then((result) => {
        if (!result || session.closed || session.historyGeneration !== generation) {
          return;
        }
        session.localBaseCursor = result.baseCursor;
        session.persistedHistoryCursor = result.endCursor;
        schedulePreviewCapture(session);
      })
      .catch((error) => disableSession(session, error));
    return session.historyCacheWritePromise;
  };

  const scheduleWrite = (session) => {
    if (
      disposed
      || !session
      || session.historyCacheDisabled
      || session.historyCacheWriteFrame
      || session.historyCacheWriteTimer
    ) {
      return false;
    }
    return lifecycle.scheduleWrite(session, () => flushSession(session), {
      useTimeoutOnly: usesV2(session),
      timeoutMs: usesV2(session) ? cacheV2FlushDelayMs : legacyFlushDelayMs,
    });
  };

  const queueWrite = (session, data, startCursor, endCursor) => {
    if (
      disposed
      || !session
      || session.historyCacheDisabled
      || !session.historyGeneration
      || !(data instanceof Uint8Array)
      || endCursor <= startCursor
    ) {
      return false;
    }
    session.historyCacheWriteQueue.push({ startCursor, endCursor, data });
    session.historyCacheWriteBytes += data.byteLength;
    const flushBytes = usesV2(session) ? cacheV2FlushBytes : legacyFlushBytes;
    if (session.historyCacheWriteBytes >= flushBytes) {
      flushSession(session);
    } else {
      scheduleWrite(session);
    }
    return true;
  };

  const resetSession = (session, generation, cursor, { preservePreview = false } = {}) => {
    if (!session) {
      return false;
    }
    const previewPreparation = preservePreview ? session.cacheV2PreviewPreparePromise : null;
    clearSessionSchedule(session);
    session.historyCacheWriteQueue = [];
    session.historyCacheWriteBytes = 0;
    session.historyCacheSnapshot = null;
    clearOverviewPreview(session);
    if (!preservePreview) {
      clearPreparedPreview(session);
    }
    const previousWrites = session.historyCacheWritePromise;
    const cacheIdentity = identity(session, generation);
    const legacy = usesLegacy(session);
    if (!cacheIdentity && !legacy) {
      session.historyCacheDisabled = true;
      session.historyCacheResetPromise = Promise.resolve();
      return false;
    }
    session.historyCacheDisabled = false;
    session.historyCacheResetPromise = Promise.resolve(previousWrites)
      .catch(() => {})
      .then(() => previewPreparation ? Promise.resolve(previewPreparation).catch(() => null) : null)
      .then(() => cacheIdentity
        ? cacheV2.reset(cacheIdentity, generation, cursor, {
          historyWindowLines: getHistoryWindowLines(),
        })
        : legacyCache.reset(session.name, session.id, generation, cursor))
      .then((result) => {
        if (session.closed || session.historyGeneration !== generation) {
          return;
        }
        session.localBaseCursor = result.baseCursor;
        session.persistedHistoryCursor = result.endCursor;
      })
      .catch((error) => disableSession(session, error));
    return true;
  };

  const deleteSession = (session) => {
    const cacheIdentity = cacheV2?.available ? storedSessionIdentity(session) : null;
    const deletion = cacheIdentity
      ? cacheV2.deletePane(cacheIdentity)
      : usesLegacy(session)
        ? legacyCache.deletePane(session?.name, session?.id)
        : Promise.resolve(false);
    return deletion.catch((error) => {
      consoleObject?.warn?.("[terminal-history] cache delete failed", {
        name: session?.name,
        pane: session?.id,
        error: error?.message || String(error),
      });
      return false;
    });
  };

  const destroySession = async (session) => {
    if (!session) {
      return undefined;
    }
    if (session.historyCacheDestroyPromise) {
      return session.historyCacheDestroyPromise;
    }
    session.historyCacheDestroyPromise = (async () => {
      lifecycle.disposeSession(session);
      session.historyCacheDisabled = true;
      session.historyCacheWriteQueue = [];
      session.historyCacheWriteBytes = 0;
      clearPreparedPreview(session);
      await Promise.allSettled([
        session.historyCacheResetPromise,
        session.historyCacheWritePromise,
      ]);
      await deleteSession(session);
    })();
    return session.historyCacheDestroyPromise;
  };

  const flushAll = () => Promise.allSettled(
    Array.from(getSessions() || [], (session) => flushSession(session)),
  );

  const touchAll = () => {
    for (const session of getSessions() || []) {
      if (session.historyCacheDisabled || !session.historyGeneration) {
        continue;
      }
      const cacheIdentity = identity(session, session.historyGeneration);
      if (cacheIdentity) {
        const currentNow = wallNow();
        if (currentNow - Number(session.cacheV2LastTouchAt || 0) >= touchIntervalMs) {
          session.cacheV2LastTouchAt = currentNow;
          cacheV2.touch(cacheIdentity).catch(() => {});
        }
      } else if (usesLegacy(session)) {
        legacyCache.touch(session.name, session.id).catch(() => {});
      }
    }
  };

  const handleHistoryWindowChange = (previousHistoryWindow, nextHistoryWindow) => {
    if (previousHistoryWindow === nextHistoryWindow) {
      return false;
    }
    for (const session of getSessions() || []) {
      clearSessionSchedule(session);
      session.historyCacheWriteQueue = [];
      session.historyCacheWriteBytes = 0;
      session.historyCacheLoaded = false;
      session.historyCacheLoadPromise = null;
      session.historyCacheLoadSeq = Number(session.historyCacheLoadSeq || 0) + 1;
      session.historyCacheWindowMismatch = true;
      session.historyCacheSnapshot = null;
      session.historyCacheReplayCommitSeq = Number(session.historyCacheReplayCommitSeq || 0) + 1;
      session.historyCacheReplayCommitPending = false;
      session.historyStateReady = false;
      session.localBaseCursor = 0n;
      session.persistedHistoryCursor = 0n;
      session.appliedHistoryCursor = 0n;
      session.historyGeneration = "";
      session.resetOnNextReplay = true;
      if (session.name === getActiveName() && !session.closed) {
        requestHistoryReplay(session);
      }
    }
    return true;
  };

  const sessionHasCurrentPresentedFrame = (session) => {
    if (
      !session
      || session.closed
      || session.hasPresentedFrame !== true
      || session.resizePresentationHold
      || session.resizeAckPending
      || !session.renderSnapshot
      || Number(session.measuredFitGeneration || 0) <= 0
      || session.presentedFitGeneration !== session.measuredFitGeneration
      || session.presentedReplayGeneration !== session.terminalReplayGeneration
      || session.presentedContentGeneration !== session.terminalContentGeneration
      || session.presentedHistoryCursor !== session.appliedHistoryCursor
    ) {
      return false;
    }
    return canvasMatchesExpectedSize(session);
  };

  const canCapturePreview = (session) => {
    if (!sessionHasCurrentPresentedFrame(session)) {
      return false;
    }
    if (isPresentationCurrent(session)) {
      return true;
    }
    if (
      session.connectionChannel !== "unified"
      || !isReplayCommitted(session)
      || session.resizeAckPending
      || session.cacheV2WarmReplayActive
    ) {
      return false;
    }
    const canvas = session.term?.canvas || session.term?.renderer?.getCanvas?.();
    const { cols, rows } = getTerminalSize(session);
    return previewView.isCanvas(canvas)
      && canvas.width > 0
      && canvas.height > 0
      && cols > 0
      && rows > 0;
  };

  async function capturePreview(session, captureSeq) {
    const allowRecentOutput = session.cacheV2PreviewCaptureAllowRecentOutput === true;
    if (
      !usesV2(session)
      || session.cacheV2PreviewCaptureSeq !== captureSeq
      || !isReplayCommitted(session)
      || !canCapturePreview(session)
      || !session.historyStateReady
      || !session.historyGeneration
      || hasQueuedOutput(session)
      || (!allowRecentOutput && now() - Number(session.lastTerminalOutputAt || 0) < previewDelayMs)
    ) {
      return false;
    }
    await flushSession(session);
    const cursor = session.appliedHistoryCursor;
    if (
      !usesV2(session)
      || session.cacheV2PreviewCaptureSeq !== captureSeq
      || !canCapturePreview(session)
      || session.persistedHistoryCursor !== cursor
      || hasQueuedOutput(session)
      || (!allowRecentOutput && now() - Number(session.lastTerminalOutputAt || 0) < previewDelayMs)
    ) {
      return false;
    }
    const cacheIdentity = identity(session, session.historyGeneration);
    const canvas = session.term?.canvas || session.term?.renderer?.getCanvas?.();
    if (!cacheIdentity || !previewView.isCanvas(canvas) || canvas.width <= 0 || canvas.height <= 0) {
      return false;
    }
    const width = canvas.width;
    const height = canvas.height;
    const { cols, rows } = getTerminalSize(session);
    const renderGeneration = Number(session.renderGeneration || 0);
    const contentGeneration = Number(session.presentedContentGeneration || 0);
    const presentedCursor = session.presentedHistoryCursor;
    const devicePixelRatio = windowObject?.devicePixelRatio || 1;
    const themeFingerprint = getPreviewFingerprint();
    const previewCaptureStartedAt = now();
    appendDebugLog("info", "[preview] PNG capture 开始", `pane=${session.id}`, {
      dedupeKey: `preview-capture-start:${session.id}`,
    });
    const blob = await previewView.canvasBlob(canvas);
    const currentSize = getTerminalSize(session);
    if (
      !usesV2(session)
      || session.cacheV2PreviewCaptureSeq !== captureSeq
      || !isReplayCommitted(session)
      || !session.historyStateReady
      || !canCapturePreview(session)
      || hasQueuedOutput(session)
      || (!allowRecentOutput && now() - Number(session.lastTerminalOutputAt || 0) < previewDelayMs)
      || session.appliedHistoryCursor !== cursor
      || session.persistedHistoryCursor !== cursor
      || canvas.width !== width
      || canvas.height !== height
      || currentSize.cols !== cols
      || currentSize.rows !== rows
      || Number(session.renderGeneration || 0) !== renderGeneration
      || Number(session.presentedContentGeneration || 0) !== contentGeneration
      || session.presentedHistoryCursor !== presentedCursor
      || Math.abs((windowObject?.devicePixelRatio || 1) - devicePixelRatio) > 0.01
      || getPreviewFingerprint() !== themeFingerprint
    ) {
      return false;
    }
    await cacheV2.savePreview(cacheIdentity, session.historyGeneration, cursor, blob, {
      width,
      height,
      cols,
      rows,
      devicePixelRatio,
      themeFingerprint,
    });
    appendDebugLog(
      "info",
      "[preview] PNG capture 完成",
      `pane=${session.id} duration=${Math.round(now() - previewCaptureStartedAt)}ms bytes=${blob.size}`,
      { dedupeKey: `preview-capture-complete:${session.id}` },
    );
    clearOverviewPreview(session);
    scheduleOverviewRender();
    return true;
  }

  const scheduleCompaction = (session) => {
    if (
      disposed
      || !usesV2(session)
      || session.closed
      || session.historyCacheDisabled
      || session.cacheV2CompactionScheduled
      || !session.historyGeneration
    ) {
      return false;
    }
    const cacheIdentity = identity(session, session.historyGeneration);
    if (!cacheIdentity) {
      return false;
    }
    session.cacheV2CompactionScheduled = true;
    return lifecycle.scheduleCompaction(session, () => {
      session.cacheV2CompactionHandle = 0;
      session.cacheV2CompactionKind = "";
      session.cacheV2CompactionScheduled = false;
      if (
        disposed
        || session.closed
        || !usesV2(session)
        || session.historyGeneration !== cacheIdentity.historyGeneration
      ) {
        return;
      }
      cacheV2.compact(cacheIdentity, {
        minChunks: compactionMinChunks,
        targetBytes: compactionTargetBytes,
      }).then((manifest) => {
        if (manifest && Number(manifest.compactedFromChunks || 0) > manifest.chunks.length) {
          consoleObject?.info?.("[terminal-cache-v2] cache compacted", {
            name: session.name,
            pane: session.id,
            previousChunks: manifest.compactedFromChunks,
            chunks: manifest.chunks.length,
          });
        }
      }).catch((error) => {
        consoleObject?.warn?.("[terminal-cache-v2] cache compaction failed", {
          name: session.name,
          pane: session.id,
          error: error?.message || String(error),
        });
      });
    });
  };

  const disposeSession = (session) => {
    if (!session) {
      return false;
    }
    lifecycle.disposeSession(session);
    session.cacheV2PreviewCaptureSeq = Number(session.cacheV2PreviewCaptureSeq || 0) + 1;
    session.cacheV2PreviewCaptureAllowRecentOutput = false;
    session.cacheV2PreviewCapturePending = false;
    session.cacheV2PreviewCaptureRunning = false;
    return true;
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
    canCapturePreview,
    clearPreparedPreview,
    clearSessionSchedule,
    deleteSession,
    destroySession,
    disableSession,
    dispose,
    disposeSession,
    flushAll,
    flushSession,
    handleHistoryWindowChange,
    hidePreview,
    prepareSession,
    queueWrite,
    resetSession,
    scheduleCompaction,
    schedulePreviewCapture,
    touchAll,
  });
}
