/**
 * Owns ordered-tab navigation and the two-entry recent-tab history.
 * Active-tab mutation remains an injected workspace command.
 */
export function createWorkspaceTabNavigationController({
  windowObject = globalThis.window,
  storage = windowObject?.localStorage,
  storagePrefix = "webshell",
  tabsElement = null,
  getTabs = () => new Map(),
  getActiveTabId = () => "",
  getActiveName = () => "",
  activateTab = () => {},
  showToast = () => {},
} = {}) {
  let recentTabIds = [];
  let disposed = false;

  const recentTabsStorageKey = (name) => `${storagePrefix}.recentTabs.${name || "default"}`;

  const getOrderedTabs = () => {
    if (disposed) {
      return [];
    }
    const tabs = getTabs();
    const ordered = Array.from(tabsElement?.querySelectorAll?.(".tab") || [])
      .map((button) => tabs?.get?.(button.dataset?.tabId))
      .filter(Boolean);
    const orderedIDs = new Set(ordered.map((tab) => tab.id));
    for (const tab of tabs?.values?.() || []) {
      if (!orderedIDs.has(tab.id)) {
        ordered.push(tab);
      }
    }
    return ordered;
  };

  const normalizeRecentTabIds = (ids) => {
    const tabs = getTabs();
    const next = [];
    for (const id of Array.isArray(ids) ? ids : []) {
      const tabID = String(id || "").trim();
      if (tabID && tabs?.has?.(tabID) && !next.includes(tabID)) {
        next.push(tabID);
      }
      if (next.length >= 2) {
        break;
      }
    }
    return next;
  };

  const persistRecentTabIds = (name = getActiveName()) => {
    if (disposed) {
      return false;
    }
    const targetName = String(name || "").trim();
    if (!targetName) {
      return false;
    }
    try {
      const key = recentTabsStorageKey(targetName);
      if (recentTabIds.length > 0) {
        storage?.setItem?.(key, JSON.stringify(recentTabIds));
      } else {
        storage?.removeItem?.(key);
      }
      return true;
    } catch (error) {
      return false;
    }
  };

  const loadStoredRecentTabIds = (name = getActiveName()) => {
    if (disposed) {
      return [];
    }
    const targetName = String(name || "").trim();
    if (!targetName) {
      return [];
    }
    try {
      return normalizeRecentTabIds(JSON.parse(storage?.getItem?.(recentTabsStorageKey(targetName)) || "[]"));
    } catch (error) {
      return [];
    }
  };

  const applyRecentTabIds = (ids, { persist = true, name = getActiveName() } = {}) => {
    if (disposed) {
      return [];
    }
    recentTabIds = normalizeRecentTabIds(ids);
    if (persist) {
      persistRecentTabIds(name);
    }
    return recentTabIds.slice();
  };

  const pruneRecentTabIds = () => applyRecentTabIds(recentTabIds);

  const rememberRecentTab = (tabID, previousTabID = "") => {
    if (disposed) {
      return [];
    }
    const tabs = getTabs();
    const nextID = String(tabID || "").trim();
    const previousID = String(previousTabID || "").trim();
    const next = [];
    if (nextID && tabs?.has?.(nextID)) {
      next.push(nextID);
    }
    for (const id of [previousID, ...recentTabIds]) {
      if (id && id !== nextID && tabs?.has?.(id) && !next.includes(id)) {
        next.push(id);
      }
      if (next.length >= 2) {
        break;
      }
    }
    return applyRecentTabIds(next);
  };

  const swapRecentTabs = () => {
    if (disposed) {
      return false;
    }
    const targetID = pruneRecentTabIds().find((id) => id !== getActiveTabId());
    if (!targetID) {
      showToast("没有可切换的最近终端。");
      return false;
    }
    activateTab(targetID);
    return true;
  };

  const activateByOffset = (offset) => {
    const orderedTabs = getOrderedTabs();
    if (orderedTabs.length === 0) {
      return false;
    }
    const currentIndex = orderedTabs.findIndex((tab) => tab.id === getActiveTabId());
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (safeIndex + Number(offset || 0) + orderedTabs.length) % orderedTabs.length;
    activateTab(orderedTabs[nextIndex].id);
    return true;
  };

  const activateByIndex = (index) => {
    const orderedTabs = getOrderedTabs();
    const tab = orderedTabs[Math.max(0, Math.min(Number(index || 0), orderedTabs.length - 1))];
    if (!tab) {
      return false;
    }
    activateTab(tab.id);
    return true;
  };

  const scrollButtonIntoView = (button) => {
    if (disposed || !button || !tabsElement?.contains?.(button)) {
      return false;
    }
    const containerRect = tabsElement.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    if (buttonRect.left < containerRect.left) {
      tabsElement.scrollLeft -= containerRect.left - buttonRect.left;
    } else if (buttonRect.right > containerRect.right) {
      tabsElement.scrollLeft += buttonRect.right - containerRect.right;
    }
    return true;
  };

  const clear = () => {
    recentTabIds = [];
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
    activateByIndex,
    activateByOffset,
    applyRecentTabIds,
    clear,
    dispose,
    getOrderedTabs,
    getRecentTabIds: () => recentTabIds.slice(),
    isDisposed: () => disposed,
    loadStoredRecentTabIds,
    normalizeRecentTabIds,
    persistRecentTabIds,
    pruneRecentTabIds,
    rememberRecentTab,
    scrollButtonIntoView,
    swapRecentTabs,
  });
}
