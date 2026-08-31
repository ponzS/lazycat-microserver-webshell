import { createAppRuntimeRecoveryLifecycle } from "./runtime_recovery_lifecycle.js";

export function createAppRuntimeRecoveryController({
  networkBanner = null,
  getTabs = () => [],
  getCurrentTab = () => null,
  getActiveName = () => "",
  getActiveSession = () => null,
  isOnline = () => true,
  clearUnifiedRetry = () => {},
  isReplayRetryPaused = () => false,
  resumeReplayRetry = () => {},
  checkSessionHealth = () => false,
  probeOpenSocket = () => {},
  setTransportOnline = () => {},
  probeUnifiedTransport = () => false,
  retryUnifiedTransport = () => false,
  waitForUnifiedClosures = () => Promise.resolve(),
  clearExpectedCloseReason = () => {},
  refreshMembership = () => {},
  syncConnectionDemands = () => {},
  closeUnifiedTransport = () => {},
  rememberWorkspaceRestoreState = () => {},
  resumeDevices = () => {},
  resizeActiveTab = () => {},
  claimActiveSize = () => {},
  resumeWorkspaceRetry = () => {},
  refreshWorkspaceActivity = () => Promise.resolve(),
  updateSelection = () => {},
  renderNetworkMonitor = () => {},
  showToast = () => {},
  appendDebugLog = () => {},
  lifecycleFactory = createAppRuntimeRecoveryLifecycle,
  lifecycleOptions,
} = {}) {
  const lifecycle = lifecycleFactory(lifecycleOptions);
  let lastNetworkBannerState = null;

  const setNetworkBanner = (visible, message = "") => {
    if (lifecycle.isDisposed() || !networkBanner) {
      return false;
    }
    const nextState = visible ? "offline" : "online";
    if (lastNetworkBannerState !== nextState) {
      lastNetworkBannerState = nextState;
      appendDebugLog(
        visible ? "error" : "info",
        visible ? "网络已断开，终端暂停重试" : "网络已恢复，终端开始重连",
      );
    }
    networkBanner.textContent = message || "Offline. Reconnecting when network is back.";
    networkBanner.hidden = !visible;
    return true;
  };

  const markWorkspaceSessionsOffline = () => {
    if (lifecycle.isDisposed()) {
      return false;
    }
    for (const tab of getTabs()) {
      for (const pane of tab.panes?.values?.() || []) {
        if (!pane.closed) {
          clearUnifiedRetry(pane);
          pane.shellEl.dataset.connection = "offline";
        }
      }
    }
    return true;
  };

  const reconnectVisibleSessions = ({ allowHidden = false, probe = false } = {}) => {
    if (lifecycle.isDisposed() || !isOnline()) {
      return false;
    }
    const tab = getCurrentTab();
    for (const pane of tab?.panes?.values?.() || []) {
      if (pane.name !== getActiveName()) {
        continue;
      }
      if (probe && isReplayRetryPaused(pane)) {
        resumeReplayRetry(pane, "user_recovery");
      }
      const ready = checkSessionHealth(pane, { connect: true, force: true, allowHidden });
      if (probe && ready) {
        probeOpenSocket(pane, { allowHidden });
      }
    }
    return true;
  };

  const reconnectWorkspaceSessions = ({ allowHidden = true } = {}) => {
    if (lifecycle.isDisposed() || !isOnline()) {
      return false;
    }
    for (const tab of getTabs()) {
      for (const pane of tab.panes?.values?.() || []) {
        if (pane.name === getActiveName()) {
          resumeReplayRetry(pane, "network_online");
          checkSessionHealth(pane, { connect: true, force: true, allowHidden });
        }
      }
    }
    return true;
  };

  const recoverVisibleSessionsFromUserGesture = () => {
    if (!lifecycle.shouldRecoverFromUserGesture()) {
      return false;
    }
    return reconnectVisibleSessions({ allowHidden: true, probe: true });
  };

  const refreshActivitySilently = () => {
    Promise.resolve(refreshWorkspaceActivity({ silent: true })).catch(() => {});
  };

  const recoverUnifiedTransport = (reason) => (
    probeUnifiedTransport(reason) || retryUnifiedTransport(reason)
  );

  const handleOnline = () => {
    if (lifecycle.isDisposed()) {
      return false;
    }
    const generation = lifecycle.nextGeneration();
    setNetworkBanner(false);
    renderNetworkMonitor();
    showToast("网络已恢复，正在重连。");
    setTransportOnline(true);
    probeUnifiedTransport("network_online");
    Promise.resolve(waitForUnifiedClosures()).then(() => {
      if (!lifecycle.isCurrent(generation) || !isOnline()) {
        return;
      }
      clearExpectedCloseReason();
      refreshMembership({ reason: "network_online" });
      syncConnectionDemands({ reason: "network_online" });
      reconnectWorkspaceSessions({ allowHidden: true });
    });
    resumeWorkspaceRetry();
    refreshActivitySilently();
    return true;
  };

  const handleOffline = () => {
    if (lifecycle.isDisposed()) {
      return false;
    }
    lifecycle.invalidate();
    setNetworkBanner(true);
    renderNetworkMonitor();
    markWorkspaceSessionsOffline();
    closeUnifiedTransport("network_offline");
    setTransportOnline(false);
    showToast("网络已断开。");
    return true;
  };

  const handleVisibilityChange = ({ hidden = false } = {}) => {
    if (lifecycle.isDisposed() || hidden) {
      return false;
    }
    rememberWorkspaceRestoreState();
    resumeDevices();
    resizeActiveTab({ forceFullRender: true, hideUntilRender: true });
    claimActiveSize(getActiveSession());
    recoverUnifiedTransport("visibility_resume");
    reconnectVisibleSessions({ allowHidden: true, probe: true });
    refreshActivitySilently();
    updateSelection();
    return true;
  };

  const handleFocus = () => {
    if (lifecycle.isDisposed()) {
      return false;
    }
    resizeActiveTab({ forceFullRender: true });
    claimActiveSize(getActiveSession());
    recoverUnifiedTransport("window_focus");
    reconnectVisibleSessions({ allowHidden: true, probe: true });
    refreshActivitySilently();
    return true;
  };

  const handlePageShow = () => {
    if (lifecycle.isDisposed()) {
      return false;
    }
    rememberWorkspaceRestoreState();
    resumeDevices();
    resizeActiveTab({ forceFullRender: true, hideUntilRender: true });
    claimActiveSize(getActiveSession());
    recoverUnifiedTransport("pageshow_resume");
    reconnectVisibleSessions({ allowHidden: true, probe: true });
    refreshActivitySilently();
    return true;
  };

  return Object.freeze({
    dispose: lifecycle.dispose,
    handleFocus,
    handleOffline,
    handleOnline,
    handlePageShow,
    handleVisibilityChange,
    markWorkspaceSessionsOffline,
    reconnectVisibleSessions,
    reconnectWorkspaceSessions,
    recoverVisibleSessionsFromUserGesture,
    setNetworkBanner,
  });
}
