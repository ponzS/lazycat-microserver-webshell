const noop = () => {};

const defaultIsElement = (value) => Boolean(
  value && typeof value.clientWidth === "number" && typeof value.clientHeight === "number",
);

/**
 * Owns terminal font-metric refresh stabilization and display-size helpers.
 * Rendering, resize and session state remain injected owners.
 */
export function createTerminalMetricsController({
  windowObject = globalThis.window,
  getTabs = () => [],
  getCurrentTab = () => null,
  getTerminalArea = () => null,
  getScrollback = () => 0,
  getDefaultFontFamily = () => "",
  setFontFamily = noop,
  setFontSize = noop,
  setScrollback = noop,
  onScrollbackChange = noop,
  isMobileLayout = () => false,
  resizeActiveTabForCurrentDevice = noop,
  getRenderer = () => null,
  getPresentation = () => null,
  getResize = () => null,
  isElement = defaultIsElement,
  registerSessionCleanup = noop,
  consoleObject = globalThis.console,
} = {}) {
  let disposed = false;
  const scheduled = new Map();
  const cleanupRegistered = new WeakSet();

  const clearSessionTimers = (session) => {
    const entries = scheduled.get(session);
    if (!entries) {
      return false;
    }
    for (const entry of entries) {
      if (entry.kind === "raf") {
        windowObject?.cancelAnimationFrame?.(entry.id);
      } else {
        windowObject?.clearTimeout?.(entry.id);
      }
    }
    scheduled.delete(session);
    return true;
  };

  const rememberTimer = (session, kind, id, generation) => {
    const entries = scheduled.get(session) || new Set();
    const entry = { kind, id, generation };
    entries.add(entry);
    scheduled.set(session, entries);
    return entry;
  };

  const forgetTimer = (session, entry) => {
    const entries = scheduled.get(session);
    if (!entries) {
      return;
    }
    entries.delete(entry);
    if (!entries.size) {
      scheduled.delete(session);
    }
  };

  const registerCleanup = (session) => {
    if (!session || cleanupRegistered.has(session)) {
      return;
    }
    cleanupRegistered.add(session);
    registerSessionCleanup(session, () => {
      clearSessionTimers(session);
      session.fontMetricsGeneration = Number(session.fontMetricsGeneration || 0) + 1;
    });
  };

  const forEachSession = (callback) => {
    for (const tab of getTabs() || []) {
      for (const session of tab?.panes?.values?.() || []) {
        callback(session);
      }
    }
  };

  const applyScrollback = (value = getScrollback()) => {
    if (disposed) {
      return false;
    }
    const scrollback = Number(value);
    if (!Number.isFinite(scrollback) || scrollback < 0) {
      return false;
    }
    forEachSession((session) => {
      if (session?.term?.options) {
        session.term.options.scrollback = scrollback;
      }
    });
    return true;
  };

  const applyFontFamily = (value) => {
    if (disposed) {
      return false;
    }
    const fontFamily = value || getDefaultFontFamily();
    setFontFamily(fontFamily);
    forEachSession((session) => {
      if (!session?.term?.options) {
        return;
      }
      // Ghostty rebuilds the live backing store synchronously when the font
      // option changes. Capture the last known-good frame before that setter
      // runs so the presentation hold never contains the new, partial grid.
      if (session.term.options.fontFamily !== fontFamily) {
        getPresentation()?.beginHold?.(session);
      }
      session.term.options.fontFamily = fontFamily;
      refresh(session, { deferFitRetry: true });
    });
    return true;
  };

  const applyFontSize = (value) => {
    if (disposed) {
      return false;
    }
    setFontSize(value);
    forEachSession((session) => {
      if (!session?.term?.options) {
        return;
      }
      // See applyFontFamily: the option setter resizes the renderer inline.
      if (session.term.options.fontSize !== value) {
        getPresentation()?.beginHold?.(session);
      }
      session.term.options.fontSize = value;
      refresh(session, { deferFitRetry: true, claimSize: true });
    });
    return true;
  };

  const applyScrollbackChange = (previousValue, nextValue) => {
    if (disposed) {
      return false;
    }
    setScrollback(nextValue);
    if (previousValue !== nextValue) {
      onScrollbackChange(previousValue, nextValue);
    }
    return applyScrollback(nextValue);
  };

  const applyMobilePixelScroll = (enabled) => {
    if (disposed) {
      return false;
    }
    forEachSession((session) => {
      if (session?.term?.options) {
        session.term.options.mobilePixelScroll = enabled && isMobileLayout();
      }
    });
    resizeActiveTabForCurrentDevice();
    return true;
  };

  const refresh = (session, { deferFitRetry = false, claimSize = false } = {}) => {
    if (disposed || !session?.term) {
      return false;
    }
    registerCleanup(session);
    clearSessionTimers(session);
    // Keep direct refresh callers (font loading and appearance updates) on
    // the same transaction boundary. beginHold is idempotent while a hold is
    // already active, so font setters above do not recapture the new canvas.
    getPresentation()?.beginHold?.(session);
    const metricsGeneration = Number(session.fontMetricsGeneration || 0) + 1;
    session.fontMetricsGeneration = metricsGeneration;
    const refreshNow = (forceSizeSync = false) => {
      if (
        disposed
        || session.closed
        || Number(session.fontMetricsGeneration || 0) !== metricsGeneration
      ) {
        return false;
      }
      try {
        const renderer = getRenderer();
        renderer?.installBaseline?.(session);
        if (session.term.renderer && typeof session.term.renderer.measureFont === "function") {
          session.term.renderer.metrics = session.term.renderer.measureFont();
        }
        getPresentation()?.cancelPendingRender?.(session.term);
        const fit = getResize()?.resizePane?.(session, {
          settlePresentation: true,
          forceFullRender: true,
          hideUntilRender: true,
          forceSizeSync,
          claimSize,
        });
        const presentation = getPresentation?.();
        const presentationCurrent = typeof presentation?.isCurrent === "function"
          ? presentation.isCurrent(session)
          : undefined;
        const settled = fit?.ok === true
          && !fit.pending
          && (presentationCurrent === true
            || (presentationCurrent === undefined
              && !session.fullRenderPending
              && !session.resizeAckPending
              && !session.resizePresentationHold));
        return { ok: true, settled };
      } catch (error) {
        consoleObject?.warn?.("[terminal-font] failed to refresh terminal metrics", error);
        return { ok: false, settled: false };
      }
    };

    refreshNow(false);
    if (deferFitRetry) {
      const schedule = (kind, delay, forceSizeSync, continuation) => {
        const callback = () => {
          forgetTimer(session, entry);
          const result = refreshNow(forceSizeSync);
          continuation?.(result);
        };
        const entry = kind === "raf"
          ? rememberTimer(session, kind, windowObject?.requestAnimationFrame?.(callback), metricsGeneration)
          : rememberTimer(session, kind, windowObject?.setTimeout?.(callback, delay), metricsGeneration);
        if (entry.id === undefined || entry.id === null) {
          forgetTimer(session, entry);
        }
      };
      const retries = [
        { kind: "timeout", delay: 80, forceSizeSync: true },
        { kind: "timeout", delay: 240, forceSizeSync: true },
      ];
      const scheduleNext = (index, result) => {
        if (result?.settled || index >= retries.length) {
          return;
        }
        const next = retries[index];
        schedule(next.kind, next.delay, next.forceSizeSync, (nextResult) => {
          scheduleNext(index + 1, nextResult);
        });
      };
      schedule("raf", 0, true, (result) => scheduleNext(0, result));
    }
    return true;
  };

  const estimatedSizeForElement = (element) => {
    if (disposed || !isElement(element)) {
      return null;
    }
    const metrics = getRenderer()?.estimatedFontMetrics?.();
    if (!metrics?.width || !metrics?.height) {
      return null;
    }
    const style = windowObject?.getComputedStyle?.(element);
    const paddingLeft = Number.parseInt(style?.getPropertyValue?.("padding-left"), 10) || 0;
    const paddingRight = Number.parseInt(style?.getPropertyValue?.("padding-right"), 10) || 0;
    const paddingTop = Number.parseInt(style?.getPropertyValue?.("padding-top"), 10) || 0;
    const paddingBottom = Number.parseInt(style?.getPropertyValue?.("padding-bottom"), 10) || 0;
    const width = Math.max(0, Number(element.clientWidth || 0) - paddingLeft - paddingRight);
    const height = Math.max(0, Number(element.clientHeight || 0) - paddingTop - paddingBottom);
    if (!width || !height) {
      return null;
    }
    return {
      cols: Math.max(2, Math.floor(width / metrics.width)),
      rows: Math.max(1, Math.floor(height / metrics.height)),
    };
  };

  const sizeQuery = () => {
    if (disposed) {
      return null;
    }
    const tab = getCurrentTab();
    const pane = tab?.panes?.get?.(tab.activePaneId);
    const cols = Number(pane?.term?.cols) || 0;
    const rows = Number(pane?.term?.rows) || 0;
    if (cols > 0 && rows > 0) {
      return { cols, rows };
    }
    return estimatedSizeForElement(getTerminalArea()) || { cols: 120, rows: 32 };
  };

  const dispose = () => {
    if (disposed) {
      return false;
    }
    disposed = true;
    for (const session of scheduled.keys()) {
      clearSessionTimers(session);
    }
    scheduled.clear();
    return true;
  };

  return Object.freeze({
    applyFontFamily,
    applyFontSize,
    applyMobilePixelScroll,
    applyScrollback,
    applyScrollbackChange,
    dispose,
    estimatedSizeForElement,
    isDisposed: () => disposed,
    refresh,
    sizeQuery,
  });
}
