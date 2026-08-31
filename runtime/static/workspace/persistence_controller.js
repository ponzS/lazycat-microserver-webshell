const normalizeText = (value) => String(value || "").trim();

export function workspaceRestoreDisabled(searchParams) {
  return normalizeText(searchParams?.get("last")).toLowerCase() === "false";
}

function readWorkspaceRestoreState({ windowObject, storageKey }) {
  try {
    const raw = windowObject.localStorage.getItem(storageKey);
    const state = raw ? JSON.parse(raw) : null;
    const name = normalizeText(state?.name);
    const tabId = normalizeText(state?.tabId);
    const restoreURL = normalizeText(state?.url);
    if (restoreURL && workspaceRestoreDisabled(new URL(restoreURL, windowObject.location.origin).searchParams)) {
      windowObject.localStorage.removeItem(storageKey);
      return null;
    }
    if (!name) {
      windowObject.localStorage.removeItem(storageKey);
      return null;
    }
    return { name, tabId };
  } catch (error) {
    return null;
  }
}

export function restoreInitialWorkspaceLocation({
  windowObject = globalThis.window,
  searchParams = new URLSearchParams(windowObject?.location?.search || ""),
  storageKey = "webshell.workspaceRestore",
} = {}) {
  const state = readWorkspaceRestoreState({ windowObject, storageKey });
  if (!state) {
    return false;
  }
  const requestedName = normalizeText(searchParams.get("target") || searchParams.get("name"));
  let changed = false;
  if (!requestedName) {
    searchParams.set("name", state.name);
    changed = true;
  }
  if (!searchParams.get("tab") && (!requestedName || requestedName === state.name) && state.tabId) {
    searchParams.set("tab", state.tabId);
    changed = true;
  }
  if (!changed) {
    return false;
  }
  searchParams.delete("view");
  const nextURL = new URL(windowObject.location.href);
  nextURL.search = searchParams.toString();
  windowObject.history.replaceState(windowObject.history.state, "", nextURL);
  return true;
}

