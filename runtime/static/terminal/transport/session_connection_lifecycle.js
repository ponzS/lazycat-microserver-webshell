const noop = () => {};

export function createTerminalSessionConnectionLifecycle({
  windowObject = globalThis.window,
  getActiveName = () => "",
  now = () => Date.now(),
  isSocketOpen = (socket) => socket?.readyState === 1,
  isSocketConnecting = (socket) => socket?.readyState === 0,
  sendPing = (socket) => socket?.send?.(JSON.stringify({ type: "ping" })),
  isReplayCommitted = () => false,
  flushPendingInput = noop,
  closeSocketForReconnect = noop,
  pingIntervalMs = 10 * 1000,
  healthTimeoutMs = 25 * 1000,
  resumeProbeTimeoutMs = 1500,
  connectTimeoutMs = 12 * 1000,
  attachReadyTimeoutMs = 8 * 1000,
  agentPrepareTimeoutMs = 45 * 1000,
} = {}) {
  const sessions = new Set();
  let disposed = false;

  const clearTimeoutField = (session, field) => {
    if (!session?.[field]) {
      return false;
    }
    windowObject?.clearTimeout?.(session[field]);
    session[field] = 0;
    return true;
  };

  const clearReconnectTimer = (session) => {
    clearTimeoutField(session, "reconnectTimer");
    if (session) {
      session.reconnectPending = false;
    }
    return Boolean(session);
  };

  const clearSocketHealthTimer = (session) => {
    if (!session?.socketHealthTimer) {
      return false;
    }
    windowObject?.clearInterval?.(session.socketHealthTimer);
    session.socketHealthTimer = 0;
    return true;
  };

  const clearSocketConnectTimer = (session) => clearTimeoutField(session, "socketConnectTimer");
  const clearAttachReadyTimer = (session) => clearTimeoutField(session, "attachReadyTimer");
  const clearSocketResumeProbeTimer = (session) => clearTimeoutField(session, "resumeProbeTimer");

  const clearConnectionTimers = (session) => {
    clearSocketConnectTimer(session);
    clearSocketHealthTimer(session);
    clearAttachReadyTimer(session);
    clearSocketResumeProbeTimer(session);
    sessions.delete(session);
    return Boolean(session);
  };

  const markSocketHealth = (session, currentSocket) => {
    if (disposed || session?.socket !== currentSocket) {
      return false;
    }
    session.lastSocketHealthAt = now();
    clearSocketResumeProbeTimer(session);
    flushPendingInput(session);
    return true;
  };

  const probeOpenSocket = (session, { allowHidden = false } = {}) => {
    const socket = session?.socket;
    if (
      disposed
      || !socket
      || !isSocketOpen(socket)
      || session.closed
      || session.name !== getActiveName()
    ) {
      return false;
    }
    const probeStartedAt = now();
    clearSocketResumeProbeTimer(session);
    try {
      sendPing(socket);
    } catch (error) {
      closeSocketForReconnect(
        session,
        socket,
        `Terminal WebSocket resume probe failed: ${session.name}/${session.id}`,
        { allowHidden },
      );
      return false;
    }
    sessions.add(session);
    session.resumeProbeTimer = windowObject?.setTimeout?.(() => {
      session.resumeProbeTimer = 0;
      if (disposed || session.socket !== socket || !isSocketOpen(socket)) {
        return;
      }
      const lastHealth = Number(session.lastSocketHealthAt || 0);
      if (lastHealth < probeStartedAt) {
        closeSocketForReconnect(
          session,
          socket,
          `Terminal WebSocket resume probe timed out: ${session.name}/${session.id}`,
          { allowHidden },
        );
      }
    }, resumeProbeTimeoutMs) || 0;
    return true;
  };

  const startSocketHealthMonitor = (session, currentSocket) => {
    if (disposed || !session) {
      return false;
    }
    clearSocketHealthTimer(session);
    markSocketHealth(session, currentSocket);
    sessions.add(session);
    session.socketHealthTimer = windowObject?.setInterval?.(() => {
      if (disposed || session.socket !== currentSocket) {
        clearSocketHealthTimer(session);
        return;
      }
      if (!isSocketOpen(currentSocket)) {
        return;
      }
      const lastHealth = Number(session.lastSocketHealthAt || 0);
      const healthTimeout = session.agentPreparing ? agentPrepareTimeoutMs : healthTimeoutMs;
      if (lastHealth > 0 && now() - lastHealth > healthTimeout) {
        closeSocketForReconnect(
          session,
          currentSocket,
          `Terminal WebSocket health timeout: ${session.name}/${session.id}`,
        );
        return;
      }
      try {
        sendPing(currentSocket);
      } catch (error) {
        closeSocketForReconnect(
          session,
          currentSocket,
          `Terminal WebSocket ping failed: ${session.name}/${session.id}`,
        );
      }
    }, pingIntervalMs) || 0;
    return true;
  };

  const startSocketConnectTimer = (session, currentSocket) => {
    if (disposed || !session) {
      return false;
    }
    clearSocketConnectTimer(session);
    sessions.add(session);
    session.socketConnectTimer = windowObject?.setTimeout?.(() => {
      session.socketConnectTimer = 0;
      if (disposed || session.socket !== currentSocket || !isSocketConnecting(currentSocket)) {
        return;
      }
      closeSocketForReconnect(
        session,
        currentSocket,
        `Terminal WebSocket connect timed out: ${session.name}/${session.id}`,
      );
    }, connectTimeoutMs) || 0;
    return true;
  };

  const startAttachReadyTimer = (session, currentSocket, timeoutMs = attachReadyTimeoutMs) => {
    if (disposed || !session) {
      return false;
    }
    clearAttachReadyTimer(session);
    session.attachStartedAt = now();
    session.attachReadyTimeoutMs = timeoutMs;
    sessions.add(session);
    session.attachReadyTimer = windowObject?.setTimeout?.(() => {
      session.attachReadyTimer = 0;
      if (disposed || session.socket !== currentSocket || isReplayCommitted(session)) {
        return;
      }
      closeSocketForReconnect(
        session,
        currentSocket,
        `Terminal attach timed out before replay complete: ${session.name}/${session.id}`,
      );
    }, timeoutMs) || 0;
    return true;
  };

  const disposeSession = (session) => {
    clearReconnectTimer(session);
    return clearConnectionTimers(session);
  };

  const dispose = () => {
    if (disposed) {
      return false;
    }
    disposed = true;
    for (const session of Array.from(sessions)) {
      disposeSession(session);
    }
    sessions.clear();
    return true;
  };

  return Object.freeze({
    clearAttachReadyTimer,
    clearConnectionTimers,
    clearReconnectTimer,
    clearSocketConnectTimer,
    clearSocketHealthTimer,
    clearSocketResumeProbeTimer,
    dispose,
    disposeSession,
    markSocketHealth,
    probeOpenSocket,
    startAttachReadyTimer,
    startSocketConnectTimer,
    startSocketHealthMonitor,
  });
}
