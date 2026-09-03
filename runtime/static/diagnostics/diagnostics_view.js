const performanceTaskAlertThresholds = Object.freeze({
  count: 120,
  avgMs: 16,
  maxMs: 50,
  totalMs: 200,
});

const performanceTaskAlertThresholdsByName = Object.freeze({
  "device heartbeat": Object.freeze({
    count: 10,
    avgMs: 250,
    maxMs: 1000,
    totalMs: 2000,
  }),
});

const stateLabel = (state) => ({
  connecting: "连接中",
  open: "网络正常",
  closing: "正在重试",
  retrying: "正在重试",
  error: "网络异常",
  idle: "未启用",
})[state] || "未启用";

const formatMegabytes = (bytes) => (Math.max(0, Number(bytes) || 0) / 1_000_000).toFixed(3);

const formatTaskMs = (value) => {
  const ms = Number(value);
  if (!Number.isFinite(ms)) {
    return "--";
  }
  if (ms >= 100) {
    return `${Math.round(ms)}ms`;
  }
  if (ms >= 10) {
    return `${ms.toFixed(1)}ms`;
  }
  return `${ms.toFixed(2)}ms`;
};

const formatInitializationMs = (value) => {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms < 0) {
    return "--";
  }
  return ms >= 100 ? `${Math.round(ms)}ms` : `${ms.toFixed(1)}ms`;
};

const initializationStatusLabel = (status) => ({
  idle: "未启用",
  collecting: "采集中",
  complete: "已完成",
})[status] || "采集中";

