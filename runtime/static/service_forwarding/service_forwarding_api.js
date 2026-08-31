const readJSONSafe = async (response) => {
  const text = await response.text().catch(() => "");
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    return { message: trimmed };
  }
};

const responseErrorMessage = (data, fallback) => (
  String(data?.error || data?.message || fallback || "请求失败").trim()
);

export function createServiceForwardingAPI({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  baseURL = globalThis.location?.href,
  FormDataCtor = globalThis.FormData,
  FileCtor = globalThis.File,
} = {}) {
  const requestURL = (path) => {
    const normalized = String(path || "").replace(/^\/+/, "");
    return new URL(`./${normalized}`, baseURL).toString();
  };

  const requestJSON = async (path, {
    method = "GET",
    payload,
    fallback,
  } = {}) => {
    if (typeof fetchImpl !== "function") {
      throw new Error("当前环境不支持网络请求。");
    }
    const options = {
      method,
      credentials: "include",
    };
    if (method === "GET") {
      options.cache = "no-store";
    }
    if (payload !== undefined) {
      options.headers = { "Content-Type": "application/json" };
      options.body = JSON.stringify(payload);
    }
    const response = await fetchImpl(requestURL(path), options);
    const data = await readJSONSafe(response);
    if (!response.ok) {
      throw new Error(responseErrorMessage(data, `${fallback} (${response.status})`));
    }
    return data;
  };

  return {
    async create(payload) {
      return await requestJSON("/api/publish/http/create", {
        method: "POST",
        payload,
        fallback: "服务转发创建失败",
      }) || {};
    },
    async install(payload) {
      if (typeof fetchImpl !== "function" || typeof FormDataCtor !== "function") {
        throw new Error("当前环境不支持服务部署。");
      }
      const formData = new FormDataCtor();
      formData.set("id", String(payload?.id || "").trim());
      formData.set("subdomain", String(payload?.subdomain || "").trim());
      formData.set("title", String(payload?.title || "").trim());
      formData.set("skip_auth", String(Boolean(payload?.skip_auth)));
      if (typeof FileCtor === "function" && payload?.iconFile instanceof FileCtor) {
        formData.set("icon", payload.iconFile, payload.iconFile.name || "icon.png");
      }
      const response = await fetchImpl(requestURL("/api/publish/http/install-shell-lpk"), {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const data = await readJSONSafe(response);
      if (!response.ok) {
        throw new Error(responseErrorMessage(data, `服务转发部署失败 (${response.status})`));
      }
      return data || {};
    },
    async list() {
      const data = await requestJSON("/api/publish/list", {
        fallback: "服务转发列表加载失败",
      });
      return Array.isArray(data) ? data : [];
    },
    async remove(payload) {
      return await requestJSON("/api/publish/http/delete", {
        method: "POST",
        payload,
        fallback: "服务转发删除失败",
      }) || {};
    },
    async status() {
      return await requestJSON("/api/publish/status", {
        fallback: "服务转发状态加载失败",
      }) || {};
    },
    async update(payload) {
      return await requestJSON("/api/publish/http/update", {
        method: "POST",
        payload,
        fallback: "服务转发更新失败",
      }) || {};
    },
  };
}
