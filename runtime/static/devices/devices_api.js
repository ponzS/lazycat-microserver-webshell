const readResponseText = async (response, fallback) => {
  const text = await response.text().catch(() => "");
  return text.trim() || fallback;
};

export function createDevicesAPI({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  baseURL = globalThis.location?.href,
  navigatorObject = globalThis.navigator,
  BlobCtor = globalThis.Blob,
} = {}) {
  const url = (path) => new URL(path, baseURL).toString();
  const request = async (path, options, fallback) => {
    if (typeof fetchImpl !== "function") {
      throw new Error("设备 API 不可用");
    }
    const response = await fetchImpl(url(path), options);
    if (!response.ok) {
      throw new Error(await readResponseText(response, `${fallback} (${response.status})`));
    }
    return response;
  };

  return {
    async heartbeat(device, { signal } = {}) {
      await request("./api/devices/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(device),
        signal,
      }, "设备心跳失败");
    },
    async list({ signal } = {}) {
      const response = await request("./api/devices", {
        cache: "no-store",
        signal,
      }, "设备列表加载失败");
      const devices = await response.json();
      if (!Array.isArray(devices)) {
        throw new Error("设备列表响应无效");
      }
      return devices;
    },
    sendOfflineBeacon(device) {
      if (navigatorObject?.onLine === false || typeof navigatorObject?.sendBeacon !== "function" || !BlobCtor) {
        return false;
      }
      try {
        return navigatorObject.sendBeacon(
          url("./api/devices/offline"),
          new BlobCtor([JSON.stringify(device)], { type: "application/json" }),
        );
      } catch (error) {
        return false;
      }
    },
  };
}
