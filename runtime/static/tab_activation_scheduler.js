export const createTabActivationScheduler = ({
  requestFrame = (callback) => window.requestAnimationFrame(callback),
  cancelFrame = (handle) => window.cancelAnimationFrame(handle),
  setTimer = (callback, delay) => window.setTimeout(callback, delay),
  clearTimer = (handle) => window.clearTimeout(handle),
} = {}) => {
  let generation = 0;
  let activeTabID = "";
  let frame = 0;
  let timer = 0;
  let disposed = false;

  const clearPending = () => {
    if (frame) {
      cancelFrame(frame);
      frame = 0;
    }
    if (timer) {
      clearTimer(timer);
      timer = 0;
    }
  };

  const isCurrent = (expectedGeneration, expectedTabID) => (
    !disposed
    && generation === expectedGeneration
    && activeTabID === expectedTabID
  );

  const scheduleStep = (expectedGeneration, expectedTabID, steps, index) => {
    frame = requestFrame(() => {
      frame = 0;
      timer = setTimer(() => {
        timer = 0;
        if (!isCurrent(expectedGeneration, expectedTabID)) {
          return;
        }
        steps[index]({
          generation: expectedGeneration,
          tabID: expectedTabID,
          isCurrent: () => isCurrent(expectedGeneration, expectedTabID),
        });
        if (isCurrent(expectedGeneration, expectedTabID) && index + 1 < steps.length) {
          scheduleStep(expectedGeneration, expectedTabID, steps, index + 1);
        }
      }, 0);
    });
  };

  const schedule = (tabID, steps = []) => {
    if (disposed) {
      return 0;
    }
    clearPending();
    generation += 1;
    activeTabID = String(tabID || "").trim();
    const normalizedSteps = Array.isArray(steps)
      ? steps.filter((step) => typeof step === "function")
      : [];
    if (activeTabID && normalizedSteps.length > 0) {
      scheduleStep(generation, activeTabID, normalizedSteps, 0);
    }
    return generation;
  };

  const cancel = () => {
    clearPending();
    generation += 1;
    activeTabID = "";
  };

  const dispose = () => {
    cancel();
    disposed = true;
  };

  return {
    schedule,
    cancel,
    dispose,
    isCurrent,
    snapshot: () => ({
      generation,
      activeTabID,
      pending: Boolean(frame || timer),
      disposed,
    }),
  };
};
