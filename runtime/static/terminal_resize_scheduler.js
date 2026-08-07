const normalizeResizeOptions = (options = {}) => ({
  visibleOnly: options.visibleOnly !== false,
  forceFullRender: options.forceFullRender === true,
  hideUntilRender: options.hideUntilRender === true,
  forceSizeSync: options.forceSizeSync === true,
});

const mergeResizeOptions = (current, next) => {
  const normalized = normalizeResizeOptions(next);
  if (!current) {
    return normalized;
  }
  return {
    visibleOnly: current.visibleOnly !== false && normalized.visibleOnly !== false,
    forceFullRender: current.forceFullRender || normalized.forceFullRender,
    hideUntilRender: current.hideUntilRender || normalized.hideUntilRender,
    forceSizeSync: current.forceSizeSync || normalized.forceSizeSync,
  };
};

export const createTerminalResizeScheduler = ({
  apply,
  throttleMs = 80,
  settleMs = 120,
  now = () => performance.now(),
  requestFrame = (callback) => window.requestAnimationFrame(callback),
  cancelFrame = (frame) => window.cancelAnimationFrame(frame),
  setTimer = (callback, delay) => window.setTimeout(callback, delay),
  clearTimer = (timer) => window.clearTimeout(timer),
} = {}) => {
  if (typeof apply !== "function") {
    throw new TypeError("Terminal resize scheduler requires an apply function.");
  }

  const states = new WeakMap();
  const safeThrottleMs = Math.max(0, Number(throttleMs) || 0);
  const safeSettleMs = Math.max(safeThrottleMs, Number(settleMs) || 0);

  const stateFor = (target) => {
    let state = states.get(target);
    if (!state) {
      state = {
        pendingOptions: null,
        settleOptions: null,
        frame: 0,
        timer: 0,
        lastAppliedAt: Number.NEGATIVE_INFINITY,
        applying: false,
      };
      states.set(target, state);
    }
    return state;
  };

  const clearScheduledHandles = (state) => {
    if (state.frame) {
      cancelFrame(state.frame);
      state.frame = 0;
    }
    if (state.timer) {
      clearTimer(state.timer);
      state.timer = 0;
    }
  };

  const run = (target, { settled = false } = {}) => {
    const state = states.get(target);
    if (!state || state.applying) {
      return false;
    }
    const options = settled && state.settleOptions
      ? mergeResizeOptions(state.settleOptions, state.pendingOptions || {})
      : state.pendingOptions;
    if (!options) {
      return false;
    }
    if (settled) {
      clearScheduledHandles(state);
    } else if (state.frame) {
      cancelFrame(state.frame);
      state.frame = 0;
    }
    state.pendingOptions = null;
    state.settleOptions = settled ? null : mergeResizeOptions(state.settleOptions, options);
    state.applying = true;
    state.lastAppliedAt = now();
    try {
      apply(target, options, { settled });
    } finally {
      state.applying = false;
    }
    if (state.pendingOptions) {
      schedule(target);
    }
    return true;
  };

  const schedule = (target, options = {}, { immediate = false } = {}) => {
    if (!target || (typeof target !== "object" && typeof target !== "function")) {
      return false;
    }
    const state = stateFor(target);
    state.pendingOptions = mergeResizeOptions(state.pendingOptions, options);
    if (immediate && !state.applying) {
      return run(target, { settled: true });
    }

    const elapsed = now() - state.lastAppliedAt;
    if (!state.applying && !state.frame && elapsed >= safeThrottleMs) {
      state.frame = requestFrame(() => {
        state.frame = 0;
        run(target, { settled: false });
      });
    }
    if (state.timer) {
      clearTimer(state.timer);
    }
    state.timer = setTimer(() => {
      state.timer = 0;
      run(target, { settled: true });
    }, safeSettleMs);
    return true;
  };

  const cancel = (target) => {
    const state = states.get(target);
    if (!state) {
      return;
    }
    clearScheduledHandles(state);
    state.pendingOptions = null;
    state.settleOptions = null;
    states.delete(target);
  };

  return {
    schedule,
    flush: (target) => run(target, { settled: true }),
    cancel,
  };
};
