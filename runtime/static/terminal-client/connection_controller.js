import { createTerminalConnectionScheduler } from "../terminal/transport/terminal_connection_scheduler.js";
import { createTerminalTransportRuntimeLifecycle } from "../terminal/transport/transport_runtime_lifecycle.js";

const noop = () => {};

// Owns the existing client-only direct socket pool. Container membership and
// Unified transport are intentionally outside this controller.
export function createClientTerminalConnectionController({
  windowObject = globalThis.window,
  createScheduler = createTerminalConnectionScheduler,
  getDisposed = () => false,
  isOnline = () => true,
  isClientTarget = () => false,
  getActiveName = () => "",
  getActiveTabID = () => "",
  getTabs = () => [],
  connectSession = async () => false,
  sessionConnectingState = () => "connecting",
  resumePendingInputExpiry = noop,
  pausePendingInputExpiry = noop,
  clearSessionConnectionTimers = noop,
  retrySessionAfterFailure = noop,
  syncConnectionDemandsAfterPriorityDecay = noop,
  appendDebugLog = noop,
  appendDebugWarning = noop,
  appendDebugError = noop,
  describeSession = (session) => `${session?.name || "unknown"}/${session?.id || "unknown"}`,
  now = () => Date.now(),
  random = () => Math.random(),
  socketClosed = 3,
  clientCapacity = 3,
  interactionPriorityMs = 1500,
  reconnectBaseDelayMs = 500,
  reconnectMaxDelayMs = 10 * 1000,
  reconnectJitterRatio = 0.2,
} = {}) {
  const lifecycle = createTerminalTransportRuntimeLifecycle({ windowObject });
  let scheduler = null;
  let schedulerState = null;
  let demandGeneration = 0;
  let disposed = false;
  const tabsArray = () => Array.from(getTabs() || []);

  const priorityFor = (session, { userInteraction = false } = {}) => {
    if (userInteraction) {
      return 0;
    }
    const activeTabID = getActiveTabID();
    const tab = tabsArray().find((candidate) => candidate?.id === session?.tabId);
    if (tab?.id === activeTabID) {
      return tab.activePaneId === session.id ? 1 : 2;
    }
    return Number(session?.lastUserInteractionAt || 0) > 0 ? 3 : 4;
  };

  const schedulePriorityDecay = (session) => {
    if (!session || session.closed || !isClientTarget(getActiveName())) {
      return false;
    }
    return lifecycle.schedulePriorityDecay(session, () => {
      if (!session.closed) {
        syncConnectionDemandsAfterPriorityDecay({ reason: "interaction_priority_decay" });
      }
    }, interactionPriorityMs);
  };

  const retryDelay = (attempt, session) => {
    const baseDelay = Math.min(reconnectMaxDelayMs, reconnectBaseDelayMs * (2 ** Math.min(attempt, 8)));
    const jitter = baseDelay * reconnectJitterRatio * ((random() * 2) - 1);
    const delay = Math.max(0, Math.round(baseDelay + jitter));
    if (session && !session.closed) {
      session.reconnectAttempts = Math.min(20, Math.max(Number(session.reconnectAttempts || 0), attempt + 1));
      appendDebugWarning(
        "终端连接将在重试",
        `${describeSession(session)}, 第 ${attempt + 1} 次, ${delay}ms 后`,
      );
    }
    return delay;
  };

  const ensureDirectScheduler = () => {
    if (scheduler) {
      return scheduler;
    }
    scheduler = createScheduler({
      capacity: clientCapacity,
      connect: async (session, lease) => {
        session.connectionChannel = "fast";
        session.connectionChannelGeneration = 0;
        session.fastStreamID = "";
        session.connectionLeaseID = lease.leaseID;
        session.connectionLeaseClosing = false;
        session.connectionLeaseCloseReason = "";
        resumePendingInputExpiry(session);
        if (session.shellEl?.dataset) {
          session.shellEl.dataset.connection = sessionConnectingState(session);
        }
        appendDebugLog(
          "info",
          "终端连接租约已分配",
          `${describeSession(session)}, lease=${lease.leaseID}, P${lease.priority}`,
        );
        try {
          const started = await connectSession(session, {
            allowHidden: lease.allowHidden,
            leaseID: lease.leaseID,
            channel: "fast",
            channelGeneration: session.connectionChannelGeneration,
          });
          if (!started && scheduler?.currentLease(session)?.leaseID === lease.leaseID) {
            throw new Error("terminal connection lease could not start");
          }
        } catch (error) {
          if (scheduler?.currentLease(session)?.leaseID === lease.leaseID) {
            pausePendingInputExpiry(session);
            session.connectionRetrying = true;
            if (session.shellEl?.dataset) {
              session.shellEl.dataset.connection = isOnline() ? "reconnecting" : "offline";
            }
            retrySessionAfterFailure(session, error, { allowHidden: true });
          }
          throw error;
        }
      },
      disconnect: (session, reason, lease) => {
        if (!session || session.connectionLeaseID !== lease.leaseID) {
          return;
        }
        session.connectionLeaseClosing = true;
        session.connectionLeaseCloseReason = reason;
        pausePendingInputExpiry(session);
        clearSessionConnectionTimers(session);
        if (["scheduler_preempt", "capacity_reduced", "background_tab_parked", "context_changed"].includes(reason)) {
          session.connectionRetrying = false;
          session.shellEl.dataset.connection = "parked";
          appendDebugLog("info", "终端连接租约被抢占", `${describeSession(session)}, lease=${lease.leaseID}`);
        } else if (reason === "network_offline") {
          session.shellEl.dataset.connection = "offline";
        } else if (["session_closed", "tab_or_target_removed", "page_disposed"].includes(reason)) {
          session.shellEl.dataset.connection = "closed";
        } else {
          session.connectionRetrying = true;
          session.shellEl.dataset.connection = "reconnecting";
        }
        const socket = session.socket;
        if (!socket || socket.readyState === socketClosed) {
          session.connectionLeaseClosing = false;
          session.connectionLeaseCloseReason = "";
          session.connectionLeaseID = 0;
          session.connectionChannelGeneration = 0;
          session.fastStreamID = "";
          scheduler?.notifyClosed(session, lease.leaseID, { reason });
          return;
        }
        try {
          socket.close(4001, reason);
        } catch (error) {
          session.socket = null;
          session.connectionLeaseClosing = false;
          session.connectionLeaseCloseReason = "";
          session.connectionLeaseID = 0;
          session.connectionChannelGeneration = 0;
          session.fastStreamID = "";
          scheduler?.notifyClosed(session, lease.leaseID, { reason });
        }
      },
      retryDelay,
      onStateChange: (state) => {
        schedulerState = state;
        if (state.capacityInvariantViolations > 0) {
          appendDebugError("终端连接池容量异常", `active=${state.activeCount}, capacity=${state.capacity}`);
        }
      },
    });
    scheduler.setOnline(isOnline());
    return scheduler;
  };

  const request = (session, {
    reason = "connection_demand",
    userInteraction = false,
    immediate = false,
    allowHidden = true,
  } = {}) => {
    session.pendingConnect = false;
    return ensureDirectScheduler().request(session, {
      priority: priorityFor(session, { userInteraction }),
      generation: demandGeneration,
      reason,
      immediate,
      allowHidden,
      lastUserInteractionAt: Number(session.lastUserInteractionAt || 0),
      lastBecameVisibleAt: Number(session.lastBecameVisibleAt || 0),
      lastOutputAt: Number(session.lastTerminalOutputAt || 0),
    });
  };

  const syncConnectionDemands = ({
    reason = "workspace_priority_changed",
    interactionSession = null,
  } = {}) => {
    const directScheduler = ensureDirectScheduler();
    if (!directScheduler || disposed || getDisposed()) {
      return false;
    }
    directScheduler.setCapacity(clientCapacity);
    demandGeneration += 1;
    const generation = demandGeneration;
    for (const tab of tabsArray()) {
      const tabIsActive = tab.id === getActiveTabID();
      for (const pane of tab.panes.values()) {
        if (pane.closed || pane.name !== getActiveName() || Number(pane.measuredFitGeneration || 0) <= 0) {
          continue;
        }
        if (!tabIsActive) {
          directScheduler.release(pane, "background_tab_parked");
          continue;
        }
        pane.lastBecameVisibleAt = now();
        directScheduler.request(pane, {
          priority: priorityFor(pane, { userInteraction: pane === interactionSession }),
          generation,
          reason,
          immediate: pane === interactionSession,
          allowHidden: true,
          lastUserInteractionAt: Number(pane.lastUserInteractionAt || 0),
          lastBecameVisibleAt: Number(pane.lastBecameVisibleAt || 0),
          lastOutputAt: Number(pane.lastTerminalOutputAt || 0),
        });
      }
    }
    directScheduler.setGeneration(generation);
    if (interactionSession) {
      schedulePriorityDecay(interactionSession);
    }
    return true;
  };

  return Object.freeze({
    request,
    syncConnectionDemands,
    noteInteraction: schedulePriorityDecay,
    registerSession: (session) => ensureDirectScheduler().register(session),
    unregisterSession(session, reason = "session_closed") {
      lifecycle.disposeSession(session);
      return scheduler?.unregister?.(session, reason) === true;
    },
    isConnectionParked: (session) => Boolean(
      session.connectionLeaseClosing || (isClientTarget(session.name) && !scheduler?.currentLease?.(session))
    ),
    currentLease: (session) => scheduler?.currentLease?.(session) || null,
    notifyClosed: (session, leaseID, details) => scheduler?.notifyClosed?.(session, leaseID, details) === true,
    notifyFailure: (session, leaseID, error, options) => scheduler?.notifyFailure?.(session, leaseID, error, options) === true,
    notifyOpen: (session, leaseID) => scheduler?.notifyOpen?.(session, leaseID) === true,
    notifyReplayReady: (session, leaseID) => scheduler?.notifyReplayReady?.(session, leaseID) === true,
    releaseSession: (session, reason) => scheduler?.release?.(session, reason) === true,
    setOnline: (value) => scheduler?.setOnline?.(value),
    snapshot: () => Object.freeze({ scheduler: schedulerState, demandGeneration }),
    dispose(reason = "page_disposed") {
      if (disposed) return false;
      disposed = true;
      const sessions = tabsArray().flatMap((tab) => Array.from(tab?.panes?.values?.() || []));
      lifecycle.dispose(sessions);
      for (const session of sessions) scheduler?.unregister?.(session, reason);
      return true;
    },
  });
}
