/**
 * Owns the workspace tab registry and identity counters. Rendering and
 * terminal/session behavior are deliberately kept outside this module.
 */
export function createWorkspaceTabRegistry() {
  const tabs = new Map();
  let activeTabId = null;
  let nextTabSeq = 1;
  let disposed = false;

  const allocateTabId = (id = "") => {
    const requested = String(id || "").trim();
    const normalized = requested || `tab-${nextTabSeq}`;
    const numeric = Number(normalized.replace(/^tab-/, ""));
    if (Number.isFinite(numeric) && numeric >= nextTabSeq) {
      nextTabSeq = numeric + 1;
    } else if (!requested) {
      nextTabSeq += 1;
    }
    return normalized;
  };

  const setActiveTabId = (tabId) => {
    activeTabId = tabId == null ? null : String(tabId).trim() || null;
    return activeTabId;
  };

  const clear = () => {
    tabs.clear();
    activeTabId = null;
  };

  const dispose = () => {
    if (disposed) {
      return false;
    }
    disposed = true;
    clear();
    return true;
  };

  return Object.freeze({
    allocateTabId,
    clear,
    delete: (tabId) => tabs.delete(tabId),
    dispose,
    get: (tabId) => tabs.get(tabId),
    getActiveTabId: () => activeTabId,
    getNextTabSeq: () => nextTabSeq,
    has: (tabId) => tabs.has(tabId),
    isDisposed: () => disposed,
    set: (tabId, tab) => tabs.set(tabId, tab),
    setActiveTabId,
    size: () => tabs.size,
    tabs,
    values: () => tabs.values(),
  });
}
