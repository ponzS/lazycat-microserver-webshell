const readResponseText = async (response, fallback) => {
  const text = String(await response.text().catch(() => "") || "").trim();
  return text || fallback;
};

const parseUploadPayload = (xhr) => {
  const text = String(xhr?.responseText || "").trim();
  if (!text) {
    return { files: [] };
  }
  try {
    return JSON.parse(text);
  } catch {
    return { files: [] };
  }
};

const createAbortedError = () => {
  const error = new Error("上传已取消");
  error.code = "attachment_upload_aborted";
  return error;
};

export function createAttachmentsAPI({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  baseURL = globalThis.location?.href,
  XMLHttpRequestCtor = globalThis.XMLHttpRequest,
  FormDataCtor = globalThis.FormData,
} = {}) {
  const buildURL = (path, { targetName = "", filePath = "", paths = [] } = {}) => {
    const url = new URL(path, baseURL);
    url.searchParams.set("name", String(targetName || "").trim());
    if (filePath) {
      url.searchParams.set("path", filePath);
    }
    for (const selectedPath of paths || []) {
      url.searchParams.append("path", selectedPath);
    }
    return url;
  };

  return {
    downloadURL({ targetName, paths }) {
      return buildURL("./api/attachments/download", { targetName, paths });
    },
    async list({ targetName, path = "" }) {
      if (typeof fetchImpl !== "function") {
        throw new Error("文件列表请求不可用。");
      }
      const response = await fetchImpl(buildURL("./api/attachments/files", { targetName, filePath: path }));
      if (!response.ok) {
        throw new Error(await readResponseText(response, `文件列表读取失败 (${response.status})`));
      }
      return response.json();
    },
    upload({ targetName, files, onProgress = () => {} }) {
      if (typeof XMLHttpRequestCtor !== "function" || typeof FormDataCtor !== "function") {
        throw new Error("当前浏览器无法上传附件。");
      }
      const form = new FormDataCtor();
      for (const file of files || []) {
        form.append("file", file, file?.name || "attachment.bin");
      }
      const xhr = new XMLHttpRequestCtor();
      const promise = new Promise((resolve, reject) => {
        xhr.upload?.addEventListener?.("progress", (event) => {
          onProgress({
            lengthComputable: event?.lengthComputable === true,
            loaded: Number(event?.loaded || 0),
            total: Number(event?.total || 0),
          });
        });
        xhr.addEventListener("load", () => {
          if (xhr.status < 200 || xhr.status >= 300) {
            reject(new Error(String(xhr.responseText || "").trim() || `上传失败 (${xhr.status})`));
            return;
          }
          resolve(parseUploadPayload(xhr));
        });
        xhr.addEventListener("error", () => reject(new Error("上传失败")));
        xhr.addEventListener("abort", () => reject(createAbortedError()));
      });
      xhr.open("POST", buildURL("./api/attachments", { targetName }));
      xhr.send(form);
      return { promise, xhr };
    },
  };
}
