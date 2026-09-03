const startupMetricLabels = Object.freeze({
  navigationStartedAt: "页面开始",
  moduleStartedAt: "诊断模块启动",
  ghosttyReadyAt: "Ghostty 就绪",
  themeReadyAt: "主题就绪",
  settingsReadyAt: "设置就绪",
  instancesReadyAt: "实例列表就绪",
  workspaceRequestStartedAt: "工作区请求开始",
  workspaceReadyAt: "工作区数据就绪",
  workspaceAppliedAt: "工作区应用完成",
});

const terminalEventLabels = Object.freeze({
  connect_session_start: "逻辑层 socket 会话开始",
  socket_connect: "逻辑层 socket 连接开始",
  socket_open: "逻辑层 socket 已打开",
  physical_websocket_create_start: "物理 WebSocket 创建开始",
  physical_websocket_open: "物理 WebSocket 已打开",
  logical_subscriptions_sent: "逻辑层订阅已发送",
  physical_server_agent_prepare_start: "物理通道服务端 Agent 准备开始",
  physical_server_ready: "物理通道服务端已就绪",
  logical_attach_start: "服务端逻辑 attach 开始",
  agent_preparing: "Agent 准备",
  agent_attach_ready: "Agent attach 准备完成",
  history_replay_start: "历史回放开始",
  first_binary_output: "首个终端数据",
  history_replay_complete: "历史回放接收完成",
  replay_output_drained: "回放输出排空",
  resize_applied: "终端尺寸应用",
  presentation_render_start: "终端渲染开始",
  full_render_start: "完整渲染开始",
  presentation_ready_state: "Presentation 就绪状态",
  render_blocked: "渲染被阻塞",
  full_render_request: "完整渲染请求",
  full_render_complete: "完整渲染完成",
  presentation_commit_complete: "终端渲染完成",
});

const initializationDetailKeys = new Set([
  "ready", "reason", "channel", "channelGeneration", "connectionEpoch",
  "physicalConnectionID", "physicalReadyState", "physicalOpenLatencyMs", "logicalStreamID", "logicalCount",
  "subscriptionRevision", "serverUnixMs", "serverPrepareDurationMs",
  "agentProtocolVersion", "preferredAgentProtocolVersion",
  "agentProtocolUpdateAvailable", "agentProtocolUpdateRequired",
  "serverAgentEnsureDurationMs", "serverAgentValidationDurationMs",
  "queueSubscriptionReceivedUnixMs", "queueWaitDurationMs", "processStartDurationMs",
  "subscriptionIndex", "subscriptionCount", "agentAttachStartedUnixMs",
  "agentWorkspaceReadyDurationMs", "agentPaneResolveDurationMs",
  "agentHistorySnapshotDurationMs", "agentAttachPrepareDurationMs",
  "connectionChannel", "connectionChannelGeneration", "attachGeneration",
  "historyGeneration", "resizeEpoch", "requestedResizeEpoch", "appliedResizeEpoch",
  "cols", "rows", "pixelWidth", "pixelHeight", "hostCssWidth", "hostCssHeight",
  "windowDevicePixelRatio", "rendererDevicePixelRatio", "serverCols", "serverRows",
  "requestedCols", "requestedRows", "requestedPixelWidth", "requestedPixelHeight",
  "documentHidden", "activeTab", "paneVisible", "measurable", "canvasMatches",
  "activationFitPending", "resizeFenceActive", "resizeAckPending",
  "resizeOutputSettleActive", "resizeEpochSupported", "requestedResizeEpoch",
  "appliedResizeEpoch", "presentedResizeEpoch", "pendingResizeEpoch",
  "pendingRenderFitGeneration", "pendingRenderReplayGeneration",
  "presentationHold", "presentationCommitPending",
  "fullRenderPending", "hasPresentedFrame", "renderReady", "retryPending",
  "retryAttempts", "retryReason", "renderGeneration", "measuredFitGeneration",
  "presentedFitGeneration", "terminalContentGeneration", "presentedContentGeneration",
  "presentedReplayGeneration", "terminalReplayGeneration", "receivedCursor",
  "appliedCursor", "presentedCursor", "receivedHistoryCursor", "appliedHistoryCursor",
  "presentedHistoryCursor", "targetCursor", "syncMode", "serverBaseCursor", "serverEndCursor",
  "deltaFromCursor", "deltaToCursor", "serverHistoryBytes", "serverHistoryChunks",
  "serverReplayFrames", "serverReplayStartedUnixMs", "serverReplayFinishedUnixMs",
  "serverReplayDurationMs", "replayDurationMs", "binaryMessages", "binaryBytes",
  "outputQueueBytes", "replayPhase", "stableReady", "presentationCommitted",
  "serverReplayDurationScope",
  "flushedBytes", "flushedEntries", "durationMs", "bytes", "terminalFrameHeld",
  "resizePresentationHold", "liveCanvas", "holdCanvas",
]);

const canvasDetailKeys = new Set([
  "width", "height", "cssWidth", "cssHeight", "styleWidth", "styleHeight", "hidden",
]);

const normalizeInitializationDetailValue = (key, value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const allowedKeys = key === "liveCanvas" || key === "holdCanvas"
      ? canvasDetailKeys
      : initializationDetailKeys;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([childKey]) => allowedKeys.has(childKey))
        .map(([childKey, childValue]) => [childKey, normalizeInitializationDetailValue(childKey, childValue)]),
    );
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "string") {
    return value.length > 160 ? `${value.slice(0, 157)}...` : value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "boolean" || value === null) {
    return value;
  }
  return String(value ?? "");
};

