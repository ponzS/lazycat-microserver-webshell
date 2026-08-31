const noop = () => {};

/**
 * Owns page-level listeners and the small amount of runtime bookkeeping that
 * must survive independently from feature controllers. Domain behavior is
 * supplied as callbacks so this module never reaches into terminal state.
 */
export function createAppLifecycle({
  windowObject = globalThis.window,
  documentObject = globalThis.document,
  visualViewport = windowObject?.visualViewport,
  fonts = documentObject?.fonts,
  heartbeatIntervalMs = 5 * 1000,
  handlers = {},
} = {}) {
  let started = false;
  let disposed = false;
  let generation = 0;
  let heartbeatTimer = 0;
  const listeners = [];

  const listen = (target, type, listener, options) => {
    if (!target?.addEventListener || typeof listener !== "function") {
      return;
    }
    target.addEventListener(type, listener, options);
    listeners.push([target, type, listener, options]);
  };

  const invoke = (name, ...args) => {
    if (disposed) {
      return undefined;
    }
    return handlers[name]?.(...args);
  };

  const start = () => {
    if (started || disposed) {
      return false;
    }
    started = true;

    listen(documentObject, "pointerdown", handlers.onRecoverUserGesture, {
      capture: true,
      passive: true,
    });
    listen(documentObject, "touchstart", handlers.onRecoverUserGesture, {
      capture: true,
      passive: true,
    });
    listen(documentObject, "pointerdown", handlers.onPointerDown, {
      capture: true,
      passive: true,
    });
    listen(documentObject, "keydown", handlers.onModalKeydown, true);
    listen(documentObject, "keydown", handlers.onGlobalKeydown, true);
    listen(windowObject, "resize", handlers.onResize);
    listen(visualViewport, "resize", handlers.onVisualViewportChange);
    listen(visualViewport, "scroll", handlers.onVisualViewportChange);
    listen(windowObject, "online", handlers.onOnline);
    listen(windowObject, "offline", handlers.onOffline);
    listen(documentObject, "visibilitychange", handlers.onVisibilityChange);
    listen(windowObject, "focus", handlers.onFocus);
    listen(windowObject, "pageshow", handlers.onPageShow);
    listen(windowObject, "pagehide", handlers.onPageHide);
    listen(windowObject, "beforeunload", handlers.onBeforeUnload);
    listen(documentObject, "pointerdown", handlers.onStoragePersistenceGesture, {
      capture: true,
      once: true,
    });

    const startGeneration = generation;
    if (fonts?.ready && typeof fonts.ready.then === "function") {
      Promise.resolve(fonts.ready).then(() => {
        if (!disposed && generation === startGeneration) {
          invoke("onFontsReady");
        }
      }).catch(() => {});
    }
    if (heartbeatIntervalMs > 0 && typeof windowObject?.setInterval === "function") {
      heartbeatTimer = windowObject.setInterval(() => invoke("onHeartbeat"), heartbeatIntervalMs);
    }
    invoke("onStart");
    return true;
  };

  const dispose = () => {
    if (disposed) {
      return false;
    }
    disposed = true;
    generation += 1;
    for (const [target, type, listener, options] of listeners.splice(0)) {
      target.removeEventListener?.(type, listener, options);
    }
    if (heartbeatTimer) {
      windowObject?.clearInterval?.(heartbeatTimer);
      heartbeatTimer = 0;
    }
    handlers.onDispose?.();
    return true;
  };

  return Object.freeze({
    dispose,
    isDisposed: () => disposed,
    isStarted: () => started,
    start,
  });
}

export const appLifecycleNoop = noop;
