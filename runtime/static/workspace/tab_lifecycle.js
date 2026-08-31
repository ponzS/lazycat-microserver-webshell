export function createWorkspaceTabLifecycle({
  windowObject = globalThis.window,
} = {}) {
  const tabs = new Set();
  const frames = new Set();
  let disposed = false;

  const registerTab = (tab) => {
    if (disposed || !tab) {
      return false;
    }
    tabs.add(tab);
    return true;
  };

  const replaceContextCleanup = (tab, cleanup) => {
    if (!tab) {
      return false;
    }
    tab.contextMenuCleanup?.();
    tab.contextMenuCleanup = typeof cleanup === "function" ? cleanup : null;
    return true;
  };

  const scheduleFrame = (callback) => {
    if (disposed) {
      return 0;
    }
    let frame = 0;
    frame = windowObject.requestAnimationFrame(() => {
      frames.delete(frame);
      if (!disposed) {
        callback();
      }
    });
    frames.add(frame);
    return frame;
  };

  const disposeTab = (tab) => {
    if (!tab) {
      return false;
    }
    replaceContextCleanup(tab, null);
    tab.button?.remove?.();
    tab.paneEl?.remove?.();
    tabs.delete(tab);
    return true;
  };

  const dispose = () => {
    if (disposed) {
      return false;
    }
    disposed = true;
    for (const frame of frames) {
      windowObject.cancelAnimationFrame(frame);
    }
    frames.clear();
    for (const tab of [...tabs]) {
      disposeTab(tab);
    }
    tabs.clear();
    return true;
  };

  return Object.freeze({
    dispose,
    disposeTab,
    isDisposed: () => disposed,
    registerTab,
    replaceContextCleanup,
    scheduleFrame,
  });
}
