export const createFullscreenTuiTouchGesture = ({ moveThresholdPx = 8 } = {}) => {
  let state = null;

  const snapshot = () => state ? { ...state } : { phase: "idle", identifier: -1 };
  const reset = () => {
    state = null;
  };

  return {
    snapshot,
    start({ identifier, clientX, clientY }) {
      state = {
        phase: "pending",
        identifier,
        startX: clientX,
        startY: clientY,
        lastX: clientX,
        lastY: clientY,
        wheelRemainderY: 0,
      };
      return snapshot();
    },
    move({ identifier, clientX, clientY }) {
      if (!state || state.identifier !== identifier) {
        return snapshot();
      }
      const previousY = state.lastY;
      state.lastX = clientX;
      state.lastY = clientY;
      if (
        state.phase === "pending"
        && Math.hypot(clientX - state.startX, clientY - state.startY) >= moveThresholdPx
      ) {
        state.phase = "scrolling";
      }
      if (state.phase === "scrolling") {
        state.wheelRemainderY += previousY - clientY;
      }
      return snapshot();
    },
    beginSelection() {
      if (!state || state.phase !== "pending") {
        return false;
      }
      state.phase = "selecting";
      return true;
    },
    takeWheelSteps(rowHeight, maxSteps = 10) {
      if (!state || state.phase !== "scrolling") {
        return 0;
      }
      const height = Math.max(1, Number(rowHeight) || 1);
      const rawSteps = state.wheelRemainderY / height;
      const wholeSteps = rawSteps > 0 ? Math.floor(rawSteps) : Math.ceil(rawSteps);
      if (!wholeSteps) {
        return 0;
      }
      const steps = Math.sign(wholeSteps) * Math.min(Math.abs(wholeSteps), Math.max(1, maxSteps));
      state.wheelRemainderY -= steps * height;
      return steps;
    },
    finish(identifier) {
      if (!state || state.identifier !== identifier) {
        return "idle";
      }
      const outcome = state.phase === "pending" ? "tap" : state.phase;
      reset();
      return outcome;
    },
    cancel() {
      const active = Boolean(state);
      reset();
      return active ? "cancelled" : "idle";
    },
  };
};

export const resolveFullscreenTuiTouchCompletion = (outcome, { keyboardClaimed = false } = {}) => {
  if (outcome === "tap" && keyboardClaimed) {
    return "keyboard";
  }
  return outcome;
};
