import { createTerminalCacheV2 } from "./terminal_cache_v2.js";
import { createTerminalHistoryCache } from "./terminal_history_cache.js";
import {
  normalizeTerminalCacheWorkspaceIdentity,
  storedTerminalCacheSessionIdentity,
  terminalCacheWorkspaceIdentityKey,
} from "./cache_identity.js";
import { createTerminalCacheLifecycle } from "./cache_lifecycle.js";
import { createTerminalCacheAsync } from "./cache_async.js";
import { createTerminalCachePersistenceController } from "./cache_persistence_controller.js";
import { createTerminalCachePreviewView } from "./cache_preview_view.js";
import { createTerminalCacheRecoveryController } from "./cache_recovery_controller.js";
import { createTerminalCacheReplayController } from "./cache_replay_controller.js";

const noop = () => {};

export function createTerminalCacheController({
  windowObject = globalThis.window,
  consoleObject = globalThis.console,
  cacheV2 = createTerminalCacheV2(),
  legacyCache = createTerminalHistoryCache(),
  isClientTarget = () => false,
  getActiveName = () => "",
  getTabs = () => [],
  isDisposed = () => false,
  getLatestWorkspaceRecoveryMetrics = () => null,
  getStartupMetrics = () => ({}),
  appendDebugLog = noop,
  appendDebugWarning = noop,
  appendStartupTrace = noop,
  scheduleOverviewRender = noop,
  now = () => globalThis.performance?.now?.() || Date.now(),
  lifecycle = createTerminalCacheLifecycle({ windowObject }),
  session: sessionOptions = {},
} = {}) {
  let workspaceIdentity = null;
  let workspaceEpoch = 0;
  let disposed = false;

  const identityFromState = (state, expectedSelector = getActiveName()) => (
    normalizeTerminalCacheWorkspaceIdentity(state, expectedSelector, isClientTarget)
  );

  const identityKey = (identity) => terminalCacheWorkspaceIdentityKey(identity);

  const setWorkspaceIdentity = (identity) => {
    const next = identity ? { ...identity } : null;
    if (identityKey(next) === identityKey(workspaceIdentity)) {
      return false;
    }
    lifecycle.cancel();
    workspaceIdentity = next;
    workspaceEpoch += 1;
    return true;
  };

  const getWorkspaceIdentity = () => workspaceIdentity ? { ...workspaceIdentity } : null;
  const getWorkspaceEpoch = () => workspaceEpoch;

  const storedSessionIdentity = (session, historyGeneration = session?.historyGeneration || "") => (
    storedTerminalCacheSessionIdentity(session, historyGeneration, isClientTarget)
  );

  const hasProtocol = (session) => Boolean(
    session
    && !session.closed
    && !isClientTarget(session.name)
    && session.cacheV2WorkspaceIdentity
    && session.cacheV2Epoch === workspaceEpoch
    && identityKey(session.cacheV2WorkspaceIdentity) === identityKey(workspaceIdentity)
  );

  const usesV2 = (session) => Boolean(cacheV2.available && hasProtocol(session));
  const usesLegacy = (session) => Boolean(session && isClientTarget(session.name));

  const protocolIdentity = (session, historyGeneration = session?.historyGeneration || "") => (
    hasProtocol(session) ? storedSessionIdentity(session, historyGeneration) : null
  );

  const identity = (session, historyGeneration = session?.historyGeneration || "") => (
    usesV2(session) ? storedSessionIdentity(session, historyGeneration) : null
  );

  const scheduleOrphanPreviewCleanup = () => {
    if (
      disposed
      || isDisposed()
      || !cacheV2.available
      || !workspaceIdentity
      || isClientTarget(getActiveName())
    ) {
      return false;
    }
    const scheduledEpoch = workspaceEpoch;
    return lifecycle.schedule(() => {
      if (
        disposed
        || isDisposed()
        || !workspaceIdentity
        || scheduledEpoch !== workspaceEpoch
      ) {
        return;
      }
      const paneIdentities = [];
      for (const tab of getTabs() || []) {
        for (const pane of tab?.panes?.values?.() || []) {
          if (pane.closed || pane.name !== getActiveName()) {
            continue;
          }
          paneIdentities.push({ tabID: tab.id, paneID: pane.id });
        }
      }
      const cleanupIdentity = getWorkspaceIdentity();
      cacheV2.cleanupOrphanedPreviews({
        workspaceIdentity: cleanupIdentity,
        paneIdentities,
      }).then((result) => {
        if (disposed || scheduledEpoch !== workspaceEpoch) {
          return;
        }
        if (Number(result?.removedPreviews || 0) > 0) {
          appendDebugLog("info", "终端总览预览已清理", `移除 ${result.removedPreviews} 个已不存在会话的预览`);
          scheduleOverviewRender();
        }
      }).catch((error) => {
        if (!disposed && scheduledEpoch === workspaceEpoch) {
          appendDebugWarning("终端总览预览清理失败", error?.message || String(error));
        }
      });
    }, { timeout: 2000 });
  };

  const startRecoveryMetrics = (session) => {
    if (!hasProtocol(session)) {
      if (session) {
        session.cacheV2RecoveryMetrics = null;
      }
      return null;
    }
    const currentNow = now();
    const workspaceMetrics = getLatestWorkspaceRecoveryMetrics();
    const hasRecentWorkspaceMetrics = Boolean(
      workspaceMetrics
      && workspaceMetrics.selector === session.name
      && workspaceMetrics.readyAt > 0
      && currentNow - workspaceMetrics.readyAt <= 5000
    );
    session.cacheV2RecoveryMetrics = {
      startedAt: hasRecentWorkspaceMetrics ? workspaceMetrics.startedAt : currentNow,
      workspaceRequestStartedAt: hasRecentWorkspaceMetrics ? workspaceMetrics.startedAt : 0,
      workspaceReadyAt: hasRecentWorkspaceMetrics ? workspaceMetrics.readyAt : 0,
      cacheManifestReadyAt: 0,
      websocketOpenAt: 0,
      replayStartAt: 0,
      previewVisibleAt: 0,
      previewPreparedAt: 0,
      localFirstFrameAt: 0,
      localReplayCompleteAt: 0,
      historyReplayCompleteAt: 0,
      cacheCommitCompleteAt: 0,
      realCanvasVisibleAt: 0,
      inputReadyAt: 0,
      historySource: "snapshot",
      syncMode: "",
      previewHit: false,
      previewLayoutMatch: null,
      previewMissReason: "",
      localReplayBytes: 0,
      serverReplayBytes: 0,
      reported: false,
    };
    return session.cacheV2RecoveryMetrics;
  };

  const markRecoveryMetric = (session, key) => {
    const metrics = session?.cacheV2RecoveryMetrics;
    if (metrics && Object.prototype.hasOwnProperty.call(metrics, key) && !metrics[key]) {
      metrics[key] = now();
      return true;
    }
    return false;
  };

  const reportRecoveryMetrics = (session) => {
    const metrics = session?.cacheV2RecoveryMetrics;
    if (!metrics || metrics.reported || !metrics.realCanvasVisibleAt || !session?.replayComplete) {
      return false;
    }
    metrics.reported = true;
    const elapsed = (timestamp) => timestamp > 0 ? Math.round(timestamp - metrics.startedAt) : null;
    const pageStartupMetrics = getStartupMetrics() || {};
    const startupElapsed = (timestamp) => timestamp > 0
      ? Math.round(timestamp - Number(pageStartupMetrics.navigationStartedAt || 0))
      : null;
    appendStartupTrace(
      "终端恢复阶段完成",
      `pane=${session.id} replay=${metrics.historyReplayCompleteAt > 0 ? Math.round(metrics.historyReplayCompleteAt - metrics.startedAt) : "?"}ms canvas=${metrics.realCanvasVisibleAt > 0 ? Math.round(metrics.realCanvasVisibleAt - metrics.startedAt) : "?"}ms preview=${metrics.previewPreparedAt > 0 ? Math.round(metrics.previewPreparedAt - metrics.startedAt) : "未准备"}`,
      { dedupeKey: `recovery-complete:${session.id}:${session.terminalReplayGeneration}` },
    );
    consoleObject?.info?.("[terminal-cache-v2] recovery metrics", {
      historySource: metrics.historySource,
      syncMode: metrics.syncMode,
      previewHit: metrics.previewHit,
      previewLayoutMatch: metrics.previewLayoutMatch,
      previewMissReason: metrics.previewMissReason || "",
      workspaceRequestStartMs: elapsed(metrics.workspaceRequestStartedAt),
      workspaceReadyMs: elapsed(metrics.workspaceReadyAt),
      cacheManifestReadyMs: elapsed(metrics.cacheManifestReadyAt),
      websocketOpenMs: elapsed(metrics.websocketOpenAt),
      replayStartMs: elapsed(metrics.replayStartAt),
      previewPreparedMs: elapsed(metrics.previewPreparedAt),
      previewVisibleMs: elapsed(metrics.previewVisibleAt),
      localFirstFrameMs: elapsed(metrics.localFirstFrameAt),
      localReplayCompleteMs: elapsed(metrics.localReplayCompleteAt),
      historyReplayCompleteMs: elapsed(metrics.historyReplayCompleteAt),
      cacheCommitCompleteMs: elapsed(metrics.cacheCommitCompleteAt),
      realCanvasVisibleMs: elapsed(metrics.realCanvasVisibleAt),
      inputReadyMs: elapsed(metrics.inputReadyAt),
      pageModuleStartedMs: startupElapsed(pageStartupMetrics.moduleStartedAt),
      pageGhosttyReadyMs: startupElapsed(pageStartupMetrics.ghosttyReadyAt),
      pageThemeReadyMs: startupElapsed(pageStartupMetrics.themeReadyAt),
      pageSettingsReadyMs: startupElapsed(pageStartupMetrics.settingsReadyAt),
      pageInstancesReadyMs: startupElapsed(pageStartupMetrics.instancesReadyAt),
      pageWorkspaceRequestStartMs: startupElapsed(pageStartupMetrics.workspaceRequestStartedAt),
      pageWorkspaceReadyMs: startupElapsed(pageStartupMetrics.workspaceReadyAt),
      pageWorkspaceAppliedMs: startupElapsed(pageStartupMetrics.workspaceAppliedAt),
      pageRealCanvasVisibleMs: startupElapsed(metrics.realCanvasVisibleAt),
      localReplayBytes: metrics.localReplayBytes,
      serverReplayBytes: metrics.serverReplayBytes,
    });
    return true;
  };

  const cacheAsync = createTerminalCacheAsync({ windowObject });
  const previewView = createTerminalCachePreviewView({
    URLObject: sessionOptions.URLObject,
    ImageCtor: sessionOptions.ImageCtor,
    HTMLCanvasElementCtor: sessionOptions.HTMLCanvasElementCtor,
  });
  const persistence = createTerminalCachePersistenceController({
    ...sessionOptions,
    windowObject,
    consoleObject,
    cacheV2,
    legacyCache,
    usesV2,
    usesLegacy,
    identity,
    storedSessionIdentity,
    withTimeout: cacheAsync.withTimeout,
    previewView,
    appendDebugLog,
    scheduleOverviewRender,
    now,
  });
  const recovery = createTerminalCacheRecoveryController({
    consoleObject,
    cacheV2,
    usesV2,
    hasProtocol,
    identity,
    protocolIdentity,
    withTimeout: cacheAsync.withTimeout,
    previewView,
    markRecoveryMetric,
    getPreviewFingerprint: sessionOptions.getPreviewFingerprint,
    getActiveName,
    getTerminalSize: sessionOptions.getTerminalSize,
    isReplayCommitted: sessionOptions.isReplayCommitted,
    hasIdentifiedAuthorization: sessionOptions.hasIdentifiedAuthorization,
    appendStartupTrace,
    previewTimeoutMs: sessionOptions.previewTimeoutMs,
    getDevicePixelRatio: () => windowObject?.devicePixelRatio || 1,
  });
  const replay = createTerminalCacheReplayController({
    consoleObject,
    cacheV2,
    usesV2,
    withProgressTimeout: cacheAsync.withProgressTimeout,
    markRecoveryMetric,
    disableSession: persistence.disableSession,
    resetSession: persistence.resetSession,
    writeOutput: sessionOptions.writeOutput,
    flushOutput: sessionOptions.flushOutput,
    beginPresentationHold: sessionOptions.beginPresentationHold,
    holdPresentationFrame: sessionOptions.holdPresentationFrame,
    markPresentationSyncPending: sessionOptions.markPresentationSyncPending,
    resetTerminalForHistoryReplay: sessionOptions.resetTerminalForHistoryReplay,
    noteReplayFailure: sessionOptions.noteReplayFailure,
    closeSocketForReconnect: sessionOptions.closeSocketForReconnect,
    scheduleReconnect: sessionOptions.scheduleReconnect,
    startAttachReadyTimer: sessionOptions.startAttachReadyTimer,
    isReplayCommitted: sessionOptions.isReplayCommitted,
    setReplayAuthorization: sessionOptions.setReplayAuthorization,
    isSocketOpen: sessionOptions.isSocketOpen,
    replayTimeoutMs: sessionOptions.replayTimeoutMs,
  });
  const cleanupStorage = () => Promise.allSettled([
    Promise.resolve().then(() => legacyCache?.cleanupExpired?.()),
    Promise.resolve().then(() => cacheV2?.cleanup?.()),
  ]);

  const dispose = () => {
    if (disposed) {
      return false;
    }
    disposed = true;
    persistence.dispose();
    lifecycle.dispose();
    workspaceIdentity = null;
    workspaceEpoch += 1;
    return true;
  };

  return Object.freeze({
    applyServerSnapshot: replay.applyServerSnapshot,
    beginReplay: replay.beginReplay,
    cacheV2,
    canCapturePreview: persistence.canCapturePreview,
    cleanupStorage,
    clearPreparedPreview: persistence.clearPreparedPreview,
    clearSessionSchedule: persistence.clearSessionSchedule,
    deleteSession: persistence.deleteSession,
    decodePreview: previewView.decode,
    destroySession: persistence.destroySession,
    disableSession: persistence.disableSession,
    legacyCache,
    dispose,
    disposeSession: persistence.disposeSession,
    flushAll: persistence.flushAll,
    flushSession: persistence.flushSession,
    handleHistoryWindowChange: persistence.handleHistoryWindowChange,
    getWorkspaceEpoch,
    getWorkspaceIdentity,
    hasProtocol,
    identity,
    identityFromState,
    identityKey,
    markRecoveryMetric,
    hidePreview: persistence.hidePreview,
    prepareSession: persistence.prepareSession,
    preparePreview: recovery.preparePreview,
    previewMatchesSnapshot: recovery.previewMatchesSnapshot,
    previewFingerprint: () => sessionOptions.getPreviewFingerprint?.() || "",
    protocolIdentity,
    queueWrite: persistence.queueWrite,
    replayIdentityFromMessage: recovery.replayIdentityFromMessage,
    reportRecoveryMetrics,
    revealPreview: recovery.revealPreview,
    resetSession: persistence.resetSession,
    scheduleCompaction: persistence.scheduleCompaction,
    scheduleOrphanPreviewCleanup,
    schedulePreviewCapture: persistence.schedulePreviewCapture,
    setWorkspaceIdentity,
    setPreviewMiss: recovery.setPreviewMiss,
    showLocalPreview: recovery.showLocalPreview,
    showPreview: recovery.showPreview,
    startWarmReplay: replay.startWarmReplay,
    startRecoveryMetrics,
    storedSessionIdentity,
    touchAll: persistence.touchAll,
    usesLegacy,
    usesV2,
    validateMessageIdentity: recovery.validateMessageIdentity,
    validatePreviewIdentity: recovery.validatePreviewIdentity,
    validateReplayIdentity: recovery.validateReplayIdentity,
    warmReplayMatchesSnapshot: replay.warmReplayMatchesSnapshot,
    withProgressTimeout: cacheAsync.withProgressTimeout,
    withTimeout: cacheAsync.withTimeout,
  });
}
