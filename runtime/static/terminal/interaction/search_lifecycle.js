export function createTerminalSearchLifecycle({
  windowObject = globalThis.window,
  elements = {},
  handlers = {},
} = {}) {
  const listeners = [];
  let focusTimer = 0;
  let started = false;
  let disposed = false;

  const listen = (target, type, listener, options) => {
    if (disposed || !target?.addEventListener || typeof listener !== "function") {
      return;
    }
    target.addEventListener(type, listener, options);
    listeners.push([target, type, listener, options]);
  };

  const clearFocusTimer = () => {
    if (!focusTimer) {
      return;
    }
    if (windowObject?.clearTimeout) {
      windowObject.clearTimeout(focusTimer);
    } else {
      globalThis.clearTimeout(focusTimer);
    }
    focusTimer = 0;
  };

  return Object.freeze({
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      clearFocusTimer();
      for (const [target, type, listener, options] of listeners.splice(0)) {
        target.removeEventListener?.(type, listener, options);
      }
    },
    focusInput(callback) {
      if (disposed || typeof callback !== "function") {
        return;
      }
      clearFocusTimer();
      const runFocus = () => {
        focusTimer = 0;
        if (!disposed) {
          callback();
        }
      };
      focusTimer = windowObject?.setTimeout
        ? windowObject.setTimeout(runFocus, 0)
        : globalThis.setTimeout(runFocus, 0);
    },
    start() {
      if (started || disposed) {
        return;
      }
      started = true;
      listen(elements.input, "input", handlers.onInput);
      listen(elements.input, "keydown", handlers.onInputKeydown);
      listen(elements.previous, "click", handlers.onPrevious);
      listen(elements.next, "click", handlers.onNext);
      listen(elements.close, "click", handlers.onClose);
    },
  });
}
