const defaultNow = () => (
  globalThis.performance && typeof globalThis.performance.now === "function"
    ? globalThis.performance.now()
    : Date.now()
);

const metricNames = Object.freeze([
  "navigationStartedAt",
  "moduleStartedAt",
  "ghosttyReadyAt",
  "themeReadyAt",
  "settingsReadyAt",
  "instancesReadyAt",
  "workspaceRequestStartedAt",
  "workspaceReadyAt",
  "workspaceAppliedAt",
]);

export function createStartupDiagnostics({ now = defaultNow, pendingLimit = 64 } = {}) {
  const metrics = Object.fromEntries(metricNames.map((name) => [name, 0]));
  metrics.moduleStartedAt = now();
  const pending = [];
  let traceSink = null;

  const mark = (key) => {
    if (Object.prototype.hasOwnProperty.call(metrics, key) && !metrics[key]) {
      metrics[key] = now();
    }
    return metrics[key] || 0;
  };

  const trace = (event, details = "", options = {}) => {
    const entry = {
      event: String(event || "").trim(),
      details: String(details || "").trim(),
      options: options && typeof options === "object" ? { ...options } : {},
    };
    if (!entry.event) {
      return;
    }
    if (typeof traceSink === "function") {
      traceSink(entry.event, entry.details, entry.options);
      return;
    }
    pending.push(entry);
    if (pending.length > Math.max(1, Number(pendingLimit) || 64)) {
      pending.shift();
    }
  };

  const setTraceSink = (nextSink) => {
    traceSink = typeof nextSink === "function" ? nextSink : null;
    if (traceSink) {
      for (const entry of pending.splice(0)) {
        traceSink(entry.event, entry.details, entry.options);
      }
    }
    const installedSink = traceSink;
    return () => {
      if (traceSink === installedSink) {
        traceSink = null;
      }
    };
  };

  return {
    getMetric(key) {
      return Number(metrics[key]) || 0;
    },
    mark,
    now,
    setTraceSink,
    snapshot() {
      return { ...metrics };
    },
    trace,
  };
}
