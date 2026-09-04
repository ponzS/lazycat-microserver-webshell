export function createDiagnosticsLifecycle({ elements = {}, handlers = {} } = {}) {
  const listeners = [];
  let started = false;
  let disposed = false;

  const listen = (target, type, listener) => {
    if (!target?.addEventListener || typeof listener !== "function") {
      return;
    }
    target.addEventListener(type, listener);
    listeners.push([target, type, listener]);
  };

  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const [target, type, listener] of listeners.splice(0)) {
        target.removeEventListener?.(type, listener);
      }
    },
    start() {
      if (started || disposed) {
        return;
      }
      started = true;
      listen(elements.settingsDebugModeToggle, "change", handlers.onDebugModeChange);
      listen(elements.settingsDebugLogToggle, "change", handlers.onDebugLogChange);
      listen(elements.settingsNetworkMonitorToggle, "change", handlers.onNetworkMonitorChange);
      listen(elements.settingsPerformanceMeterToggle, "change", handlers.onPerformanceMeterChange);
      listen(elements.settingsPerformanceTasksToggle, "change", handlers.onPerformanceTasksChange);
      listen(elements.settingsInitializationPerformanceToggle, "change", handlers.onInitializationPerformanceChange);
      listen(elements.initializationPerformanceCopy, "click", handlers.onInitializationPerformanceCopy);
      listen(elements.debugLogCopy, "click", handlers.onDebugLogCopy);
      listen(elements.debugLogClear, "click", handlers.onDebugLogClear);
    },
  };
}

export function createInitializationPerformanceLifecycle({
  windowObject = globalThis.window,
  intervalMs = 250,
  onTick = () => {},
} = {}) {
  let active = false;
  let disposed = false;
  let timer = 0;
  const stop = () => {
    if (timer) {
      windowObject?.clearInterval?.(timer);
      timer = 0;
    }
  };
  const start = () => {
    if (!active || disposed || timer || typeof windowObject?.setInterval !== "function") {
      return false;
    }
    timer = windowObject.setInterval(() => {
      if (!active || disposed) {
        stop();
        return;
      }
      onTick();
    }, Math.max(50, Number(intervalMs) || 250)) || 0;
    return Boolean(timer);
  };
  return Object.freeze({
    dispose() {
      if (disposed) {
        return false;
      }
      disposed = true;
      active = false;
      stop();
      return true;
    },
    setActive(nextActive) {
      active = nextActive === true && !disposed;
      if (active) {
        start();
      } else {
        stop();
      }
      return active;
    },
    snapshot: () => Object.freeze({ active, running: Boolean(timer) }),
  });
}

const defaultModuleLoader = () => import("./network_monitor.js");

export function createNetworkMonitorLifecycle({
  windowObject = globalThis.window,
  sampleMs = 1000,
  moduleLoader = defaultModuleLoader,
  getContext = () => ({}),
  onRender = () => {},
  onError = () => {},
} = {}) {
  let active = false;
  let disposed = false;
  let monitor = null;
  let modulePromise = null;
  let sampleTimer = 0;
  let startGeneration = 0;

  const context = () => {
    const value = getContext?.() || {};
    return {
      layout: value.layout === "direct" ? "direct" : "unified",
      sockets: Array.isArray(value.sockets) ? value.sockets : [],
      online: value.online !== false,
      retrying: value.retrying === true,
    };
  };

  const render = (state = monitor?.snapshot?.()) => {
    onRender(state || null, context());
  };

  const stop = () => {
    startGeneration += 1;
    if (sampleTimer) {
      windowObject?.clearInterval?.(sampleTimer);
      sampleTimer = 0;
    }
    monitor?.dispose?.();
    monitor = null;
    render(null);
  };

  const syncSockets = ({ reset = false } = {}) => {
    if (!monitor) {
      render(null);
      return;
    }
    const snapshot = context();
    if (reset) {
      monitor.detachAll();
    }
    monitor.setLayout(snapshot.layout);
    for (const attachment of snapshot.sockets) {
      if (!attachment?.socket) {
        continue;
      }
      monitor.attachSocket(attachment.socket, {
        kind: attachment.kind === "unified" ? "unified" : "fast",
        slot: attachment.slot,
      });
    }
    render();
  };

  const start = async () => {
    if (!active || disposed) {
      stop();
      return;
    }
    if (monitor) {
      syncSockets();
      return;
    }
    const generation = ++startGeneration;
    render(null);
    modulePromise ||= moduleLoader();
    try {
      const module = await modulePromise;
      if (generation !== startGeneration || !active || disposed) {
        return;
      }
      monitor = module.createTerminalNetworkMonitor({
        layout: context().layout,
        onStateChange: (state) => render(state),
      });
      syncSockets();
      sampleTimer = windowObject?.setInterval?.(() => {
        if (!active || disposed) {
          stop();
          return;
        }
        monitor?.sample?.();
      }, Math.max(100, Number(sampleMs) || 1000)) || 0;
    } catch (error) {
      if (generation === startGeneration && !disposed) {
        modulePromise = null;
        onError(error);
      }
    }
  };

  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      active = false;
      stop();
    },
    refresh() {
      render();
    },
    setActive(nextActive) {
      active = nextActive === true && !disposed;
      if (active) {
        start();
      } else {
        stop();
      }
    },
    syncSockets,
  };
}
