const DEFAULT_TOAST_DURATION_MS = 2200;

/** Owns transient toast and startup-error panel DOM state for the app shell. */
export function createAppFeedbackController({
  windowObject = globalThis.window,
  toast = null,
  startupErrorPanel = null,
  startupErrorText = null,
  toastDurationMs = DEFAULT_TOAST_DURATION_MS,
} = {}) {
  let disposed = false;
  let toastTimer = 0;

  const showToast = (message) => {
    if (disposed || !toast) {
      return false;
    }
    toast.textContent = message;
    toast.hidden = false;
    if (toastTimer) {
      windowObject?.clearTimeout?.(toastTimer);
    }
    toastTimer = windowObject?.setTimeout?.(() => {
      toastTimer = 0;
      if (!disposed) {
        toast.hidden = true;
      }
    }, toastDurationMs) || 0;
    return true;
  };

  const showStartupError = (message) => {
    if (disposed) {
      return false;
    }
    const text = String(message || "").trim();
    if (!startupErrorPanel || !startupErrorText || !text) {
      return false;
    }
    startupErrorText.textContent = text;
    startupErrorPanel.hidden = false;
    return true;
  };

  const hideStartupError = () => {
    if (disposed) {
      return false;
    }
    if (startupErrorPanel) {
      startupErrorPanel.hidden = true;
    }
    if (startupErrorText) {
      startupErrorText.textContent = "";
    }
    return true;
  };

  const dispose = () => {
    if (disposed) {
      return false;
    }
    disposed = true;
    if (toastTimer) {
      windowObject?.clearTimeout?.(toastTimer);
      toastTimer = 0;
    }
    return true;
  };

  return Object.freeze({
    dispose,
    hideStartupError,
    isDisposed: () => disposed,
    showStartupError,
    showToast,
  });
}
