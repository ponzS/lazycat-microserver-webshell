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
  recordEvent = noop,
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
      const inheritedLiveGeometry = Boolean(
        getResize()?.isLiveGeometryActive?.(session)
        && getResize()?.beginMetricsLiveGeometry?.(session),
      );
      // Ghostty rebuilds the live backing store synchronously when the font
      // option changes. Capture the last known-good frame before that setter
      // runs so the presentation hold never contains the new, partial grid.
      if (session.term.options.fontFamily !== fontFamily && !inheritedLiveGeometry) {
        getPresentation()?.beginHold?.(session);
      }
      session.term.options.fontFamily = fontFamily;
      refresh(session, {
        deferFitRetry: true,
        liveGeometry: inheritedLiveGeometry,
      });
    });
    return true;
  };

  const visualDetails = (session) => {
    const host = session?.terminalHost;
    const live = session?.term?.canvas || session?.term?.renderer?.getCanvas?.();
    const hold = session?.terminalFrameHold;
    const rect = (element) => {
      const value = element?.getBoundingClientRect?.();
      return {
        width: Number(value?.width || 0),
        height: Number(value?.height || 0),
        left: Number(value?.left || 0),
        top: Number(value?.top || 0),
      };
    };
    const describeCanvas = (canvas) => ({
      css: rect(canvas),
      backing: { width: Number(canvas?.width || 0), height: Number(canvas?.height || 0) },
      style: { width: String(canvas?.style?.width || ""), height: String(canvas?.style?.height || "") },
      hidden: canvas?.hidden === true,
    });
    return {
      fontSize: Number(session?.term?.options?.fontSize || session?.term?.renderer?.fontSize || 0),
      rendererFontSize: Number(session?.term?.renderer?.fontSize || 0),
      windowDevicePixelRatio: Number(windowObject?.devicePixelRatio || 1),
      rendererDevicePixelRatio: Number(session?.term?.renderer?.devicePixelRatio || 0),
      visualViewport: {
        width: Number(windowObject?.visualViewport?.width || 0),
        height: Number(windowObject?.visualViewport?.height || 0),
        scale: Number(windowObject?.visualViewport?.scale || 0),
        offsetLeft: Number(windowObject?.visualViewport?.offsetLeft || 0),
        offsetTop: Number(windowObject?.visualViewport?.offsetTop || 0),
      },
      cols: Number(session?.term?.cols || 0),
      rows: Number(session?.term?.rows || 0),
      server: {
        cols: Number(session?.serverCols || 0),
        rows: Number(session?.serverRows || 0),
        pixelWidth: Number(session?.serverPixelWidth || 0),
        pixelHeight: Number(session?.serverPixelHeight || 0),
      },
      requested: {
        cols: Number(session?.requestedCols || 0),
        rows: Number(session?.requestedRows || 0),
        pixelWidth: Number(session?.requestedPixelWidth || 0),
        pixelHeight: Number(session?.requestedPixelHeight || 0),
      },
      resizeEpochs: {
        requested: String(session?.requestedResizeEpoch || ""),
        applied: String(session?.appliedResizeEpoch || ""),
        presented: String(session?.presentedResizeEpoch || ""),
      },
      host: rect(host),
      live: describeCanvas(live),
      hold: describeCanvas(hold),
      renderReady: session?.renderReady === true,
      hasPresentedFrame: session?.hasPresentedFrame === true,
      terminalFrameHeld: session?.terminalFrameHeld === true,
      resizePresentationHold: session?.resizePresentationHold === true,
      resizeAckPending: session?.resizeAckPending === true,
      resizeFenceActive: session?.resizeFenceActive === true,
      resizeOutputSettleActive: session?.resizeOutputSettleActive === true,
      fontMetricsGeneration: Number(session?.fontMetricsGeneration || 0),
      measuredFitGeneration: Number(session?.measuredFitGeneration || 0),
      presentedFitGeneration: Number(session?.presentedFitGeneration || 0),
      renderGeneration: Number(session?.renderGeneration || 0),
    };
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
      const previousFontSize = Number(session.term.options.fontSize || session.term.renderer?.fontSize || 0);
      const changed = previousFontSize !== Number(value);
      const liveGeometry = changed
        && getResize()?.beginMetricsLiveGeometry?.(session) === true;
      if (changed) {
        session.fontSizeChangeDebug = { requestedFontSize: Number(value) || 0 };
        recordEvent(session, "font_size_change_start", {
          requestedFontSize: Number(value) || 0,
          previousFontSize,
          ...visualDetails(session),
        });
        if (!liveGeometry) {
          getPresentation()?.beginHold?.(session, { recapture: true });
        }
      }
      session.term.options.fontSize = value;
      if (changed) {
        recordEvent(session, "font_size_change_after_setter", {
          requestedFontSize: Number(value) || 0,
          ...visualDetails(session),
        });
      }
      const refreshed = refresh(session, {
        deferFitRetry: true,
        claimSize: true,
        liveGeometry,
      });
      if (changed) {
        recordEvent(session, "font_size_change_refresh_scheduled", {
          requestedFontSize: Number(value) || 0,
          refreshResult: refreshed,
          ...visualDetails(session),
        });
      }
    });
    return true;
  };

  const applyLineHeight = (value, previousValue) => {
    if (disposed) {
      return false;
    }
    forEachSession((session) => {
      if (!session?.term) {
        return;
      }
      const liveGeometry = getResize()?.beginMetricsLiveGeometry?.(session) === true;
      recordEvent(session, "line_height_change_start", {
        lineHeightPercent: Number(value) || 0,
        previousLineHeightPercent: Number(previousValue) || 0,
        liveGeometry,
        ...visualDetails(session),
      });
      const refreshed = refresh(session, {
        deferFitRetry: true,
        claimSize: true,
        liveGeometry,
      });
      recordEvent(session, "line_height_change_refresh_scheduled", {
        lineHeightPercent: Number(value) || 0,
        refreshResult: refreshed,
        liveGeometry,
        ...visualDetails(session),
      });
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

  const refresh = (session, {
    deferFitRetry = false,
    claimSize = false,
    liveGeometry = false,
  } = {}) => {
    if (disposed || !session?.term) {
      return false;
    }
    const resize = getResize();
    const useLiveGeometry = liveGeometry || Boolean(
      resize?.isLiveGeometryActive?.(session)
      && resize?.beginMetricsLiveGeometry?.(session),
    );
    registerCleanup(session);
    clearSessionTimers(session);
    // Font-family loading and appearance refreshes stay atomic. Explicit
    // font-size/line-height changes instead keep the current live Canvas
    // visible and delegate geometry ownership to the resize controller.
    if (!useLiveGeometry) {
      getPresentation()?.beginHold?.(session);
    }
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
        const fit = useLiveGeometry
          ? resize?.updateMetricsLiveGeometry?.(session, { force: forceSizeSync })
          : resize?.resizePane?.(session, {
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
        if (session.fontSizeChangeDebug) {
          recordEvent(session, "font_size_change_fit", {
            requestedFontSize: session.fontSizeChangeDebug.requestedFontSize,
            forceSizeSync,
            settled,
            fit: fit ? {
              ok: fit.ok === true,
              pending: fit.pending === true,
              cols: Number(fit.cols || 0),
              rows: Number(fit.rows || 0),
              sizeChanged: fit.sizeChanged === true,
              canvasChanged: fit.canvasChanged === true,
            } : null,
            ...visualDetails(session),
          });
          if (settled) {
            session.fontSizeChangeDebug = null;
          }
        }
        return { ok: true, settled };
      } catch (error) {
        consoleObject?.warn?.("[terminal-font] failed to refresh terminal metrics", error);
        return { ok: false, settled: false };
      }
    };

    const completeLiveGeometry = () => {
      if (useLiveGeometry) {
        resize?.endMetricsLiveGeometry?.(session);
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
          completeLiveGeometry();
          return;
        }
        const next = retries[index];
        schedule(next.kind, next.delay, next.forceSizeSync, (nextResult) => {
          scheduleNext(index + 1, nextResult);
        });
      };
      schedule("raf", 0, true, (result) => scheduleNext(0, result));
    } else {
      completeLiveGeometry();
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
    applyLineHeight,
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
