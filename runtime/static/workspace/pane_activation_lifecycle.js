export function createWorkspacePaneActivationLifecycle({
  windowObject = globalThis.window,
} = {}) {
  const frames = new Set();
  let disposed = false;

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

  const dispose = () => {
    if (disposed) {
      return false;
    }
    disposed = true;
    for (const frame of frames) {
      windowObject.cancelAnimationFrame(frame);
    }
    frames.clear();
    return true;
  };

  return Object.freeze({
    dispose,
    isDisposed: () => disposed,
    scheduleFrame,
  });
}