const normalizeInitializationDetails = (details = {}) => {
  if (!details || typeof details !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(details)
      .filter(([key]) => initializationDetailKeys.has(key))
      .map(([key, value]) => [key, normalizeInitializationDetailValue(key, value)]),
  );
};

const startupEventSource = (name) => {
  const text = String(name || "");
  return text.startsWith("终端")
    || text.startsWith("逻辑层 socket")
    || text.startsWith("逻辑层订阅")
    || text.startsWith("物理 WebSocket")
    || text.startsWith("物理通道")
    || text.startsWith("真实终端")
    || text.startsWith("PTY ")
    || text.startsWith("agent ")
    ? "终端初始化"
    : "页面初始化";
};
const defaultNow = () => (
  globalThis.performance && typeof globalThis.performance.now === "function"
    ? globalThis.performance.now()
    : Date.now()
);

const finiteTime = (value) => {
  const time = Number(value);
  return Number.isFinite(time) && time > 0 ? time : 0;
};

const formatEventName = (name) => terminalEventLabels[name] || startupMetricLabels[name] || String(name || "初始化事件");

export function createInitializationPerformance({
  startupDiagnostics = null,
  now = defaultNow,
  onChange = () => {},
} = {}) {
  let enabled = false;
  let disposed = false;
  let completed = false;
  let sessionID = "";
  let startupEvents = [];
  let terminalEvents = [];
  let terminalEventsBySession = new Map();
  let result = null;

  const emit = () => {
    onChange(snapshot());
  };

  const buildResult = (finishedAt) => {
    const metrics = startupDiagnostics?.snapshot?.() || {};
    const metricEvents = Object.entries(startupMetricLabels)
      .map(([name]) => ({
        name,
        label: formatEventName(name),
        source: "页面初始化",
        at: finiteTime(metrics[name]),
      }))
      .filter((event) => event.at > 0);
    const eventMap = new Map();
    for (const event of [...metricEvents, ...startupEvents, ...terminalEvents]) {
      const key = `${event.source}:${event.name}:${event.at}`;
      if (!eventMap.has(key)) {
        eventMap.set(key, event);
      }
    }
    const events = [...eventMap.values()].sort((left, right) => left.at - right.at);
    const navigationStartedAt = finiteTime(metrics.navigationStartedAt) || events[0]?.at || finishedAt;
    const rows = [];
    let previousAt = navigationStartedAt;
    for (const event of events) {
      if (event.at < navigationStartedAt) {
        continue;
      }
      rows.push({
        name: event.name,
        label: event.label,
        source: event.source,
        durationMs: Math.max(0, event.at - previousAt),
        elapsedMs: Math.max(0, event.at - navigationStartedAt),
        details: event.details ? { ...event.details } : {},
      });
      previousAt = event.at;
    }
    const totalAt = Math.max(finishedAt, terminalEvents.at(-1)?.at || finishedAt);
    return {
      status: "complete",
      sessionID,
      rows,
      totalMs: Math.max(0, totalAt - navigationStartedAt),
      startedAt: navigationStartedAt,
      finishedAt: totalAt,
    };
  };

  const snapshot = () => {
    if (result) {
      return { enabled, ...result, rows: result.rows.map((row) => ({ ...row })) };
    }
    return {
      enabled,
      status: enabled ? "collecting" : "idle",
      sessionID,
      rows: [],
      totalMs: 0,
      startedAt: finiteTime(startupDiagnostics?.getMetric?.("navigationStartedAt")),
      finishedAt: 0,
    };
  };

  const recordTerminalEvent = (session, name, details = {}) => {
    if (!enabled || disposed || completed || !session) {
      return;
    }
    const id = String(session.id || session.name || "");
    if (!id) {
      return;
    }
    const at = finiteTime(now());
    if (!at) {
      return;
    }
    const events = terminalEventsBySession.get(id) || [];
    terminalEventsBySession.set(id, events);
    events.push({
      name: String(name || "terminal_event"),
      label: formatEventName(name),
      source: "终端初始化",
      at,
      details: normalizeInitializationDetails(details),
    });
    if (name === "presentation_commit_complete") {
      sessionID = id;
      terminalEvents = events;
      completed = true;
      result = buildResult(at);
    }
    emit();
  };

  return {
    dispose() {
      disposed = true;
      enabled = false;
      terminalEvents = [];
      startupEvents = [];
      sessionID = "";
      result = null;
    },
    isEnabled() {
      return enabled;
    },
    recordStartupEvent(name, diagnosticDetails = {}) {
      if (!enabled || disposed || completed) {
        return;
      }
      const at = finiteTime(now());
      if (!at) {
        return;
      }
      startupEvents.push({
        name: String(name || "startup_event"),
        label: formatEventName(name),
        source: startupEventSource(name),
        at,
        details: normalizeInitializationDetails(diagnosticDetails),
      });
      emit();
    },
    recordTerminalEvent,
    setEnabled(nextEnabled) {
      if (disposed) {
        return;
      }
      enabled = nextEnabled === true;
      emit();
    },
    snapshot,
  };
}
