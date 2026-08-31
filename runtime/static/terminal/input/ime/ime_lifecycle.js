const noop = () => {};

export function createTerminalIMELifecycle({ windowObject = globalThis.window } = {}) {
  let disposed = false;
  const resources = new Map();

  const stateFor = (session) => {
    let state = resources.get(session);
    if (!state) {
      state = { listeners: [], timers: new Set(), frames: new Set() };
      resources.set(session, state);
    }
    return state;
  };

  const isBound = (session) => !disposed && resources.has(session) && !session?.closed;

  const listen = (session, target, type, callback, options) => {
    if (disposed || !session || typeof target?.addEventListener !== "function") {
      return noop;
    }
    const state = stateFor(session);
    const wrapped = (event) => {
      if (isBound(session)) {
        callback(event);
      }
    };
    target.addEventListener(type, wrapped, options);
    state.listeners.push({ target, type, callback: wrapped, options });
    return () => target.removeEventListener(type, wrapped, options);
  };

  const timeout = (session, callback, delay = 0) => {
    if (disposed || !session) {
      return 0;
    }
    const state = stateFor(session);
    const handle = windowObject.setTimeout(() => {
      state.timers.delete(handle);
      if (isBound(session)) {
        callback();
      }
    }, delay);
    state.timers.add(handle);
    return handle;
  };

  const frame = (session, callback) => {
    if (disposed || !session) {
      return 0;
    }
    const state = stateFor(session);
    const handle = windowObject.requestAnimationFrame(() => {
      state.frames.delete(handle);
      if (isBound(session)) {
        callback();
      }
    });
    state.frames.add(handle);
    return handle;
  };

  const disposeSession = (session) => {
    const state = resources.get(session);
    if (!state) {
      return false;
    }
    resources.delete(session);
    for (const listener of state.listeners) {
      listener.target.removeEventListener(listener.type, listener.callback, listener.options);
    }
    for (const handle of state.timers) {
      windowObject.clearTimeout(handle);
    }
    for (const handle of state.frames) {
      windowObject.cancelAnimationFrame(handle);
    }
    return true;
  };

  return Object.freeze({
    bind(session) {
      if (disposed || !session) {
        return false;
      }
      stateFor(session);
      return true;
    },
    isBound,
    listen,
    timeout,
    frame,
    sessions: () => Array.from(resources.keys()),
    disposeSession,
    dispose() {
      if (disposed) {
        return false;
      }
      disposed = true;
      for (const session of Array.from(resources.keys())) {
        disposeSession(session);
      }
      return true;
    },
  });
}
