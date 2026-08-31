import { createDevicesAPI } from "./devices_api.js";
import { createDevicesLifecycle } from "./devices_lifecycle.js";
import {
  currentDeviceInfo,
  deviceListContentSignature,
  normalizeDeviceEntries,
} from "./devices_model.js";
import { createDevicesView } from "./devices_view.js";

const isAbortError = (error) => error?.name === "AbortError";

export function createDevicesController({
  documentObject = globalThis.document,
  windowObject = globalThis.window,
  navigatorObject = windowObject?.navigator || globalThis.navigator,
  storage = windowObject?.localStorage,
  storagePrefix = "webshell",
  clientID = "",
  fetchImpl = globalThis.fetch?.bind(globalThis),
  baseURL = windowObject?.location?.href,
  BlobCtor = globalThis.Blob,
  AbortControllerCtor = globalThis.AbortController,
  api = createDevicesAPI({ fetchImpl, baseURL, navigatorObject, BlobCtor }),
  view = createDevicesView({ documentObject }),
  lifecycleFactory = createDevicesLifecycle,
  initialDebugMode = false,
  heartbeatIntervalMs = 1500,
  listRefreshIntervalMs = 500,
  heartbeatTimeoutMs = 5000,
  preparePanelOpen = () => {},
  focusTerminal = () => {},
  isMobileLayout = () => false,
  measureTask = (_name, task) => task(),
  appendError = () => {},
} = {}) {
  const heartbeatStorageKey = `${storagePrefix}.deviceHeartbeat`;
  const readHeartbeatEnabled = () => {
    try {
      return storage?.getItem?.(heartbeatStorageKey) === "true";
    } catch (error) {
      return false;
    }
  };
  const writeHeartbeatEnabled = (enabled) => {
    try {
      storage?.setItem?.(heartbeatStorageKey, enabled ? "true" : "false");
    } catch (error) {
    }
  };

  let started = false;
  let disposed = false;
  let debugMode = initialDebugMode === true;
  let heartbeatEnabled = readHeartbeatEnabled();
  let heartbeatActive = false;
  let heartbeatTimer = 0;
  let heartbeatTimeoutTimer = 0;
  let heartbeatInFlight = null;
  let heartbeatAbortController = null;
  let heartbeatGeneration = 0;
  let heartbeatLastError = "";
  let panelOpen = false;
  let listEntries = [];
  let listLoaded = false;
  let listLoading = false;
  let listSignature = "";
  let listLastError = "";
  let listRefreshTimer = 0;
  let listRequestGeneration = 0;
  let listInFlight = null;
  let listAbortController = null;
  let focusGeneration = 0;
  let focusTimer = 0;

  const deviceInfo = () => currentDeviceInfo({ clientID, navigatorObject });
  const heartbeatAllowed = () => (
    started
    && !disposed
    && debugMode
    && heartbeatEnabled
    && navigatorObject?.onLine !== false
  );
  const listRequestIsCurrent = (generation) => (
    started
    && !disposed
    && debugMode
    && panelOpen
    && generation === listRequestGeneration
  );

  const clearFocusTimer = () => {
    focusGeneration += 1;
    if (focusTimer) {
      windowObject?.clearTimeout?.(focusTimer);
      focusTimer = 0;
    }
  };

  const scheduleFocus = (callback) => {
    clearFocusTimer();
    const generation = focusGeneration;
    focusTimer = windowObject?.setTimeout?.(() => {
      focusTimer = 0;
      if (!disposed && generation === focusGeneration) {
        callback?.();
      }
    }, 0) || 0;
  };

  const renderList = () => view.renderList?.({
    devices: listEntries,
    loaded: listLoaded,
    loading: listLoading,
  });

  const syncControls = () => view.syncControls?.({ debugMode, heartbeatEnabled });

  const logHeartbeatError = (error) => {
    const message = error?.message || String(error);
    if (message !== heartbeatLastError) {
      heartbeatLastError = message;
      appendError("设备心跳失败", message);
    }
  };

  const heartbeatNow = () => {
    if (!heartbeatAllowed()) {
      return Promise.resolve();
    }
    if (heartbeatInFlight) {
      return heartbeatInFlight;
    }
    const generation = heartbeatGeneration;
    const controller = typeof AbortControllerCtor === "function" ? new AbortControllerCtor() : null;
    let timedOut = false;
    heartbeatAbortController = controller;
    heartbeatTimeoutTimer = controller
      ? windowObject?.setTimeout?.(() => {
        heartbeatTimeoutTimer = 0;
        timedOut = true;
        controller.abort();
      }, heartbeatTimeoutMs) || 0
      : 0;
    let measured;
    try {
      measured = measureTask("device heartbeat", () => api.heartbeat(deviceInfo(), { signal: controller?.signal }));
    } catch (error) {
      measured = Promise.reject(error);
    }
    const task = Promise.resolve(measured)
      .then(() => {
        if (generation === heartbeatGeneration && !disposed) {
          heartbeatLastError = "";
        }
      })
      .catch((error) => {
        if (generation !== heartbeatGeneration || disposed || (isAbortError(error) && !timedOut)) {
          return;
        }
        const reportedError = timedOut ? new Error(`设备心跳超时 (${heartbeatTimeoutMs}ms)`) : error;
        logHeartbeatError(reportedError);
        throw reportedError;
      })
      .finally(() => {
        if (heartbeatInFlight !== task) {
          return;
        }
        if (heartbeatTimeoutTimer) {
          windowObject?.clearTimeout?.(heartbeatTimeoutTimer);
          heartbeatTimeoutTimer = 0;
        }
        heartbeatAbortController = null;
        heartbeatInFlight = null;
      });
    heartbeatInFlight = task;
    return task;
  };

  const queueHeartbeat = () => {
    heartbeatNow().catch(() => {});
  };

  const stopHeartbeat = () => {
    heartbeatGeneration += 1;
    if (heartbeatTimer) {
      windowObject?.clearInterval?.(heartbeatTimer);
      heartbeatTimer = 0;
    }
    if (heartbeatTimeoutTimer) {
      windowObject?.clearTimeout?.(heartbeatTimeoutTimer);
      heartbeatTimeoutTimer = 0;
    }
    heartbeatAbortController?.abort?.();
    heartbeatAbortController = null;
    heartbeatActive = false;
    heartbeatLastError = "";
  };

  const startHeartbeat = () => {
    if (!heartbeatAllowed()) {
      stopHeartbeat();
      return;
    }
    if (heartbeatActive && heartbeatTimer) {
      return;
    }
    heartbeatGeneration += 1;
    heartbeatActive = true;
    queueHeartbeat();
    heartbeatTimer = windowObject?.setInterval?.(queueHeartbeat, heartbeatIntervalMs) || 0;
  };

  const sendOfflineBeacon = () => {
    if (!heartbeatActive || navigatorObject?.onLine === false) {
      return false;
    }
    return api.sendOfflineBeacon({ client_id: String(clientID || "").trim() });
  };

  const invalidateListRequest = () => {
    listRequestGeneration += 1;
    listAbortController?.abort?.();
    listAbortController = null;
    listInFlight = null;
  };

  const refreshList = () => {
    if (!started || disposed || !debugMode || !panelOpen || !view.isAvailable?.()) {
      return Promise.resolve([]);
    }
    if (listInFlight) {
      return listInFlight;
    }
    const generation = ++listRequestGeneration;
    if (!listLoaded) {
      listLoading = true;
      renderList();
    }
    const controller = typeof AbortControllerCtor === "function" ? new AbortControllerCtor() : null;
    listAbortController = controller;
    let measured;
    try {
      measured = measureTask("device list refresh", () => api.list({ signal: controller?.signal }));
    } catch (error) {
      measured = Promise.reject(error);
    }
    const task = Promise.resolve(measured)
      .then((devices) => {
        const normalized = normalizeDeviceEntries(devices);
        if (!listRequestIsCurrent(generation)) {
          return normalized;
        }
        listEntries = normalized;
        listLoaded = true;
        listLoading = false;
        listLastError = "";
        view.setFeedback?.("");
        const nextSignature = deviceListContentSignature(normalized);
        if (nextSignature !== listSignature) {
          listSignature = nextSignature;
          renderList();
        }
        return normalized;
      })
      .catch((error) => {
        if (!listRequestIsCurrent(generation) || isAbortError(error)) {
          return [];
        }
        const message = error?.message || String(error);
        if (message !== listLastError) {
          listLastError = message;
          appendError("在线设备列表请求失败", message);
        }
        listLoading = false;
        listLoaded = true;
        if (!listSignature) {
          listEntries = [];
          renderList();
        }
        view.setFeedback?.(error?.message || "设备列表加载失败。", "error");
        throw error;
      })
      .finally(() => {
        if (listInFlight === task) {
          listAbortController = null;
          listInFlight = null;
        }
      });
    listInFlight = task;
    return task;
  };

  const stopListRefresh = () => {
    if (listRefreshTimer) {
      windowObject?.clearInterval?.(listRefreshTimer);
      listRefreshTimer = 0;
    }
  };

  const startListRefresh = () => {
    stopListRefresh();
    if (!started || disposed || !debugMode || !panelOpen) {
      return;
    }
    refreshList().catch(() => {});
    listRefreshTimer = windowObject?.setInterval?.(() => {
      refreshList().catch(() => {});
    }, listRefreshIntervalMs) || 0;
  };

  const closePanel = ({ focus = true } = {}) => {
    const wasOpen = panelOpen || view.isPanelOpen?.();
    clearFocusTimer();
    panelOpen = false;
    stopListRefresh();
    invalidateListRequest();
    view.closePanel?.();
    if (focus && wasOpen && !disposed) {
      scheduleFocus(focusTerminal);
    }
  };

  const openPanel = () => {
    if (!started || disposed || !debugMode || !view.isAvailable?.()) {
      return false;
    }
    preparePanelOpen();
    clearFocusTimer();
    invalidateListRequest();
    panelOpen = true;
    listEntries = [];
    listLoaded = false;
    listLoading = true;
    listSignature = "";
    listLastError = "";
    view.setFeedback?.("");
    renderList();
    view.openPanel?.();
    if (heartbeatEnabled) {
      queueHeartbeat();
    }
    startListRefresh();
    scheduleFocus(() => view.focusPanel?.({ mobile: isMobileLayout() }));
    return true;
  };

  const setHeartbeatEnabled = (enabled) => {
    heartbeatEnabled = enabled === true;
    writeHeartbeatEnabled(heartbeatEnabled);
    if (heartbeatAllowed()) {
      startHeartbeat();
    } else {
      sendOfflineBeacon();
      stopHeartbeat();
    }
    syncControls();
  };

  const lifecycle = lifecycleFactory({
    elements: view.elements,
    handlers: {
      onClosePanel: () => closePanel(),
      onHeartbeatChange: () => setHeartbeatEnabled(view.heartbeatEnabled?.()),
      onOpenPanel: () => openPanel(),
    },
  });

  return {
    closePanel,
    dispose() {
      if (disposed) {
        return;
      }
      sendOfflineBeacon();
      disposed = true;
      lifecycle.dispose();
      clearFocusTimer();
      closePanel({ focus: false });
      stopHeartbeat();
      view.dispose?.();
    },
    handleEscape(event) {
      if (!panelOpen || event?.key !== "Escape") {
        return false;
      }
      event.preventDefault?.();
      closePanel();
      return true;
    },
    handlePageHide() {
      return sendOfflineBeacon();
    },
    handleResize() {
      if (debugMode && panelOpen) {
        refreshList().catch(() => {});
      }
    },
    handleResume() {
      if (heartbeatAllowed()) {
        queueHeartbeat();
      }
      if (debugMode && panelOpen) {
        refreshList().catch(() => {});
      }
    },
    heartbeatNow,
    isPanelOpen() {
      return panelOpen;
    },
    openPanel,
    refreshList,
    setDebugMode(enabled) {
      debugMode = enabled === true;
      syncControls();
      if (!started) {
        return;
      }
      if (heartbeatAllowed()) {
        startHeartbeat();
      } else {
        sendOfflineBeacon();
        stopHeartbeat();
      }
      if (!debugMode) {
        closePanel();
      }
    },
    snapshot() {
      return {
        debugMode,
        disposed,
        heartbeat: {
          active: heartbeatActive,
          enabled: heartbeatEnabled,
          inFlight: Boolean(heartbeatInFlight),
        },
        list: {
          entries: listEntries.map((device) => ({ ...device })),
          loaded: listLoaded,
          loading: listLoading,
          signature: listSignature,
        },
        panelOpen,
        started,
      };
    },
    start() {
      if (started || disposed) {
        return;
      }
      started = true;
      lifecycle.start();
      syncControls();
      startHeartbeat();
    },
    syncControls,
  };
}
