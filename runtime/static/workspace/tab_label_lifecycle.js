/**
 * Owns transient resources used by the inline tab label editor.
 * The tab label controller owns editor state; this helper owns abort and
 * animation-frame cleanup so stale callbacks cannot outlive the module.
 */
export function createWorkspaceTabLabelLifecycle({
  windowObject = globalThis.window,
  AbortControllerCtor = globalThis.AbortController,
} = {}) {
  let disposed = false;
  const controllers = new Set();
  const frames = new Set();

  const createController = () => {
    if (disposed || typeof AbortControllerCtor !== "function") {
      return null;
    }
    const controller = new AbortControllerCtor();
    controllers.add(controller);
    return controller;
  };

  const abortController = (controller) => {
    if (!controller) {
      return false;
    }
    controllers.delete(controller);
    try {
      controller.abort();
    } catch (error) {
    }
    return true;
  };

  const scheduleFrame = (callback) => {
    if (disposed || typeof callback !== "function") {
      return 0;
    }
    let completed = false;
    const run = () => {
      completed = true;
      frames.delete(frameID);
      if (!disposed) {
        callback();
      }
    };
    let frameID = 0;
    if (typeof windowObject?.requestAnimationFrame === "function") {
      frameID = windowObject.requestAnimationFrame(run);
    } else if (typeof windowObject?.setTimeout === "function") {
      frameID = windowObject.setTimeout(run, 0);
    }
    if (frameID && !completed) {
      frames.add(frameID);
    }
    return frameID;
  };

  const cancelFrame = (frameID) => {
    if (!frameID) {
      return false;
    }
    if (typeof windowObject?.cancelAnimationFrame === "function") {
      windowObject.cancelAnimationFrame(frameID);
    } else {
      windowObject?.clearTimeout?.(frameID);
    }
    frames.delete(frameID);
    return true;
  };

  const dispose = () => {
    if (disposed) {
      return false;
    }
    disposed = true;
    for (const controller of controllers) {
      try {
        controller.abort();
      } catch (error) {
      }
    }
    controllers.clear();
    for (const frameID of frames) {
      if (typeof windowObject?.cancelAnimationFrame === "function") {
        windowObject.cancelAnimationFrame(frameID);
      } else {
        windowObject?.clearTimeout?.(frameID);
      }
    }
    frames.clear();
    return true;
  };

  return Object.freeze({
    abortController,
    cancelFrame,
    createController,
    dispose,
    isDisposed: () => disposed,
    scheduleFrame,
  });
}
