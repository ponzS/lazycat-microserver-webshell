import { decodeFastBinaryFrame } from "./terminal_fast_integrity.js";

const noop = () => {};

const isNetworkFailureReason = (reason) => {
  const normalized = String(reason || "").toLowerCase();
  return normalized.includes("network")
    || normalized.includes("websocket")
    || normalized.includes("transport")
    || normalized.includes("physical")
    || normalized.includes("connection timed out")
    || normalized.includes("connection reset")
    || normalized.includes("connection aborted")
    || normalized.includes("queue transport")
    || normalized.includes("eof");
};

export function createTerminalSessionProtocolController({
  documentObject = globalThis.document,
  navigatorObject = globalThis.navigator,
  WebSocketCtor = globalThis.WebSocket,
  getActiveName = () => "",
  getActiveTabId = () => null,
  getCurrentTab = () => null,
  getTerminalTransportRuntime = () => null,
  terminalSessionConnection = null,
  terminalUnifiedTransport = null,
  terminalReplay = null,
  clientHistory = null,
  terminalOutput = null,
  terminalPresentation = null,
  terminalResize = null,
  terminalInput = null,
  TerminalReplayController = null,
  ClientTerminalReplayAdapter = null,
  terminalCheckpointCapabilitiesForTerminal = () => [],
  terminalAgentPrepareTimeoutMs = 45 * 1000,
  serverRevisionClientID = "",
  webSocketURL = () => {
    throw new Error("webSocketURL is required");
  },
  terminalThemePayload = () => ({}),
  sendTerminalTheme = noop,
  syncTerminalNetworkMonitorSockets = noop,
  isClientInstanceName = () => false,
  isCurrentInstanceSession = () => true,
  terminalLocationDescription = () => "",
  isRetryableTerminalTransportError = () => false,
  isDeployRestartDialogOpen = () => false,
  detachSessionSocket = noop,
  invalidateSessionStartupError = noop,
  showSessionStartupError = noop,
  resetTerminalForHistoryReplay = () => false,
  beginTerminalRenderSuppression = noop,
  endTerminalRenderSuppression = noop,
  sessionConnectingState = () => "connecting",
  refreshWorkspaceWithRetry = async () => {},
  showToast = noop,
  appendStartupTrace = noop,
  appendDebugLog = noop,
  appendDebugWarning = noop,
  appendDebugError = noop,
  recordTerminalSessionEvent = noop,
} = {}) {
  const document = documentObject;
  const navigator = navigatorObject;
  const WebSocket = WebSocketCtor;
  const currentTab = (...args) => getCurrentTab(...args);
  const connectSession = async (session, {
    allowHidden = false,
    leaseID = 0,
    channel = "unified",
    channelGeneration = 0,
  } = {}) => {
    const terminalTransportRuntime = getTerminalTransportRuntime();
    let connectionEpoch = Number(session?.connectionEpoch || 0);
    const usesMultiplexedTransport = channel === "unified";
    const transportIsCurrent = () => Boolean(
      usesMultiplexedTransport
        ? channelGeneration > 0
          && session?.connectionEpoch === connectionEpoch
          && session?.connectionChannel === "unified"
          && session.connectionChannelGeneration === channelGeneration
          && terminalUnifiedTransport.matchesTarget(session.name)
        : leaseID
          && session?.connectionEpoch === connectionEpoch
          && session?.connectionChannel === "fast"
          && terminalTransportRuntime?.currentLease(session)?.leaseID === leaseID
          && session.connectionLeaseID === leaseID
          && !session.connectionLeaseClosing
    );
    if (
      !session ||
      session.closed ||
      terminalReplay.isRetryPaused(session) ||
      !transportIsCurrent() ||
      !isCurrentInstanceSession(session) ||
      !terminalTransportRuntime?.hasKnownSize(session) ||
      (document.hidden && !allowHidden) ||
      navigator.onLine === false ||
      session.socket?.readyState === WebSocket.OPEN ||
      session.socket?.readyState === WebSocket.CONNECTING
    ) {
      if (navigator.onLine === false && session?.shellEl) {
        session.shellEl.dataset.connection = "offline";
      }
      return false;
    }
    session.startupTraceActive = true;
    if (isClientInstanceName(session.name)) {
      await clientHistory.prepareSession(session);
      terminalOutput.flush(session, { force: true });
      await clientHistory.flushSession(session);
    }
    if (
      !session ||
      session.closed ||
      !transportIsCurrent() ||
      !isCurrentInstanceSession(session) ||
      !terminalTransportRuntime?.hasKnownSize(session) ||
      (document.hidden && !allowHidden) ||
      navigator.onLine === false ||
      session.socket?.readyState === WebSocket.OPEN ||
      session.socket?.readyState === WebSocket.CONNECTING
    ) {
      return false;
    }
    session.pendingConnect = false;
    connectionEpoch += 1;
    session.connectionEpoch = connectionEpoch;
    terminalSessionConnection.clearReconnectTimer(session);
    session.terminalReplayGeneration = Number(session.terminalReplayGeneration || 0) + 1;
    session.replayFitGeneration = session.measuredFitGeneration;
    const socketUrl = webSocketURL("./ws");
    socketUrl.searchParams.set("name", String(session.name || "").trim());
    socketUrl.searchParams.set("client_id", serverRevisionClientID);
    if (usesMultiplexedTransport) {
      socketUrl.searchParams.set("mode", "unified");
      socketUrl.searchParams.set("transport_role", "unified");
      socketUrl.searchParams.set("protocol_version", "1");
    } else {
      socketUrl.searchParams.set("pane", session.id);
      socketUrl.searchParams.set("cols", String(session.term.cols || 120));
      socketUrl.searchParams.set("rows", String(session.term.rows || 32));
      if (!isClientInstanceName(session.name)) {
        socketUrl.searchParams.set("integrity_protocol", "fast-v1");
      }
    }
    const themePayload = terminalThemePayload();
    if (!usesMultiplexedTransport) {
      socketUrl.searchParams.set("fg", themePayload.foreground);
      socketUrl.searchParams.set("bg", themePayload.background);
      socketUrl.searchParams.set("cursor", themePayload.cursor);
    }
    if (!isClientInstanceName(session.name) && session.workspaceGeneration && !usesMultiplexedTransport) {
      socketUrl.searchParams.set("workspace_generation", session.workspaceGeneration);
    }
    const historyConnectRange = isClientInstanceName(session.name)
      ? terminalReplay.rangeForConnect(session)
      : null;
    if (historyConnectRange) {
      if (!usesMultiplexedTransport) {
        socketUrl.searchParams.set("history_generation", historyConnectRange.generation);
        socketUrl.searchParams.set("local_base_cursor", historyConnectRange.baseCursor.toString());
        socketUrl.searchParams.set("local_end_cursor", historyConnectRange.endCursor.toString());
      }
    }
    if (session.resetOnNextReplay && !usesMultiplexedTransport) {
      socketUrl.searchParams.set("history_replay_mode", "snapshot");
    }
    const logSocketUrl = new URL(socketUrl.toString());
    logSocketUrl.searchParams.delete("client_id");
    logSocketUrl.searchParams.delete("history_generation");
    logSocketUrl.searchParams.delete("workspace_generation");
    const socketDebug = {
      textMessages: 0,
      binaryMessages: 0,
      binaryBytes: 0,
      openedAt: 0,
    };
    const replayController = session.replayController || (session.replayController = new TerminalReplayController());
    const isClientDirectTransport = channel === "fast" && isClientInstanceName(session.name);
    const clientReplayAdapter = isClientDirectTransport
      ? new ClientTerminalReplayAdapter(replayController)
      : null;
    session.fastIntegrityEnabled = false;
    replayController.reset();
    session.queueReplayControllerActive = false;
    session.queueReplayControllerLegacy = false;
    session.replayControllerLegacyActive = false;
    const decodeFastBinaryMessage = (input) => {
      const decoded = decodeFastBinaryFrame(input, {
        selector: String(session.name || ""),
        paneID: String(session.id || ""),
        historyGeneration: String(session.historyGeneration || ""),
        expectedSequence: BigInt(session.fastIntegritySequence || 1),
        expectedStartCursor: BigInt(session.fastIntegrityCursor ?? session.receivedHistoryCursor ?? 0n),
      });
      const expectedSequence = BigInt(session.fastIntegritySequence || 1);
      const expectedCursor = BigInt(session.fastIntegrityCursor ?? session.receivedHistoryCursor ?? 0n);
      if (decoded.sequence !== expectedSequence || decoded.startCursor !== expectedCursor) {
        throw new Error("Fast binary envelope sequence or cursor discontinuity");
      }
      session.fastIntegritySequence = Number(expectedSequence + 1n);
      session.fastIntegrityCursor = decoded.endCursor;
      if (replayController.phase === "replaying") {
        replayController.acceptBinary({
          sequence: decoded.header.sequence,
          startCursor: decoded.header.start_cursor,
          endCursor: decoded.header.end_cursor,
          length: decoded.header.length,
          requestID: String(session.terminalReplayGeneration || ""),
          connectionEpoch,
          identity: {
            selector: session.name,
            paneID: session.id,
            historyGeneration: session.historyGeneration,
          },
        });
      }
      return decoded.payload;
    };
    console.info("[client-terminal] websocket connecting", {
      name: session.name,
      pane: session.id,
      cols: session.term.cols || 120,
      rows: session.term.rows || 32,
      url: logSocketUrl.toString(),
      allowHidden,
      documentHidden: document.hidden,
      reconnectAttempts: session.reconnectAttempts || 0,
      channel,
      historySource: historyConnectRange?.source || "snapshot",
      localBaseCursor: historyConnectRange?.baseCursor?.toString?.() || "",
      localEndCursor: historyConnectRange?.endCursor?.toString?.() || "",
    });
    recordTerminalSessionEvent(session, "socket_connect", {
      channel,
      streamID: session.unifiedStreamID,
    });
    let currentSocket;
    let currentMultiplexedConnection = null;
    if (usesMultiplexedTransport) {
      const multiplexedConnection = terminalUnifiedTransport.getConnection()
        || terminalUnifiedTransport.ensure(session.name);
      const streamID = session.unifiedStreamID;
      if (!multiplexedConnection || !streamID) {
        throw new Error(`terminal ${channel} multiplexed connection is unavailable`);
      }
      const size = terminalResize.size(session);
      const checkpointCapabilities = terminalCheckpointCapabilitiesForTerminal(session.term);
      currentMultiplexedConnection = multiplexedConnection;
      currentSocket = multiplexedConnection.open({
        pane_id: session.id,
        stream_id: streamID,
        channel_generation: channelGeneration,
        cols: size.cols || session.term.cols || 120,
        rows: size.rows || session.term.rows || 32,
        pixel_width: size.pixelWidth,
        pixel_height: size.pixelHeight,
        workspace_generation: isClientInstanceName(session.name) ? "" : session.workspaceGeneration,
        history_replay_mode: session.resetOnNextReplay ? "snapshot" : "",
        flow_control: "turn-ack-v1",
        foreground: themePayload.foreground,
        background: themePayload.background,
        cursor: themePayload.cursor,
        ...(checkpointCapabilities.length > 0
          ? { checkpoint_capabilities: checkpointCapabilities }
          : {}),
      });
    } else {
      currentSocket = new WebSocket(socketUrl.toString());
    }
    if (!transportIsCurrent()) {
      try {
        currentSocket.close(4001, "stale lease");
      } catch (error) {
      }
      return false;
    }
    session.socket = currentSocket;
    syncTerminalNetworkMonitorSockets();
    session.replayComplete = false;
    terminalReplay.setAuthorization(session, false);
    session.replayCompletionPending = false;
    terminalOutput?.resetQueueTurn(session);
    session.allowGeneratedInputDuringReplay = false;
    invalidateSessionStartupError(session);
    session.shellEl.dataset.connection = sessionConnectingState(session);
    currentSocket.binaryType = "arraybuffer";
    terminalSessionConnection.startSocketConnectTimer(session, currentSocket);

    const replayMessageHasIdentity = (message) => {
      const selector = String(message?.selector || "").trim();
      const paneID = String(message?.pane_id || message?.paneId || "").trim();
      return selector || paneID;
    };

    const validateReplayMessage = (message) => {
      const selector = String(message?.selector || "").trim();
      const paneID = String(message?.pane_id || message?.paneId || "").trim();
      // Legacy control frames may omit identity, but every identity field that
      // is present must independently match this terminal owner.
      return (!selector || selector === session.name)
        && (!paneID || paneID === session.id);
    };

    const validateWorkspaceReplayMessage = (message) => {
      if (isClientInstanceName(session.name)) {
        return true;
      }
      const expectedGeneration = String(session.workspaceGeneration || "").trim();
      return expectedGeneration !== ""
        && String(message?.workspace_generation || "").trim() === expectedGeneration
        && String(message?.tab_id || "").trim() === String(session.tabId || "").trim();
    };

    // Multiplexed transports already route frames by logical stream, but keep
    // a second identity gate at the terminal owner. This protects against a
    // stale callback or a malformed relay writing another pane into this
    // Ghostty instance after the logical stream has been replaced.
    const validateTerminalChannelMessageIdentity = (event, messageType = "", isBinary = false) => {
      if (!usesMultiplexedTransport) {
        return true;
      }
      const metadata = event?.queueMetadata;
      if (!metadata) {
        // The physical Unified state broadcast is intentionally fan-out and
        // has no pane identity. Every pane may consume only this one control.
        return !isBinary && messageType === "agent-preparing";
      }
      const paneID = String(metadata.paneID || metadata.pane_id || "").trim();
      const streamID = String(metadata.streamID || metadata.stream_id || "").trim();
      const generation = Math.floor(Number(metadata.channelGeneration || metadata.channel_generation || 0));
      const expectedStreamID = String(session.unifiedStreamID).trim();
      return paneID === session.id
        && streamID !== ""
        && streamID === expectedStreamID
        && Number.isSafeInteger(generation)
        && generation > 0
        && generation === Math.floor(Number(channelGeneration || 0));
    };

    const rejectMismatchedReplay = (message) => {
      const selector = String(message?.selector || "").trim() || "unknown";
      const paneID = String(message?.pane_id || message?.paneId || "").trim() || "unknown";
      terminalPresentation.invalidate(session);
      console.warn("[client-terminal] rejected terminal replay", {
        selector,
        pane: paneID,
        expectedName: session.name,
        expectedPane: session.id,
        messageType: message?.type,
      });
      appendDebugError("终端回放身份校验失败", `${selector}/${paneID}`);
      console.warn(`Rejected terminal replay for ${selector}/${paneID}; expected ${session.name}/${session.id}.`);
      terminalSessionConnection.closeSocketForReconnect(session, currentSocket, "Terminal replay identity validation failed.");
    };

    const rejectMismatchedChannelMessage = (event, messageType) => {
      const metadata = event?.queueMetadata || {};
      const paneID = String(metadata.paneID || metadata.pane_id || "unknown").trim() || "unknown";
      const streamID = String(metadata.streamID || metadata.stream_id || "unknown").trim() || "unknown";
      session.resetOnNextReplay = true;
      session.replayComplete = false;
      terminalReplay.setAuthorization(session, false);
      session.replayCompletionPending = false;
      session.replayController?.reset();
      session.queueReplayControllerActive = false;
      session.queueReplayControllerLegacy = false;
      session.replayControllerLegacyActive = false;
      terminalOutput.discard(session);
      // Keep the last valid frame visible while the current logical stream is
      // replaced. The wrong frame must never be allowed to turn into a black
      // screen while the session is resynchronizing.
      terminalPresentation.beginHold(session);
      console.warn("[client-terminal] rejected multiplexed terminal message", {
        name: session.name,
        pane: session.id,
        messageType,
        receivedPane: paneID,
        receivedStream: streamID,
        expectedStream: session.unifiedStreamID,
        expectedGeneration: channelGeneration,
      });
      appendDebugError("终端会话消息身份不匹配", `${session.name}/${session.id}: ${messageType}`);
      terminalSessionConnection.closeSocketForReconnect(session, currentSocket, "Terminal multiplexed message identity validation failed.");
    };

    const rejectHistorySync = (reason) => {
      const resetFailureReason = session.lastHistoryResetFailureReason;
      if (resetFailureReason && /reset/i.test(String(reason)) && /failed|exception/i.test(String(reason))) {
        reason = `${reason} (${resetFailureReason})`;
      }
      session.resetOnNextReplay = true;
      session.historyStateReady = false;
      session.historyProtocolActive = false;
      session.historyCacheSnapshot = null;
      session.historyGeneration = "";
      session.replayController?.reset();
      session.queueReplayControllerActive = false;
      session.queueReplayControllerLegacy = false;
      session.replayControllerLegacyActive = false;
      terminalPresentation.markSyncPending(session);
      if (isClientDirectTransport) {
        clientHistory.deleteSession(session);
      }
      console.warn("[terminal-history] rejected history sync", {
        name: session.name,
        pane: session.id,
        reason,
      });
      appendDebugError("终端历史同步失败", reason);
      if (terminalReplay.noteFailure(session, reason)) {
        try {
          currentSocket.close(4001, "replay_retry_paused");
        } catch (error) {
        }
        return;
      }
      terminalSessionConnection.closeSocketForReconnect(session, currentSocket, `Terminal history sync failed: ${reason}`);
    };

    currentSocket.addEventListener("open", () => {
      if (session.socket !== currentSocket || !transportIsCurrent()) {
        return;
      }
      if (!usesMultiplexedTransport) {
        terminalTransportRuntime?.notifyDirectOpen(session, leaseID);
      }
      socketDebug.openedAt = Date.now();
      appendStartupTrace("终端 WebSocket 已打开", `pane=${session.id} channel=${channel}`, { dedupeKey: `socket-open:${session.id}:${session.terminalReplayGeneration}:${channel}` });
      console.info("[client-terminal] websocket open", {
        name: session.name,
        pane: session.id,
        cols: session.term.cols || 120,
        rows: session.term.rows || 32,
        reconnectAttempts: session.reconnectAttempts || 0,
      });
      session.reconnectPending = false;
      session.shellEl.dataset.connection = sessionConnectingState(session);
      terminalSessionConnection.clearSocketConnectTimer(session);
      terminalSessionConnection.startSocketHealthMonitor(session, currentSocket);
      terminalSessionConnection.startAttachReadyTimer(session, currentSocket);
      if (isDeployRestartDialogOpen() || session.inputLocked) {
        terminalInput?.setSessionLocked(session, true);
        terminalInput?.discardSession(session);
      }
      sendTerminalTheme(session);
      terminalResize.resizePane(session, { forceSizeSync: true });
      if (session.tabId === getActiveTabId() && currentTab()?.activePaneId === session.id) {
        session.term.focus();
      }
    });

    currentSocket.addEventListener("message", (event) => {
      if (session.socket !== currentSocket || !transportIsCurrent()) {
        return;
      }
      terminalSessionConnection.markSocketHealth(session, currentSocket);
      session.startupErrorShown = true;
      if (session.name !== getActiveName()) {
        terminalTransportRuntime?.releaseDirectSession(session, "tab_or_target_removed");
        return;
      }
      if (typeof event.data === "string") {
        socketDebug.textMessages += 1;
        try {
          const message = JSON.parse(event.data);
          if (message && typeof message.type === "string") {
            if (!validateTerminalChannelMessageIdentity(event, message.type, false)) {
              rejectMismatchedChannelMessage(event, message.type);
              return;
            }
            if (
              socketDebug.textMessages <= 8
              || message.type === "history-replay-start"
              || message.type === "history-replay-complete"
              || message.type === "process-exit"
              || message.type === "agent-preparing"
            ) {
              console.info("[client-terminal] websocket control message", {
                name: session.name,
                pane: session.id,
                type: message.type,
                selector: message.selector || "",
                paneID: message.pane_id || message.paneId || "",
                replayVerified: session.replayVerified || false,
                replayComplete: session.replayComplete,
                syncMode: message.sync_mode || "",
                serverBaseCursor: message.server_base_cursor || "",
                serverEndCursor: message.server_end_cursor || "",
                textMessages: socketDebug.textMessages,
              });
            }
            switch (message.type) {
              case "resize-owner-released":
                if (!validateReplayMessage(message)) {
                  rejectMismatchedReplay(message);
                  return;
                }
                terminalResize.handleOwnerReleased(session, message);
                return;
              case "resize-applied":
                if (!validateReplayMessage(message)) {
                  rejectMismatchedReplay(message);
                  return;
                }
                terminalResize.handleApplied(session, message);
                return;
              case "resize-error":
                if (!validateReplayMessage(message)) {
                  rejectMismatchedReplay(message);
                  return;
                }
                terminalResize.handleError(session, message);
                return;
              case "history-replay-start":
                if (!validateReplayMessage(message)) {
                  rejectMismatchedReplay(message);
                  return;
                }
                recordTerminalSessionEvent(session, "history_replay_start", {
                  syncMode: String(message.sync_mode || ""),
                });
                // Keep one suppression scope across all replay drain tasks.
                // writeReplay() alone only protects one synchronous chunk.
                beginTerminalRenderSuppression(session, "replay");
                session.agentPreparing = false;
                terminalResize.handleReplayStart(session, message);
                const historyGeneration = String(message.history_generation || "").trim();
                const syncMode = String(message.sync_mode || "").trim();
                const serverBaseCursor = terminalReplay.parseCursor(message.server_base_cursor);
                const serverEndCursor = terminalReplay.parseCursor(message.server_end_cursor);
                const deltaFromCursor = terminalReplay.parseCursor(message.delta_from_cursor);
                const deltaToCursor = terminalReplay.parseCursor(message.delta_to_cursor);
                session.fastIntegrityEnabled = String(message.integrity_protocol || "").trim() === "fast-v1";
                const modernHistoryProtocol = Boolean(historyGeneration && syncMode);
                if (!modernHistoryProtocol) {
                  replayController.beginLegacy({
                    requestID: String(session.terminalReplayGeneration || ""),
                    connectionEpoch,
                    identity: { selector: session.name, paneID: session.id },
                  });
                  session.queueReplayControllerActive = false;
                  session.queueReplayControllerLegacy = usesMultiplexedTransport;
                  session.replayControllerLegacyActive = true;
                  session.historyProtocolActive = false;
                  session.historyStateReady = false;
                  session.historyGeneration = "";
                  session.historyCacheSnapshot = null;
                  session.localBaseCursor = 0n;
                  session.receivedHistoryCursor = 0n;
                  session.appliedHistoryCursor = 0n;
                  session.persistedHistoryCursor = 0n;
                  session.historyReplayTargetCursor = 0n;
                  session.serverBaseCursor = 0n;
                  if (isClientDirectTransport) {
                    clientHistory.disableSession(session);
                  }
                  if (!resetTerminalForHistoryReplay(session)) {
                    terminalSessionConnection.closeSocketForReconnect(session, currentSocket, "Terminal reset for legacy replay failed.");
                    return;
                  }
                  terminalReplay.setAuthorization(
                    session,
                    replayMessageHasIdentity(message) ? "identified" : "legacy",
                  );
                  session.allowGeneratedInputDuringReplay = message.allow_generated_input === true || message.allowGeneratedInput === true;
                  terminalInput?.clearGeneratedSuppression(session);
                  session.shellEl.dataset.connection = sessionConnectingState(session);
                  return;
                }
                if (
                  !["snapshot", "delta", "current"].includes(syncMode) ||
                  serverBaseCursor === null ||
                  serverEndCursor === null ||
                  deltaFromCursor === null ||
                  deltaToCursor === null ||
                  serverBaseCursor > serverEndCursor ||
                  deltaFromCursor > deltaToCursor ||
                  deltaToCursor !== serverEndCursor
                ) {
                  rejectHistorySync("invalid server history range");
                  return;
                }
                if (!validateWorkspaceReplayMessage(message)) {
                  rejectHistorySync("terminal workspace replay identity does not match");
                  return;
                }
                session.historyProtocolActive = true;
                session.historyGeneration = historyGeneration;
                session.historySyncMode = syncMode;
                appendStartupTrace("PTY replay 开始", `pane=${session.id} mode=${syncMode || "legacy"}`, { dedupeKey: `replay-start:${session.id}:${session.terminalReplayGeneration}` });
                session.fastIntegritySequence = 1;
                session.fastIntegrityCursor = deltaFromCursor ?? 0n;
                session.historyReplayTargetCursor = deltaToCursor;
                if (isClientDirectTransport) {
                  clientReplayAdapter.begin({
                    requestID: String(session.terminalReplayGeneration || ""),
                    connectionEpoch,
                    identity: {
                      selector: session.name,
                      paneID: session.id,
                      historyGeneration,
                    },
                    startCursor: deltaFromCursor,
                    targetCursor: deltaToCursor,
                  });
                  session.replayControllerLegacyActive = false;
                } else if (channel === "fast" && !isClientInstanceName(session.name) && !usesMultiplexedTransport && session.fastIntegrityEnabled !== true) {
                  replayController.beginLegacy({
                    requestID: String(session.terminalReplayGeneration || ""),
                    connectionEpoch,
                    identity: { selector: session.name, paneID: session.id },
                  });
                  session.replayControllerLegacyActive = true;
                } else {
                  replayController.begin({
                    requestID: String(session.terminalReplayGeneration || ""),
                    connectionEpoch,
                    identity: {
                      selector: session.name,
                      paneID: session.id,
                      historyGeneration,
                    },
                    startCursor: deltaFromCursor,
                    targetCursor: deltaToCursor,
                  });
                  session.replayControllerLegacyActive = false;
                }
                session.queueReplayControllerActive = usesMultiplexedTransport && deltaFromCursor === deltaToCursor;
                session.queueReplayControllerLegacy = false;
                session.serverBaseCursor = serverBaseCursor;
                session.resetOnNextReplay = false;
                if (syncMode === "snapshot") {
                  if (!resetTerminalForHistoryReplay(session)) {
                    rejectHistorySync("terminal reset failed");
                    return;
                  }
                  session.historyGeneration = historyGeneration;
                  session.historyProtocolActive = true;
                  session.historySyncMode = syncMode;
                  session.serverBaseCursor = serverBaseCursor;
                  session.localBaseCursor = serverBaseCursor;
                  session.receivedHistoryCursor = deltaFromCursor;
                  session.appliedHistoryCursor = deltaFromCursor;
                  session.persistedHistoryCursor = deltaFromCursor;
                  terminalReplay.setAuthorization(session, "identified");
                  if (isClientDirectTransport) {
                    clientHistory.resetSession(session, historyGeneration, deltaFromCursor);
                  }
                } else {
                  if (!historyConnectRange || historyConnectRange.generation !== historyGeneration || historyConnectRange.endCursor !== deltaFromCursor) {
                    rejectHistorySync("local and server history ranges do not match");
                    return;
                  }
                  if (historyConnectRange.source === "memory") {
                    if (!session.historyStateReady || session.appliedHistoryCursor !== deltaFromCursor) {
                      rejectHistorySync("in-memory terminal cursor is not reusable");
                      return;
                    }
                    terminalOutput.discard(session);
                    session.receivedHistoryCursor = deltaFromCursor;
                  } else if (historyConnectRange.source === "cache") {
                    const snapshot = session.historyCacheSnapshot;
                    if (!snapshot || snapshot.generation !== historyGeneration || snapshot.baseCursor !== historyConnectRange.baseCursor || snapshot.endCursor !== deltaFromCursor) {
                      rejectHistorySync("cached terminal history is unavailable");
                      return;
                    }
                    if (!resetTerminalForHistoryReplay(session)) {
                      rejectHistorySync("terminal reset for cached history failed");
                      return;
                    }
                    session.historyGeneration = historyGeneration;
                    session.historyProtocolActive = true;
                    session.historySyncMode = syncMode;
                    session.serverBaseCursor = serverBaseCursor;
                    session.localBaseCursor = snapshot.baseCursor;
                    session.receivedHistoryCursor = snapshot.baseCursor;
                    session.appliedHistoryCursor = snapshot.baseCursor;
                    session.persistedHistoryCursor = snapshot.endCursor;
                    for (const chunk of snapshot.chunks) {
                      terminalOutput.write(session, chunk.data, {
                        historySource: "cache",
                        startCursor: chunk.startCursor,
                        endCursor: chunk.endCursor,
                      });
                    }
                    if (session.receivedHistoryCursor !== deltaFromCursor) {
                      rejectHistorySync("cached terminal history did not reach requested cursor");
                      return;
                    }
                  } else {
                    rejectHistorySync("unknown local history source");
                    return;
                  }
                }
                terminalReplay.setAuthorization(session, "identified");
                session.allowGeneratedInputDuringReplay = message.allow_generated_input === true || message.allowGeneratedInput === true;
                terminalInput?.clearGeneratedSuppression(session);
                session.shellEl.dataset.connection = sessionConnectingState(session);
                return;
              case "history-replay-complete":
                appendStartupTrace("PTY replay 完成通知", `pane=${session.id}`, { dedupeKey: `replay-complete:${session.id}:${session.terminalReplayGeneration}` });
                if (!terminalReplay.isAuthorized(session) || (terminalReplay.hasIdentifiedAuthorization(session) && !validateReplayMessage(message))) {
                  rejectMismatchedReplay(message);
                  return;
                }
                if (session.historyProtocolActive) {
                  const completeGeneration = String(message.history_generation || "").trim();
                  const completeCursor = terminalReplay.parseCursor(message.history_cursor);
                  if (
                    completeGeneration !== session.historyGeneration
                    || completeCursor === null
                    || completeCursor !== session.historyReplayTargetCursor
                    || session.receivedHistoryCursor < completeCursor
                    || !validateWorkspaceReplayMessage(message)
                  ) {
                    rejectHistorySync("history replay completion range does not match");
                    return;
                  }
                }
                if (session.replayControllerLegacyActive) {
                  try {
                    replayController.completeLegacy({
                      requestID: String(session.terminalReplayGeneration || ""),
                      connectionEpoch,
                      identity: { selector: session.name, paneID: session.id },
                    });
                  } catch (error) {
                    rejectMismatchedReplay(message);
                    return;
                  }
                }
                const replayControllerRequired = (
                  channel === "fast" && !isClientInstanceName(session.name) && session.fastIntegrityEnabled === true
                ) || (
                  isClientDirectTransport && session.historyProtocolActive
                ) || (
                  usesMultiplexedTransport && session.queueReplayControllerActive
                );
                if (replayControllerRequired && session.historyProtocolActive) {
                  try {
                    if (isClientDirectTransport) {
                      clientReplayAdapter.complete({
                        cursor: message.history_cursor,
                        requestID: String(session.terminalReplayGeneration || ""),
                        connectionEpoch,
                        identity: {
                          selector: session.name,
                          paneID: session.id,
                          historyGeneration: session.historyGeneration,
                        },
                      });
                    } else {
                      replayController.complete({
                        cursor: message.history_cursor,
                        requestID: String(session.terminalReplayGeneration || ""),
                        connectionEpoch,
                        identity: {
                          selector: session.name,
                          paneID: session.id,
                          historyGeneration: session.historyGeneration,
                        },
                      });
                    }
                  } catch (error) {
                    rejectHistorySync(error?.message || "Replay completion validation failed");
                    return;
                  }
                }
                recordTerminalSessionEvent(session, "history_replay_complete", {
                  cursor: message.history_cursor || "",
                });
                session.replayCompletionPending = true;
                terminalReplay.finishIfReady(session) || terminalOutput.flush(session);
                return;
              case "queue-turn-complete":
                if (usesMultiplexedTransport) {
                  const turnResult = terminalOutput?.completeQueueTurn(session, {
                    appliedCursor: message.applied_cursor,
                    appliedSequence: message.applied_sequence,
                    socket: currentSocket,
                    connectionEpoch,
                    channelGeneration: Number(session.connectionChannelGeneration || 0),
                  });
                  if (turnResult?.status === "invalid") {
                    rejectHistorySync(turnResult.reason);
                    return;
                  }
                  if (turnResult?.status === "accepted" && terminalReplay.isCommitted(session)) {
                    terminalPresentation.ensure(session, {
                      reason: "queue_turn_complete",
                      forceHistory: true,
                    });
                  }
                }
                return;
              case "agent-preparing":
                session.agentPreparing = true;
                terminalSessionConnection.startAttachReadyTimer(session, currentSocket, terminalAgentPrepareTimeoutMs);
                session.shellEl.dataset.connection = sessionConnectingState(session);
                return;
              case "workspace-refresh-required":
                terminalTransportRuntime?.releaseDirectSession(session, "tab_or_target_removed");
                refreshWorkspaceWithRetry({ focus: session.tabId === getActiveTabId() }).catch((error) => showToast(error.message));
                return;
              case "connection-error":
                console.warn("[client-terminal] retryable connection error", {
                  name: session.name,
                  pane: session.id,
                  message: message.message || "",
                });
                if (!terminalReplay.isCommitted(session) && terminalReplay.noteFailure(session, message.message || "replay_connection_error")) {
                  try {
                    currentSocket.close(4001, "replay_retry_paused");
                  } catch (error) {
                  }
                  return;
                }
                terminalSessionConnection.closeSocketForReconnect(session, currentSocket, message.message || "Terminal retryable connection error.");
                return;
              case "pong":
                return;
              case "process-exit":
                console.warn("[client-terminal] process exit message", {
                  name: session.name,
                  pane: session.id,
                  retryable: message.retryable === true,
                  exitCode: message.exit_code,
                  message: message.message || "",
                });
                if (message.retryable === true && !/pane not found/i.test(String(message.message || ""))) {
                  showSessionStartupError(session, message.message || "Client terminal connection failed.");
                  terminalSessionConnection.closeSocketForReconnect(session, currentSocket, message.message || "Terminal process exited with a retryable error.");
                  return;
                }
                const shouldFocusAfterExit = session.tabId === getActiveTabId() && currentTab()?.activePaneId === session.id;
                session.exitExpected = true;
                session.workspaceExitPending = true;
                terminalTransportRuntime?.releaseDirectSession(session, "tab_or_target_removed");
                refreshWorkspaceWithRetry({ focus: shouldFocusAfterExit }).catch((error) => showToast(error.message));
                return;
            }
          }
        } catch (error) {
          if (socketDebug.textMessages <= 8) {
            console.warn("[client-terminal] websocket text message parse failed", {
              name: session.name,
              pane: session.id,
              bytes: event.data.length,
              textMessages: socketDebug.textMessages,
              error: error?.message || String(error),
            });
          }
        }
        terminalOutput.write(session, event.data, { connectionEpoch });
        return;
      }
      if (event.data instanceof ArrayBuffer) {
        socketDebug.binaryMessages += 1;
        socketDebug.binaryBytes += event.data.byteLength;
        if (!validateTerminalChannelMessageIdentity(event, "", true)) {
          rejectMismatchedChannelMessage(event, "binary-output");
          return;
        }
        if (socketDebug.binaryMessages <= 8) {
          console.info("[client-terminal] websocket binary message", {
            name: session.name,
            pane: session.id,
            bytes: event.data.byteLength,
            binaryMessages: socketDebug.binaryMessages,
            binaryBytes: socketDebug.binaryBytes,
            replayVerified: session.replayVerified || false,
            replayComplete: session.replayComplete,
          });
        }
        let outputPayload = new Uint8Array(event.data);
        if (channel === "fast" && !isClientInstanceName(session.name) && session.fastIntegrityEnabled === true) {
          try {
            outputPayload = decodeFastBinaryMessage(event.data);
            if (!outputPayload) {
              throw new Error("Fast binary integrity envelope is missing");
            }
          } catch (error) {
            rejectHistorySync(error?.message || "Fast binary integrity validation failed");
            return;
          }
        }
        if (isClientDirectTransport && replayController.phase === "replaying" && session.historyProtocolActive) {
          try {
            clientReplayAdapter.acceptBinary({
              data: outputPayload,
              requestID: String(session.terminalReplayGeneration || ""),
              connectionEpoch,
              identity: {
                selector: session.name,
                paneID: session.id,
                historyGeneration: session.historyGeneration,
              },
            });
          } catch (error) {
            rejectHistorySync(error?.message || "Client replay cursor validation failed");
            return;
          }
        }
        if (usesMultiplexedTransport && replayController.phase === "replaying" && session.historyProtocolActive) {
          const metadata = event.queueMetadata || {};
          if (metadata.sequence === undefined || metadata.sequence === null) {
            replayController.reset();
            session.queueReplayControllerActive = false;
            session.queueReplayControllerLegacy = true;
          } else {
            try {
              replayController.acceptBinary({
                sequence: metadata.sequence,
                startCursor: metadata.startCursor,
                endCursor: metadata.endCursor,
                length: outputPayload.byteLength,
                requestID: String(session.terminalReplayGeneration || ""),
                connectionEpoch,
                identity: {
                  selector: session.name,
                  paneID: session.id,
                  historyGeneration: session.historyGeneration,
                },
              });
              session.queueReplayControllerActive = true;
            } catch (error) {
              rejectHistorySync(error?.message || "Queue replay controller validation failed");
              return;
            }
          }
        }
        if (!terminalReplay.isAuthorized(session) && !terminalReplay.isCommitted(session)) {
          if (socketDebug.binaryMessages <= 8) {
            console.warn("[client-terminal] dropped binary before replay verification", {
              name: session.name,
              pane: session.id,
              bytes: event.data.byteLength,
              binaryMessages: socketDebug.binaryMessages,
            });
          }
          return;
        }
        try {
          if (usesMultiplexedTransport) {
            const metadata = event.queueMetadata || {};
          terminalOutput?.noteQueueTurnFrame(session, metadata);
        }
        terminalOutput.write(session, outputPayload, {
            connectionEpoch,
            deferRender: usesMultiplexedTransport && terminalReplay.isCommitted(session),
          });
        } catch (error) {
          rejectHistorySync(error?.message || "terminal history output range failed");
        }
      }
    });

    currentSocket.addEventListener("close", (event) => {
      if (session.socket !== currentSocket || (!usesMultiplexedTransport && session.connectionLeaseID !== leaseID)) {
        return;
      }
      recordTerminalSessionEvent(session, "socket_close", {
        channel,
        code: Number(event.code || 0),
        wasClean: event.wasClean === true,
      });
      const schedulerCloseReason = usesMultiplexedTransport
        ? String(session.connectionCloseReason || "")
        : String(session.connectionLeaseCloseReason || "");
      const intentionallyParked = [
        "scheduler_preempt",
        "capacity_reduced",
        "background_tab_parked",
        "membership_removed",
      ].includes(schedulerCloseReason);
      const intentionallyClosed = [
        "session_closed",
        "tab_or_target_removed",
        "page_disposed",
      ].includes(schedulerCloseReason);
      const intentionalTransportClose = intentionallyParked || intentionallyClosed;
      terminalInput?.pausePendingExpiry(session);
      console[intentionalTransportClose ? "info" : "warn"]("[client-terminal] websocket close", {
        name: session.name,
        tab: session.tabId,
        pane: session.id,
        scope: "session/tab/pane",
        code: event.code,
        reason: event.reason || "",
        wasClean: event.wasClean,
        openDurationMs: socketDebug.openedAt ? Date.now() - socketDebug.openedAt : 0,
        textMessages: socketDebug.textMessages,
        binaryMessages: socketDebug.binaryMessages,
        binaryBytes: socketDebug.binaryBytes,
        replayVerified: session.replayVerified || false,
        replayComplete: session.replayComplete,
        startupErrorShown: session.startupErrorShown,
        exitExpected: session.exitExpected === true,
      });
      if (!intentionalTransportClose) {
        appendDebugWarning("终端 WebSocket 已断开", `${terminalLocationDescription(session)}, code=${event.code}, ${event.reason || "无原因"}`);
      }
      const sharedPhysicalTransportLost = !isClientInstanceName(session.name)
        && currentMultiplexedConnection
        && terminalUnifiedTransport.isClosedConnection(currentMultiplexedConnection);
      const nextConnectionState = terminalReplay.isRetryPaused(session)
        ? "error"
        : intentionallyParked
        ? "parked"
        : intentionallyClosed
          ? "closed"
          : schedulerCloseReason === "network_offline"
          ? "offline"
          : sharedPhysicalTransportLost
            || isNetworkFailureReason(schedulerCloseReason)
            || isNetworkFailureReason(event.reason)
          ? "network-error"
          : "reconnecting";
      const retryableTransportClose = !intentionallyClosed && (usesMultiplexedTransport
        || isRetryableTerminalTransportError(schedulerCloseReason)
        || isRetryableTerminalTransportError(event.reason));
      if (retryableTransportClose) {
        invalidateSessionStartupError(session, { hidePanel: true });
      }
      detachSessionSocket(session, currentSocket, { connection: nextConnectionState });
      if (usesMultiplexedTransport) {
        session.unifiedConnectPending = false;
      }
      session.connectionLeaseClosing = false;
      session.connectionLeaseCloseReason = "";
      session.connectionLeaseID = 0;
      session.connectionCloseReason = "";
      if (usesMultiplexedTransport) {
        session.connectionChannel = "";
        session.connectionChannelGeneration = 0;
        session.unifiedStreamID = "";
      } else {
        session.connectionChannel = "";
        session.connectionChannelGeneration = 0;
        session.fastStreamID = "";
      }
      if (!session.closed) {
        terminalOutput.flush(session);
      }
      if (usesMultiplexedTransport) {
        if (sharedPhysicalTransportLost) {
          return;
        }
        if (!session.closed && !intentionallyClosed && !intentionallyParked) {
          terminalTransportRuntime?.scheduleUnifiedPaneRetry(
            session,
            `${terminalLocationDescription(session)}: ${schedulerCloseReason || event.reason || "unified_stream_closed"}`,
            { immediate: true },
          );
        }
        return;
      }
      const fastPhysicalTransportLost = false;
      if (!fastPhysicalTransportLost) {
        terminalTransportRuntime?.notifyDirectClosed(session, leaseID, {
          reason: schedulerCloseReason || "server_close",
          code: event.code,
          wasClean: event.wasClean,
        });
      }
      // Direct client sockets remain scheduler-owned; Unified physical loss is
      // handled above by the single physical owner.
      if (intentionallyParked) {
        appendDebugLog("info", "终端连接已停放", `${terminalLocationDescription(session)}, lease=${leaseID}`);
        return;
      }
      if (session.exitExpected || session.closed || schedulerCloseReason === "tab_or_target_removed" || schedulerCloseReason === "page_disposed") {
        return;
      }
      if (!retryableTransportClose && !fastPhysicalTransportLost && !session.startupErrorShown) {
        session.startupErrorShown = true;
        showSessionStartupError(session, event.reason || "WebSocket closed before terminal attached.");
      }
    });

    currentSocket.addEventListener("error", (event) => {
      if (session.socket !== currentSocket || !transportIsCurrent()) {
        return;
      }
      console.warn("[client-terminal] websocket error", {
        name: session.name,
        pane: session.id,
        readyState: currentSocket.readyState,
        openDurationMs: socketDebug.openedAt ? Date.now() - socketDebug.openedAt : 0,
        textMessages: socketDebug.textMessages,
        binaryMessages: socketDebug.binaryMessages,
        binaryBytes: socketDebug.binaryBytes,
        replayVerified: session.replayVerified || false,
        replayComplete: session.replayComplete,
        eventType: event.type,
      });
      appendDebugError("终端 WebSocket 错误", `${session.name}/${session.id}: ${event.message || "连接失败"}`);
      session.connectionRetrying = true;
      session.shellEl.dataset.connection = "network-error";
      terminalOutput.flush(session);
      if (!isRetryableTerminalTransportError(event.message || "WebSocket connection failed.") && !session.startupErrorShown) {
        session.startupErrorShown = true;
        showSessionStartupError(session, "WebSocket connection failed.");
      }
      if (usesMultiplexedTransport) {
        terminalTransportRuntime?.recycleUnifiedSession(session, "unified logical websocket error", { immediate: true });
      } else {
        terminalTransportRuntime?.notifyDirectFailure(session, leaseID, new Error("Terminal WebSocket error"), { awaitClose: true });
      }
    });
    return true;
  };

  return Object.freeze({ connectSession });
}
