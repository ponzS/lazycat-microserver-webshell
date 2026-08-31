const defaultNow = () => Date.now();

export function createDebugLog({
  windowObject = globalThis.window,
  consoleObject = globalThis.console,
  maxEntries = 200,
  dedupeWindowMs = 5000,
  now = defaultNow,
  onChange = () => {},
} = {}) {
  let entries = [];
  const lastSeen = new Map();
  let captureEnabled = false;
  let visible = false;
  let disposed = false;
  let consoleCaptureCleanup = null;
  let windowCaptureActive = false;

  const emit = () => {
    if (!disposed) {
      onChange(entries.map((entry) => ({ ...entry })));
    }
  };

  const formatValue = (value) => {
    if (value instanceof Error) {
      return value.message || value.name || "Error";
    }
    if (typeof value === "string") {
      return value;
    }
    try {
      return JSON.stringify(value, (key, item) => (
        /token|authorization|cookie|credential|password/i.test(key) ? "[redacted]" : item
      ));
    } catch (error) {
      return String(value);
    }
  };

  const append = (level, message, details = "", { dedupeKey = "", retainWhenDisabled = false } = {}) => {
    if ((!captureEnabled || !visible) && !retainWhenDisabled) {
      return;
    }
    const normalized = String(message || "").trim();
    if (!normalized) {
      return;
    }
    const suffix = String(details || "").trim();
    const timestamp = now();
    if (dedupeKey) {
      const previous = lastSeen.get(dedupeKey);
      if (previous && timestamp - previous.lastAt < dedupeWindowMs) {
        const entry = entries[previous.index];
        if (entry) {
          entry.count = Number(entry.count || 1) + 1;
          entry.time = new Date().toLocaleTimeString([], { hour12: false });
          if (suffix) {
            entry.message = `${normalized} (${suffix})`;
          }
          previous.lastAt = timestamp;
          if (visible && (entry.count === 2 || entry.count % 10 === 0)) {
            emit();
          }
        }
        return;
      }
    }
    const entry = {
      level: ["error", "warn", "info"].includes(level) ? level : "info",
      time: new Date().toLocaleTimeString([], { hour12: false }),
      message: suffix ? `${normalized} (${suffix})` : normalized,
      count: 1,
    };
    entries.push(entry);
    if (dedupeKey) {
      lastSeen.set(dedupeKey, { index: entries.length - 1, lastAt: timestamp });
    }
    const safeMaxEntries = Math.max(1, Number(maxEntries) || 200);
    if (entries.length > safeMaxEntries) {
      const removed = entries.length - safeMaxEntries;
      entries.splice(0, removed);
      for (const [key, value] of lastSeen) {
        const index = value.index - removed;
        if (index < 0) {
          lastSeen.delete(key);
        } else {
          value.index = index;
        }
      }
    }
    if (visible) {
      emit();
    }
  };

  const handleWindowError = (event) => {
    const targetTag = String(event?.target?.tagName || "").toUpperCase();
    const targetURL = targetTag === "SCRIPT"
      ? event.target?.src
      : targetTag === "LINK"
        ? event.target?.href
        : "";
    const location = event?.filename
      ? `${event.filename}:${event.lineno || 0}:${event.colno || 0}`
      : targetURL;
    append("error", "页面运行错误", [event?.message || event?.error?.message || "资源加载失败", location].filter(Boolean).join(" - "));
  };

  const handleUnhandledRejection = (event) => {
    append("error", "未处理的异步错误", formatValue(event?.reason));
  };

  const installConsoleCapture = () => {
    const captures = [];
    for (const [method, level] of [["warn", "warn"], ["error", "error"]]) {
      const original = consoleObject?.[method];
      if (typeof original !== "function") {
        continue;
      }
      const capture = (...args) => {
        original.apply(consoleObject, args);
        const message = args.map(formatValue).filter(Boolean).join(" ").slice(0, 2000);
        const dedupeKey = `console:${level}:${typeof args[0] === "string" ? args[0] : message.slice(0, 160)}`;
        append(level, message, "", { dedupeKey });
      };
      consoleObject[method] = capture;
      captures.push({ method, original, capture });
    }
    return () => {
      for (const { method, original, capture } of captures) {
        if (consoleObject[method] === capture) {
          consoleObject[method] = original;
        }
      }
    };
  };

  const syncCapture = () => {
    if (captureEnabled && !disposed) {
      if (!consoleCaptureCleanup) {
        consoleCaptureCleanup = installConsoleCapture();
      }
      if (!windowCaptureActive) {
        windowObject?.addEventListener?.("error", handleWindowError, true);
        windowObject?.addEventListener?.("unhandledrejection", handleUnhandledRejection);
        windowCaptureActive = true;
      }
      return;
    }
    consoleCaptureCleanup?.();
    consoleCaptureCleanup = null;
    if (windowCaptureActive) {
      windowObject?.removeEventListener?.("error", handleWindowError, true);
      windowObject?.removeEventListener?.("unhandledrejection", handleUnhandledRejection);
      windowCaptureActive = false;
    }
  };

  return {
    append,
    clear() {
      entries = [];
      lastSeen.clear();
      emit();
    },
    clipboardText() {
      return entries
        .map((entry) => `[${entry.time}] ${String(entry.level || "info").toUpperCase()}${entry.count > 1 ? ` x${entry.count}` : ""} ${entry.message}`)
        .join("\n");
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      captureEnabled = false;
      visible = false;
      syncCapture();
    },
    formatValue,
    isEnabled() {
      return captureEnabled;
    },
    setState({ capture = false, show = false } = {}) {
      captureEnabled = capture === true;
      visible = show === true;
      syncCapture();
      emit();
    },
    snapshot() {
      return entries.map((entry) => ({ ...entry }));
    },
  };
}