export function createDiagnosticsView({ documentObject = globalThis.document } = {}) {
  const byID = (id) => documentObject?.getElementById?.(id) || null;
  const elements = {
    debugLogPanel: byID("debugLogPanel"),
    debugLogList: byID("debugLogList"),
    debugLogCopy: byID("debugLogCopy"),
    debugLogClear: byID("debugLogClear"),
    initializationPerformancePanel: byID("initializationPerformancePanel"),
    initializationPerformanceStatus: byID("initializationPerformanceStatus"),
    initializationPerformanceCopy: byID("initializationPerformanceCopy"),
    initializationPerformanceTotal: byID("initializationPerformanceTotal"),
    initializationPerformanceList: byID("initializationPerformanceList"),
    performanceTaskMeter: byID("performanceTaskMeter"),
    performanceTaskMeterList: byID("performanceTaskMeterList"),
    settingsDebugModeToggle: byID("settingsDebugModeToggle"),
    settingsDebugLogToggle: byID("settingsDebugLogToggle"),
    settingsNetworkMonitorToggle: byID("settingsNetworkMonitorToggle"),
    settingsDebugOptions: byID("settingsDebugOptions"),
    settingsInitializationPerformanceToggle: byID("settingsInitializationPerformanceToggle"),
    settingsPerformanceMeterToggle: byID("settingsPerformanceMeterToggle"),
    settingsPerformanceTasksToggle: byID("settingsPerformanceTasksToggle"),
    terminalNetworkMonitorPanel: byID("terminalNetworkMonitor"),
    terminalNetworkMonitorStatus: byID("terminalNetworkMonitorStatus"),
    terminalNetworkMonitorChannels: byID("terminalNetworkMonitorChannels"),
    terminalNetworkMonitorRate: byID("terminalNetworkMonitorRate"),
    terminalNetworkMonitorRateDetail: byID("terminalNetworkMonitorRateDetail"),
    terminalNetworkMonitorUsage: byID("terminalNetworkMonitorUsage"),
    terminalNetworkMonitorUsageDetail: byID("terminalNetworkMonitorUsageDetail"),
  };

  const appendTaskCell = (row, text, className = "performance-task-value", alert = false) => {
    const cell = documentObject.createElement("span");
    cell.className = className;
    if (alert) {
      cell.classList.add("is-alert");
    }
    cell.textContent = text;
    row.appendChild(cell);
  };

  const taskAlert = (name, field, value) => {
    const thresholds = performanceTaskAlertThresholdsByName[name] || performanceTaskAlertThresholds;
    return Number.isFinite(thresholds?.[field]) && Number(value) >= thresholds[field];
  };

  const emptyNetworkState = (layout) => ({
    status: "idle",
    channels: (layout === "direct" ? ["直连通道 1", "直连通道 2", "直连通道 3"] : [])
      .map((label, index) => ({
        index,
        label,
        state: "idle",
        receivedBytes: 0,
        sentBytes: 0,
        totalBytes: 0,
        receivedBytesPerSecond: 0,
        sentBytesPerSecond: 0,
        bytesPerSecond: 0,
      })),
    receivedBytes: 0,
    sentBytes: 0,
    totalBytes: 0,
    receivedBytesPerSecond: 0,
    sentBytesPerSecond: 0,
    bytesPerSecond: 0,
  });

  return {
    elements,
    renderDebugLog(entries, { visible = false } = {}) {
      if (!elements.debugLogPanel || !elements.debugLogList) {
        return;
      }
      elements.debugLogPanel.hidden = !visible;
      elements.debugLogList.textContent = "";
      for (const entry of entries || []) {
        const row = documentObject.createElement("div");
        row.className = `debug-log-entry debug-log-entry-${entry.level}`;
        const time = documentObject.createElement("time");
        time.className = "debug-log-entry-time";
        time.textContent = entry.time;
        row.append(time);
        if (entry.level === "error") {
          const level = documentObject.createElement("span");
          level.className = "debug-log-entry-level debug-log-entry-level-error";
          level.textContent = "错误";
          row.append(level);
        }
        if (entry.count > 1) {
          const count = documentObject.createElement("span");
          count.className = "debug-log-entry-count";
          count.textContent = `x${entry.count}`;
          row.append(count);
        }
        const message = documentObject.createElement("span");
        message.className = "debug-log-entry-message";
        message.textContent = entry.message;
        row.append(message);
        elements.debugLogList.appendChild(row);
      }
      elements.debugLogList.scrollTop = elements.debugLogList.scrollHeight;
    },
    renderNetworkMonitor(state, {
      visible = false,
      online = true,
      retrying = false,
      layout = "unified",
    } = {}) {
      if (!elements.terminalNetworkMonitorPanel) {
        return;
      }
      elements.terminalNetworkMonitorPanel.hidden = !visible;
      if (!visible) {
        return;
      }
      const snapshot = state || emptyNetworkState(layout);
      let status = online === false ? "error" : String(snapshot.status || "idle");
      if (status === "idle" && retrying) {
        status = "retrying";
      }
      if (elements.terminalNetworkMonitorStatus) {
        const label = stateLabel(status);
        elements.terminalNetworkMonitorStatus.dataset.state = status;
        elements.terminalNetworkMonitorStatus.setAttribute("aria-label", label);
        elements.terminalNetworkMonitorStatus.title = label;
      }
      if (elements.terminalNetworkMonitorChannels) {
        const channels = snapshot.channels || [];
        elements.terminalNetworkMonitorChannels.hidden = channels.length === 0;
        elements.terminalNetworkMonitorChannels.textContent = "";
        for (const channel of channels) {
          const row = documentObject.createElement("div");
          row.className = "terminal-network-monitor-channel";
          const name = documentObject.createElement("span");
          name.className = "terminal-network-monitor-channel-name";
          name.textContent = channel.label;
          const channelState = documentObject.createElement("span");
          channelState.className = "terminal-network-monitor-channel-state";
          channelState.dataset.state = channel.state || "idle";
          channelState.textContent = stateLabel(channel.state);
          const rateLabel = documentObject.createElement("span");
          rateLabel.className = "terminal-network-monitor-channel-metric-label";
          rateLabel.textContent = "当前流量";
          const rate = documentObject.createElement("strong");
          rate.className = "terminal-network-monitor-channel-metric-value";
          rate.textContent = `${formatMegabytes(channel.bytesPerSecond)} MB/s`;
          const usageLabel = documentObject.createElement("span");
          usageLabel.className = "terminal-network-monitor-channel-metric-label";
          usageLabel.textContent = "已使用流量";
          const usage = documentObject.createElement("strong");
          usage.className = "terminal-network-monitor-channel-metric-value";
          usage.textContent = `${formatMegabytes(channel.totalBytes)} MB`;
          const detail = documentObject.createElement("small");
          detail.className = "terminal-network-monitor-channel-detail";
          detail.textContent = `接收 ${formatMegabytes(channel.receivedBytesPerSecond)} MB/s / ${formatMegabytes(channel.receivedBytes)} MB · 发送 ${formatMegabytes(channel.sentBytesPerSecond)} MB/s / ${formatMegabytes(channel.sentBytes)} MB`;
          row.append(name, channelState, rateLabel, rate, usageLabel, usage, detail);
          elements.terminalNetworkMonitorChannels.appendChild(row);
        }
      }
      const receivedRate = formatMegabytes(snapshot.receivedBytesPerSecond);
      const sentRate = formatMegabytes(snapshot.sentBytesPerSecond);
      const receivedUsage = formatMegabytes(snapshot.receivedBytes);
      const sentUsage = formatMegabytes(snapshot.sentBytes);
      if (elements.terminalNetworkMonitorRate) {
        elements.terminalNetworkMonitorRate.textContent = `${formatMegabytes(snapshot.bytesPerSecond)} MB/s`;
      }
      if (elements.terminalNetworkMonitorRateDetail) {
        elements.terminalNetworkMonitorRateDetail.textContent = `接收 ${receivedRate} MB/s · 发送 ${sentRate} MB/s`;
      }
      if (elements.terminalNetworkMonitorUsage) {
        elements.terminalNetworkMonitorUsage.textContent = `${formatMegabytes(snapshot.totalBytes)} MB`;
      }
      if (elements.terminalNetworkMonitorUsageDetail) {
        elements.terminalNetworkMonitorUsageDetail.textContent = `接收 ${receivedUsage} MB · 发送 ${sentUsage} MB`;
      }
    },
    initializationPerformanceClipboardText(state) {
      const snapshot = state || {};
      const lines = [
        "初始化性能",
        `状态: ${initializationStatusLabel(snapshot.status)}`,
        `总耗时: ${formatInitializationMs(snapshot.totalMs)}`,
      ];
      if (snapshot.sessionID) {
        lines.push(`Session: ${snapshot.sessionID}`);
      }
      lines.push("时间线:");
      for (const row of snapshot.rows || []) {
        const source = row.source || "页面初始化";
        const label = row.label || row.name || "初始化事件";
        const eventName = row.name && row.name !== row.label ? ` (${row.name})` : "";
        const details = row.details && Object.keys(row.details).length > 0
          ? ` · 详情 ${JSON.stringify(row.details)}`
          : "";
        lines.push(`- [${source}] ${label}${eventName}: ${formatInitializationMs(row.durationMs)} · 累计 ${formatInitializationMs(row.elapsedMs)}${details}`);
      }
      return lines.join("\n");
    },
    renderInitializationPerformance(state, { visible = false } = {}) {
      if (elements.initializationPerformancePanel) {
        elements.initializationPerformancePanel.hidden = !visible;
      }
      if (elements.initializationPerformanceStatus) {
        elements.initializationPerformanceStatus.textContent = initializationStatusLabel(state?.status);
      }
      if (elements.initializationPerformanceTotal) {
        elements.initializationPerformanceTotal.textContent = formatInitializationMs(state?.totalMs);
      }
      if (!elements.initializationPerformanceList) {
        return;
      }
      elements.initializationPerformanceList.textContent = "";
      for (const rowData of state?.rows || []) {
        const row = documentObject.createElement("div");
        row.className = "initialization-performance-row";
        const name = documentObject.createElement("span");
        name.className = "initialization-performance-name";
        name.textContent = rowData.label || rowData.name || "初始化事件";
        const duration = documentObject.createElement("strong");
        duration.className = "initialization-performance-duration";
        duration.textContent = formatInitializationMs(rowData.durationMs);
        const elapsed = documentObject.createElement("small");
        elapsed.className = "initialization-performance-elapsed";
        elapsed.textContent = `累计 ${formatInitializationMs(rowData.elapsedMs)}`;
        row.append(name, duration, elapsed);
        elements.initializationPerformanceList.appendChild(row);
      }
    },
    renderPerformanceTasks(rows, { visible = false } = {}) {
      if (elements.performanceTaskMeter) {
        elements.performanceTaskMeter.hidden = !visible;
      }
      if (!elements.performanceTaskMeterList) {
        return;
      }
      elements.performanceTaskMeterList.textContent = "";
      if (!visible) {
        return;
      }
      if (!rows?.length) {
        const empty = documentObject.createElement("div");
        empty.className = "performance-task-empty";
        empty.textContent = "暂无采样";
        elements.performanceTaskMeterList.appendChild(empty);
        return;
      }
      const header = documentObject.createElement("div");
      header.className = "performance-task-row header";
      appendTaskCell(header, "任务", "performance-task-name");
      appendTaskCell(header, "次数");
      appendTaskCell(header, "平均");
      appendTaskCell(header, "最大");
      appendTaskCell(header, "总计");
      elements.performanceTaskMeterList.appendChild(header);
      for (const item of rows) {
        const row = documentObject.createElement("div");
        row.className = "performance-task-row";
        appendTaskCell(row, item.name, "performance-task-name");
        appendTaskCell(row, String(item.count), "performance-task-value", taskAlert(item.name, "count", item.count));
        appendTaskCell(row, formatTaskMs(item.avg), "performance-task-value", taskAlert(item.name, "avgMs", item.avg));
        appendTaskCell(row, formatTaskMs(item.max), "performance-task-value", taskAlert(item.name, "maxMs", item.max));
        appendTaskCell(row, formatTaskMs(item.total), "performance-task-value", taskAlert(item.name, "totalMs", item.total));
        elements.performanceTaskMeterList.appendChild(row);
      }
    },
    syncControls(state) {
      const debugMode = state.debugMode === true;
      if (elements.settingsDebugModeToggle) {
        elements.settingsDebugModeToggle.checked = debugMode;
      }
      if (elements.settingsDebugOptions) {
        elements.settingsDebugOptions.hidden = !debugMode;
      }
      for (const [element, checked] of [
        [elements.settingsInitializationPerformanceToggle, state.initializationPerformance],
        [elements.settingsDebugLogToggle, state.debugLog],
        [elements.settingsNetworkMonitorToggle, state.networkMonitor],
        [elements.settingsPerformanceMeterToggle, state.performanceMeter],
        [elements.settingsPerformanceTasksToggle, state.performanceTasks],
      ]) {
        if (element) {
          element.checked = checked === true;
          element.disabled = !debugMode;
        }
      }
    },
  };
}
