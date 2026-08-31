const readResponseText = async (response, fallback) => {
  const text = await response.text().catch(() => "");
  return text.trim() || fallback;
};

export function createSettingsAPI({
  fetchImpl = globalThis.fetch,
  baseURL = globalThis.location?.href || "http://localhost/",
} = {}) {
  const request = async (path, options, fallback) => {
    const response = await fetchImpl(new URL(path, baseURL), options);
    if (!response.ok) {
      throw new Error(await readResponseText(response, `${fallback} (${response.status})`));
    }
    return response;
  };

  return {
    async deleteFont(fontID, { signal } = {}) {
      await request(
        `./api/settings/fonts/${encodeURIComponent(String(fontID || ""))}`,
        { method: "DELETE", signal },
        "字体删除失败",
      );
    },
    async load({ signal } = {}) {
      const response = await request("./api/settings", { cache: "no-store", signal }, "设置加载失败");
      return response.json();
    },
    async patch(patch, { keepalive = false, signal } = {}) {
      const response = await request("./api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
        keepalive,
        signal,
      }, "设置保存失败");
      return response.json();
    },
    async uploadFonts(files, { signal } = {}) {
      const form = new FormData();
      for (const file of Array.from(files || []).filter(Boolean)) {
        form.append("font", file);
      }
      const response = await request("./api/settings/fonts", {
        method: "POST",
        body: form,
        signal,
      }, "字体上传失败");
      return response.json();
    },
  };
}
