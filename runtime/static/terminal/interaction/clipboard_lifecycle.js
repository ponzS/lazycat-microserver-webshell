export function createTerminalClipboardLifecycle({ documentObject = globalThis.document } = {}) {
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
        cleanup();
      }
    };
  };

  return Object.freeze({
    bindDesktopSession(shell, handlers = {}) {
      if (!started || disposed) {
        return () => {};
      }
      return combine(
        listen(shell, "mousedown", handlers.onMouseDown, { capture: true }),
        listen(shell, "auxclick", handlers.onAuxClick),
        listen(documentObject, "mousemove", handlers.onMouseMove),
        listen(documentObject, "mouseup", handlers.onMouseUp),
      );
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
    },
  });
}
