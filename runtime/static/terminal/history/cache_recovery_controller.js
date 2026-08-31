const noop = () => {};

export function createTerminalCacheRecoveryController({
  consoleObject = globalThis.console,
  cacheV2,
  usesV2,
  hasProtocol,
  identity,
  protocolIdentity,
  withTimeout,
  previewView,
  markRecoveryMetric = noop,
  getPreviewFingerprint = () => "",
  getActiveName = () => "",
  getTerminalSize = () => ({ cols: 0, rows: 0 }),
  isReplayCommitted = () => false,
  hasIdentifiedAuthorization = () => false,
  appendStartupTrace = noop,
  previewTimeoutMs = 3000,
  getDevicePixelRatio = () => globalThis.window?.devicePixelRatio || 1,
} = {}) {
  const replayIdentityFromMessage = (message) => ({
    cacheProtocolVersion: Number(message?.cache_protocol_version || 0),
    cacheScopeID: String(message?.cache_scope_id || "").trim(),
    selector: String(message?.selector || "").trim(),
    workspaceGeneration: String(message?.workspace_generation || "").trim(),
    tabID: String(message?.tab_id || "").trim(),
    paneID: String(message?.pane_id || "").trim(),
    historyGeneration: String(message?.history_generation || "").trim(),
  });

  const validateMessageIdentity = (session, message, historyGeneration) => {
    if (!hasProtocol(session)) {
      return true;
    }
    const expected = protocolIdentity(session, historyGeneration);
    const actual = replayIdentityFromMessage(message);
    return Boolean(expected && cacheV2.identityMatches(expected, actual, { requireHistory: true }));
  };

  const validateReplayIdentity = (session, message, snapshot, deltaFromCursor) => {
    if (!usesV2(session) || !snapshot || !snapshot.historyGeneration) {
      return false;
    }
    const expected = identity(session, snapshot.historyGeneration);
    const actual = replayIdentityFromMessage(message);
    if (!expected || !cacheV2.identityMatches(expected, actual, { requireHistory: true })) {
      return false;
    }
    return snapshot.endCursor === deltaFromCursor;
  };

  const validatePreviewIdentity = (
    session,
    message,
    snapshot,
    syncMode,
    deltaFromCursor,
    serverEndCursor,
  ) => {
    if (
      !usesV2(session)
      || !snapshot?.preview
      || !snapshot.historyGeneration
      || serverEndCursor === null
    ) {
      return false;
    }
    const expected = identity(session, snapshot.historyGeneration);
    const actual = replayIdentityFromMessage(message);
    if (!expected || !cacheV2.identityMatches(expected, actual, { requireHistory: true })) {
      return false;
    }
    if (syncMode === "snapshot") {
      return snapshot.endCursor <= serverEndCursor;
    }
    return (syncMode === "delta" || syncMode === "current") && snapshot.endCursor === deltaFromCursor;
  };

  const setPreviewMiss = (session, reason) => {
    const metrics = session?.cacheV2RecoveryMetrics;
    if (metrics && !metrics.previewMissReason) {
      metrics.previewMissReason = String(reason || "unknown");
      return true;
    }
    return false;
  };

  const previewMatchesSnapshot = (prepared, snapshot) => {
    if (
      !prepared
      || !snapshot
      || prepared.historyGeneration !== snapshot.historyGeneration
      || prepared.endCursor !== snapshot.endCursor
    ) {
      return false;
    }
    try {
      return cacheV2.identityMatches(prepared.identity, snapshot, { requireHistory: true });
    } catch (error) {
      return false;
    }
  };

  const preparePreview = (session, snapshot) => {
    previewView.clearPrepared(session);
    if (!usesV2(session) || !snapshot?.preview) {
      setPreviewMiss(session, snapshot ? "manifest-preview-missing" : "manifest-missing");
      return Promise.resolve(null);
    }
    const prepareSeq = session.cacheV2PreviewPrepareSeq;
    let pendingObjectURL = "";
    let preparePromise = null;
    preparePromise = withTimeout((async () => {
      const preview = await cacheV2.loadPreview(snapshot);
      if (!preview) {
        setPreviewMiss(session, "preview-record-missing");
        return null;
      }
      pendingObjectURL = previewView.createObjectURL(preview.blob);
      await previewView.decode(pendingObjectURL);
      if (
        session.closed
        || session.cacheV2PreviewPrepareSeq !== prepareSeq
        || !usesV2(session)
        || (
          session.historyCacheSnapshot !== snapshot
          && session.cacheV2PreviewAuthorizedSnapshot !== snapshot
        )
      ) {
        return null;
      }
      const prepared = {
        objectURL: pendingObjectURL,
        identity: snapshot,
        historyGeneration: snapshot.historyGeneration,
        endCursor: snapshot.endCursor,
        metadata: preview.metadata,
      };
      pendingObjectURL = "";
      session.cacheV2PreparedPreview = prepared;
      markRecoveryMetric(session, "previewPreparedAt");
      appendStartupTrace("终端预览已准备", `pane=${session.id}`, {
        dedupeKey: `preview-prepared:${session.id}:${session.terminalReplayGeneration}`,
      });
      return prepared;
    })(), previewTimeoutMs, "Terminal cache preview prepare timed out.")
      .catch((error) => {
        if (session.cacheV2PreviewPrepareSeq === prepareSeq) {
          session.cacheV2PreviewPrepareSeq += 1;
        }
        setPreviewMiss(session, "preview-prepare-failed");
        consoleObject?.warn?.("[terminal-cache-v2] preview prepare failed", {
          name: session.name,
          pane: session.id,
          error: error?.message || String(error),
        });
        return null;
      })
      .finally(() => {
        if (pendingObjectURL) {
          previewView.revokeObjectURL(pendingObjectURL);
        }
        if (session.cacheV2PreviewPreparePromise === preparePromise) {
          session.cacheV2PreviewPreparePromise = null;
        }
      });
    session.cacheV2PreviewPreparePromise = preparePromise;
    return preparePromise;
  };

  const showPreview = async (session, snapshot, currentSocket, replayGeneration) => {
    const previewElement = session?.terminalPreview;
    if (!previewElement || !snapshot?.preview || session.socket !== currentSocket) {
      setPreviewMiss(session, snapshot?.preview ? "preview-element-missing" : "manifest-preview-missing");
      return false;
    }
    if (session.cacheV2PreviewAuthorizedSnapshot !== snapshot) {
      setPreviewMiss(session, "preview-not-authorized");
      return false;
    }
    let prepared = previewMatchesSnapshot(session.cacheV2PreparedPreview, snapshot)
      ? session.cacheV2PreparedPreview
      : null;
    if (!prepared) {
      prepared = await (session.cacheV2PreviewPreparePromise || preparePreview(session, snapshot));
    }
    if (!previewMatchesSnapshot(prepared, snapshot)) {
      setPreviewMiss(session, "prepared-preview-mismatch");
      return false;
    }
    if (
      session.socket !== currentSocket
      || session.terminalReplayGeneration !== replayGeneration
      || !hasIdentifiedAuthorization(session)
      || isReplayCommitted(session)
      || !usesV2(session)
    ) {
      setPreviewMiss(session, "preview-session-changed");
      return false;
    }
    const { cols, rows } = getTerminalSize(session);
    const metadata = prepared.metadata;
    const canvas = session.term?.canvas || session.term?.renderer?.getCanvas?.();
    const layoutMatches = Boolean(
      metadata.cols === cols
      && metadata.rows === rows
      && metadata.themeFingerprint === getPreviewFingerprint()
      && Math.abs(metadata.devicePixelRatio - getDevicePixelRatio()) <= 0.01
      && previewView.isCanvas(canvas)
      && metadata.width === canvas.width
      && metadata.height === canvas.height
    );
    previewView.hide(session);
    session.cacheV2PreparedPreview = null;
    session.cacheV2PreviewURL = prepared.objectURL;
    previewElement.src = prepared.objectURL;
    previewElement.hidden = false;
    session.shellEl.dataset.previewReady = "true";
    const metrics = session.cacheV2RecoveryMetrics;
    if (metrics) {
      metrics.previewHit = true;
      metrics.previewLayoutMatch = layoutMatches;
      metrics.previewMissReason = "";
      markRecoveryMetric(session, "previewVisibleAt");
    }
    consoleObject?.info?.("[terminal-cache-v2] preview visible", JSON.stringify({ layoutMatches }));
    return true;
  };

  const showLocalPreview = async (session, snapshot) => {
    if (
      !session
      || session.closed
      || session.name !== getActiveName()
      || session.renderReady
      || isReplayCommitted(session)
      || !usesV2(session)
      || !snapshot?.preview
      || session.historyCacheSnapshot !== snapshot
    ) {
      return false;
    }
    let prepared = previewMatchesSnapshot(session.cacheV2PreparedPreview, snapshot)
      ? session.cacheV2PreparedPreview
      : null;
    if (!prepared) {
      prepared = await (session.cacheV2PreviewPreparePromise || preparePreview(session, snapshot));
    }
    if (
      session.closed
      || session.name !== getActiveName()
      || session.renderReady
      || isReplayCommitted(session)
      || !usesV2(session)
      || session.historyCacheSnapshot !== snapshot
      || !previewMatchesSnapshot(prepared, snapshot)
    ) {
      return false;
    }
    previewView.hide(session);
    session.cacheV2PreparedPreview = null;
    session.cacheV2PreviewURL = prepared.objectURL;
    session.cacheV2PreviewAuthorizedSnapshot = snapshot;
    session.terminalPreview.src = prepared.objectURL;
    session.terminalPreview.hidden = false;
    session.shellEl.dataset.previewReady = "true";
    const metrics = session.cacheV2RecoveryMetrics;
    if (metrics && !metrics.previewVisibleAt) {
      metrics.previewHit = true;
      metrics.previewLayoutMatch = true;
      metrics.previewMissReason = "";
      markRecoveryMetric(session, "previewVisibleAt");
    }
    consoleObject?.info?.("[terminal-cache-v2] local preview visible");
    return true;
  };

  const revealPreview = (
    session,
    message,
    snapshot,
    syncMode,
    deltaFromCursor,
    serverEndCursor,
    currentSocket,
  ) => {
    if (!snapshot?.preview) {
      return false;
    }
    const authorized = hasIdentifiedAuthorization(session)
      && validatePreviewIdentity(
        session,
        message,
        snapshot,
        syncMode,
        deltaFromCursor,
        serverEndCursor,
      );
    consoleObject?.info?.("[terminal-cache-v2] preview decision", JSON.stringify({
      syncMode,
      authorized,
      prepared: previewMatchesSnapshot(session.cacheV2PreparedPreview, snapshot),
    }));
    if (!authorized) {
      setPreviewMiss(session, "preview-replay-identity-mismatch");
      return false;
    }
    session.cacheV2PreviewAuthorizedSnapshot = snapshot;
    showPreview(session, snapshot, currentSocket, session.terminalReplayGeneration).catch((error) => {
      consoleObject?.warn?.("[terminal-cache-v2] preview load failed", {
        name: session.name,
        pane: session.id,
        error: error?.message || String(error),
      });
    });
    return true;
  };

  return Object.freeze({
    preparePreview,
    previewMatchesSnapshot,
    replayIdentityFromMessage,
    revealPreview,
    setPreviewMiss,
    showLocalPreview,
    showPreview,
    validateMessageIdentity,
    validatePreviewIdentity,
    validateReplayIdentity,
  });
}
