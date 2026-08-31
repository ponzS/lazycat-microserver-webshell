export function createDevicesView({ documentObject = globalThis.document } = {}) {
  const byID = (id) => documentObject?.getElementById?.(id) || null;
  const elements = {
    backdrop: byID("deviceBackdrop"),
    back: byID("deviceBack"),
    close: byID("deviceClose"),
    feedback: byID("deviceFeedback"),
    list: byID("deviceList"),
    onlineDevicesButton: byID("settingsOnlineDevicesButton"),
    heartbeatToggle: byID("settingsDeviceHeartbeatToggle"),
  };

  const appendEmpty = (text) => {
    if (!elements.list || !documentObject?.createElement) {
      return;
    }
    const empty = documentObject.createElement("div");
    empty.className = "device-empty";
    empty.textContent = text;
    elements.list.appendChild(empty);
  };

  return {
    elements,
    closePanel() {
      if (elements.backdrop) {
        elements.backdrop.hidden = true;
      }
    },
    dispose() {
      this.closePanel();
      this.setFeedback("");
    },
    focusPanel({ mobile = false } = {}) {
      (mobile ? elements.back : elements.close)?.focus?.();
    },
    heartbeatEnabled() {
      return elements.heartbeatToggle?.checked === true;
    },
    isAvailable() {
      return Boolean(elements.backdrop && elements.list);
    },
    isPanelOpen() {
      return Boolean(elements.backdrop && !elements.backdrop.hidden);
    },
    openPanel() {
      elements.list?.setAttribute?.("role", "list");
      if (elements.backdrop) {
        elements.backdrop.hidden = false;
      }
    },
    renderList({ devices = [], loaded = false, loading = false } = {}) {
      if (!elements.list) {
        return;
      }
      elements.list.textContent = "";
      if (!loaded && loading) {
        appendEmpty("正在加载设备...");
        return;
      }
      if (!Array.isArray(devices) || devices.length === 0) {
        appendEmpty("暂无正在连接的设备");
        return;
      }
      for (const device of devices) {
        const item = documentObject.createElement("div");
        item.className = "device-item";
        item.setAttribute("role", "listitem");

        const title = documentObject.createElement("div");
        title.className = "device-item-title";
        const name = String(device?.device_name || "Unknown Browser").trim();
        const platform = String(device?.platform || "Unknown").trim();
        const accountID = String(device?.account_id || "").trim();
        title.textContent = [name, platform, accountID].filter(Boolean).join(" - ");

        const meta = documentObject.createElement("div");
        meta.className = "device-item-meta";
        meta.textContent = "当前在线";

        item.append(title, meta);
        elements.list.appendChild(item);
      }
    },
    setFeedback(message, tone = "info") {
      if (!elements.feedback) {
        return;
      }
      const text = String(message || "").trim();
      elements.feedback.hidden = !text;
      elements.feedback.textContent = text;
      elements.feedback.dataset.tone = tone;
    },
    syncControls({ debugMode = false, heartbeatEnabled = false } = {}) {
      if (elements.heartbeatToggle) {
        elements.heartbeatToggle.checked = heartbeatEnabled;
        elements.heartbeatToggle.disabled = !debugMode;
      }
      if (elements.onlineDevicesButton) {
        elements.onlineDevicesButton.disabled = !debugMode;
      }
    },
  };
}
