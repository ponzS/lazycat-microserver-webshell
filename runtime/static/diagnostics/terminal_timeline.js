const defaultNow = () => (
  globalThis.performance && typeof globalThis.performance.now === "function"
    ? globalThis.performance.now()
    : Date.now()
);

const normalizeResizeEpoch = (value) => {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) && text !== "0" ? text : "";
};

export const recordTerminalRuntimeMetric = (name, value = 1) => {
  const metrics = globalThis.__webshellTerminalPerformance;
  if (metrics && typeof metrics.record === "function") {
    metrics.record(name, value);
  }
};

export const recordTerminalRuntimeMaxMetric = (name, value = 0) => {
  const metrics = globalThis.__webshellTerminalPerformance;
  if (metrics && typeof metrics.max === "function") {
    metrics.max(name, value);
    return;
  }
  if (metrics?.counters && typeof metrics.counters === "object") {
    metrics.counters[name] = Math.max(Number(metrics.counters[name]) || 0, Number(value) || 0);
  }
};

export function createTerminalTimeline({
  now = defaultNow,
  maxEntries = 96,
  appendLog = () => {},
  isLogEnabled = () => false,
} = {}) {
  const timelines = new WeakMap();

  const record = (session, type, details = {}) => {
    if (!session || (typeof session !== "object" && typeof session !== "function")) {
      return;
    }
    const timeline = timelines.get(session) || [];
    if (!timelines.has(session)) {
      timelines.set(session, timeline);
    }
    const event = {
      at: Math.round(now()),
      type: String(type || "unknown"),
      channelGeneration: Number(session.connectionChannelGeneration || 0),
      attachGeneration: Number(session.terminalReplayGeneration || 0),
      historyGeneration: String(session.historyGeneration || ""),
      resizeEpoch: normalizeResizeEpoch(session.appliedResizeEpoch)
        || normalizeResizeEpoch(session.requestedResizeEpoch),
      receivedCursor: session.receivedHistoryCursor?.toString?.() || "",
      appliedCursor: session.appliedHistoryCursor?.toString?.() || "",
      presentedCursor: session.presentedHistoryCursor?.toString?.() || "",
      ...details,
    };
    timeline.push(event);
    const limit = Math.max(1, Number(maxEntries) || 96);
    if (timeline.length > limit) {
      timeline.splice(0, timeline.length - limit);
    }
    if (isLogEnabled()) {
      appendLog(
        "info",
        `终端事件 ${String(type || "unknown")}`,
        `${session.name}/${session.id} ${JSON.stringify(event)}`,
        { dedupeKey: `terminal-event:${session.id}:${String(type || "unknown")}` },
      );
    }
  };

  return {
    record,
    snapshot(session) {
      return (timelines.get(session) || []).map((event) => ({ ...event }));
    },
  };
}
