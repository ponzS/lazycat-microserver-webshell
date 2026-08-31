export function createTerminalInteractionLifecycle({
  documentObject = globalThis.document,
  windowObject = globalThis.window,
  elements = {},
  handlers = {},
} = {}) {
  const listeners = [];
  let started = false;
  let disposed = false;

  const listen = (target, type, listener, options) => {
    if (disposed || !target?.addEventListener || typeof listener !== "function") {
      return () => {};
    }
    target.addEventListener(type, listener, options);
    const entry = [target, type, listener, options];
    listeners.push(entry);
    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      const index = listeners.indexOf(entry);
      if (index >= 0) {
        listeners.splice(index, 1);
      }
      target.removeEventListener?.(type, listener, options);
    };
  };

  const combine = (...cleanups) => {
    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      for (const cleanup of cleanups) {
        cleanup?.();
      }
    };
  };

  return Object.freeze({
    bindPane(target, paneHandlers = {}) {
      return combine(
        listen(target, "contextmenu", paneHandlers.onCapture, { capture: true }),
        listen(target, "contextmenu", paneHandlers.onContextMenu),
      );
    },
    bindTab(target, listener) {
      return listen(target, "contextmenu", listener);
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const [target, type, listener, options] of listeners.splice(0)) {
        target.removeEventListener?.(type, listener, options);
      }
    },
    start() {
      if (started || disposed) {
        return;
      }
      started = true;
      listen(elements.mobileScrim, "click", handlers.onMobileClose);
      listen(elements.mobileHandle, "click", handlers.onMobileClose);
      listen(elements.mobileGrid, "click", handlers.onMobileAction);
      listen(elements.desktopMenu, "click", handlers.onDesktopAction);
      listen(documentObject, "pointerdown", handlers.onDocumentPointerDown);
      listen(documentObject, "keydown", handlers.onDocumentKeydown, { capture: true });
      listen(windowObject, "resize", handlers.onResize);
    },
  });
}
