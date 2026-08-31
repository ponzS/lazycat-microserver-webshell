export function createDevicesLifecycle({ elements = {}, handlers = {} } = {}) {
  const listeners = [];
  let started = false;
  let disposed = false;

  const listen = (target, type, listener, options) => {
    if (!target?.addEventListener || typeof listener !== "function") {
      return;
    }
    target.addEventListener(type, listener, options);
    listeners.push([target, type, listener, options]);
  };

  return {
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
      listen(elements.heartbeatToggle, "change", handlers.onHeartbeatChange);
      listen(elements.onlineDevicesButton, "click", handlers.onOpenPanel);
      listen(elements.close, "click", handlers.onClosePanel);
      listen(elements.back, "click", handlers.onClosePanel);
      listen(elements.backdrop, "click", (event) => {
        if (event.target === elements.backdrop) {
          handlers.onClosePanel?.();
        }
      });
    },
  };
}
