const defaultNow = () => (
  globalThis.performance && typeof globalThis.performance.now === "function"
    ? globalThis.performance.now()
    : Date.now()
);

const normalizeResizeEpoch = (value) => {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) && text !== "0" ? text : "";
};

const normalizeRuntimeDetail = (key, value) => {
  if (/token|authorization|cookie|credential|password|secret|payload|command|text|data/i.test(String(key || ""))) {
    return "[redacted]";
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  return String(value ?? "");
};

const normalizeRuntimeDetails = (details = {}) => {
  if (!details || typeof details !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [key, normalizeRuntimeDetail(key, value)]),
  );
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
  getRuntimeContext = () => ({}),
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
    const runtimeContext = getRuntimeContext?.() || {};
    const event = {
      at: Math.round(now()),
      startupElapsedMs: Number(session.startupTraceStartedAt || 0) > 0
        ? Math.max(0, Math.round(now() - Number(session.startupTraceStartedAt)))
        : 0,
      type: String(type || "unknown"),
      resumeGeneration: Number(runtimeContext.resumeGeneration || 0),
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

export function createTerminalRuntimeTimeline({
  now = defaultNow,
  maxEntries = 192,
  appendLog = () => {},
  isLogEnabled = () => false,
} = {}) {
  const events = [];

  const record = (type, details = {}) => {
    const normalizedType = String(type || "unknown").trim() || "unknown";
    const event = {
      at: Math.round(now()),
      type: normalizedType,
      ...normalizeRuntimeDetails(details),
    };
    events.push(event);
    const limit = Math.max(1, Number(maxEntries) || 192);
    if (events.length > limit) {
      events.splice(0, events.length - limit);
    }
    if (isLogEnabled()) {
      appendLog(
        "info",
        `运行时事件 ${normalizedType}`,
        JSON.stringify(event),
        { dedupeKey: `runtime-event:${normalizedType}` },
      );
    }
    return event;
  };

  return {
    record,
    snapshot() {
      return events.map((event) => ({ ...event }));
    },
  };
}