export function createWorkspacePersistenceController({
  windowObject = globalThis.window,
  storagePrefix = "webshell",
  getActiveName = () => "",
  getActiveTabId = () => "",
  getActiveGeneration = () => 0,
  hasTab = () => false,
  isCurrentRequest = () => true,
  getRecentTabIds = () => [],
  postWorkspaceAction = () => Promise.resolve(false),
  updateWorkspaceLocation = () => {},
} = {}) {
  const restoreStorageKey = `${storagePrefix}.workspaceRestore`;
  const restartTabStorageKey = `${storagePrefix}.restartTab`;
  const activeTabPersistenceChains = new Map();
  let suppressLocationUpdate = false;
  let suppressWorkspaceRestore = false;
  let disposed = false;

  const lastTabStorageKey = (name) => `${storagePrefix}.lastTab.${name || "default"}`;

  const workspaceLocationURL = (nextName, tabId = getActiveTabId()) => {
    const nextURL = new URL(windowObject.location.href);
    nextURL.searchParams.set("name", normalizeText(nextName));
    const normalizedTabId = normalizeText(tabId);
    if (normalizedTabId) {
      nextURL.searchParams.set("tab", normalizedTabId);
    } else {
      nextURL.searchParams.delete("tab");
    }
    return nextURL;
  };

  const updateLocationName = (nextName, { replace = false, tabId = getActiveTabId() } = {}) => {
    if (disposed) {
      return false;
    }
    updateWorkspaceLocation({
      name: nextName,
      url: workspaceLocationURL(nextName, tabId),
      replace,
    });
    return true;
  };

  const persistWorkspaceRestoreState = (name, tabId) => {
    const targetName = normalizeText(name);
    if (!targetName || disposed) {
      return false;
    }
    try {
      const targetURL = new URL(windowObject.location.href);
      if (workspaceRestoreDisabled(targetURL.searchParams)) {
        return false;
      }
      targetURL.searchParams.delete("view");
      targetURL.searchParams.delete("embed");
      targetURL.searchParams.delete("last");
      targetURL.searchParams.set("name", targetName);
      const targetTabId = normalizeText(tabId);
      if (targetTabId) {
        targetURL.searchParams.set("tab", targetTabId);
      } else {
        targetURL.searchParams.delete("tab");
      }
      windowObject.localStorage.setItem(restoreStorageKey, JSON.stringify({
        version: 1,
        name: targetName,
        tabId: targetTabId,
        url: `${targetURL.pathname}${targetURL.search}${targetURL.hash}`,
        updatedAt: Date.now(),
      }));
      return true;
    } catch (error) {
      return false;
    }
  };

  const clearWorkspaceRestoreState = () => {
    try {
      windowObject.localStorage.removeItem(restoreStorageKey);
      return true;
    } catch (error) {
      return false;
    }
  };

  const rememberWorkspaceRestoreState = () => {
    if (suppressWorkspaceRestore || disposed) {
      return false;
    }
    return persistWorkspaceRestoreState(getActiveName(), getActiveTabId());
  };

  const rememberActiveTab = () => {
    rememberWorkspaceRestoreState();
    const activeName = normalizeText(getActiveName());
    const activeTabId = normalizeText(getActiveTabId());
    if (!activeName || !activeTabId || disposed) {
      return false;
    }
    try {
      windowObject.localStorage.setItem(lastTabStorageKey(activeName), activeTabId);
    } catch (error) {
    }
    if (!suppressLocationUpdate) {
      updateLocationName(activeName, { replace: true, tabId: activeTabId });
    }
    return true;
  };

  const readLastActiveTab = (name) => {
    const targetName = normalizeText(name);
    if (!targetName || disposed) {
      return "";
    }
    try {
      return normalizeText(windowObject.localStorage.getItem(lastTabStorageKey(targetName)));
    } catch (error) {
      return "";
    }
  };

  const readRestartTabForName = (name) => {
    const targetName = normalizeText(name);
    if (!targetName || disposed) {
      return "";
    }
    try {
      const raw = windowObject.sessionStorage.getItem(restartTabStorageKey);
      const state = raw ? JSON.parse(raw) : null;
      if (normalizeText(state?.name) !== targetName) {
        return "";
      }
      return normalizeText(state?.tabId);
    } catch (error) {
      return "";
    }
  };

  const clearRestartTabForReload = () => {
    try {
      windowObject.sessionStorage.removeItem(restartTabStorageKey);
      return true;
    } catch (error) {
      return false;
    }
  };

  const rememberRestartTabForReload = (name, tabId) => {
    const targetName = normalizeText(name);
    const targetTabId = normalizeText(tabId);
    if (!targetName || !targetTabId || disposed) {
      return false;
    }
    try {
      windowObject.sessionStorage.setItem(restartTabStorageKey, JSON.stringify({ name: targetName, tabId: targetTabId }));
    } catch (error) {
    }
    try {
      windowObject.localStorage.setItem(lastTabStorageKey(targetName), targetTabId);
    } catch (error) {
    }
    try {
      updateLocationName(targetName, { replace: true, tabId: targetTabId });
    } catch (error) {
    }
    return true;
  };

  const withLocationUpdateSuppressed = (callback) => {
    const previous = suppressLocationUpdate;
    suppressLocationUpdate = true;
    try {
      return callback();
    } finally {
      suppressLocationUpdate = previous;
    }
  };

  const commitHomeNavigation = () => {
    suppressWorkspaceRestore = true;
    clearWorkspaceRestoreState();
  };

  const rollbackHomeNavigation = () => {
    suppressWorkspaceRestore = false;
    rememberWorkspaceRestoreState();
  };

  const persistActiveWorkspaceTab = (tabId) => {
    if (disposed) {
      return Promise.resolve(false);
    }
    const requestName = normalizeText(getActiveName());
    const generation = getActiveGeneration();
    const targetTabId = normalizeText(tabId);
    const chainKey = `${generation}:${requestName}`;
    const previous = activeTabPersistenceChains.get(chainKey) || Promise.resolve();
    let pending = null;
    pending = previous.catch(() => {}).then(() => {
      if (
        disposed
        || !isCurrentRequest(requestName, generation)
        || normalizeText(getActiveTabId()) !== targetTabId
        || !hasTab(targetTabId)
      ) {
        return false;
      }
      return postWorkspaceAction("activate_tab", {
        tab_id: targetTabId,
        recent_tab_ids: getRecentTabIds(),
      }, {
        focus: false,
        preferStateActiveTab: false,
        applyResponse: false,
      });
    }).finally(() => {
      if (activeTabPersistenceChains.get(chainKey) === pending) {
        activeTabPersistenceChains.delete(chainKey);
      }
    });
    activeTabPersistenceChains.set(chainKey, pending);
    return pending;
  };

  const dispose = () => {
    if (disposed) {
      return false;
    }
    disposed = true;
    activeTabPersistenceChains.clear();
    return true;
  };

  return Object.freeze({
    clearRestartTabForReload,
    clearWorkspaceRestoreState,
    commitHomeNavigation,
    dispose,
    isDisposed: () => disposed,
    persistActiveWorkspaceTab,
    readLastActiveTab,
    readRestartTabForName,
    rememberActiveTab,
    rememberRestartTabForReload,
    rememberWorkspaceRestoreState,
    rollbackHomeNavigation,
    updateLocationName,
    withLocationUpdateSuppressed,
    workspaceLocationURL,
  });
}
