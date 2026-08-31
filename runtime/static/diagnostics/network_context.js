// Read-only adapter between terminal session state and diagnostics.
// It intentionally returns a fresh snapshot and never mutates a session.
export function createDiagnosticsNetworkContext({
  getActiveName = () => "",
  isClientInstanceName = () => false,
  getTabs = () => [],
  getUnifiedTransport = () => null,
  isOnline = () => true,
} = {}) {
  return function getNetworkContext() {
    const activeName = String(getActiveName() || "").trim();
    const direct = isClientInstanceName(activeName);
    const sockets = [];
    let retrying = false;

    for (const tab of getTabs() || []) {
      for (const pane of tab?.panes?.values?.() || []) {
        if (pane?.closed || pane?.name !== activeName) {
          continue;
        }
        retrying ||= pane.connectionRetrying === true;
        if (direct && pane.connectionChannel === "fast" && pane.socket) {
          sockets.push({ socket: pane.socket, kind: "fast" });
        }
      }
    }

    const unifiedTransport = getUnifiedTransport();
    if (!direct && unifiedTransport?.getTargetName?.() === activeName) {
      const socket = unifiedTransport.getPhysicalSocket?.();
      if (socket) {
        sockets.push({ socket, kind: "unified" });
      }
    }

    return {
      layout: direct ? "direct" : "unified",
      online: isOnline() !== false,
      retrying,
      sockets,
    };
  };
}
