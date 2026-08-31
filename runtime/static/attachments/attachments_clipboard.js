const fileExtensionFromType = (type) => {
  const mime = String(type || "").toLowerCase();
  switch (mime) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    case "text/html":
      return ".html";
    case "application/json":
      return ".json";
    default:
      return mime.startsWith("text/") ? ".txt" : "";
  }
};

const timestamp = () => new Date().toISOString().replace(/[:.]/g, "-");

export function createAttachmentsClipboard({
  navigatorObject = globalThis.navigator,
  windowObject = globalThis.window,
  FileCtor = globalThis.File,
  BlobCtor = globalThis.Blob,
  ClipboardItemCtor = globalThis.ClipboardItem,
} = {}) {
  const createFile = (parts, name, options) => {
    if (typeof FileCtor !== "function") {
      throw new Error("当前浏览器无法创建附件文件。");
    }
    return new FileCtor(parts, name, options);
  };

  const readText = async () => {
    if (!navigatorObject?.clipboard?.readText || !windowObject?.isSecureContext) {
      throw new Error("当前浏览器环境无法读取剪贴板。");
    }
    try {
      return await navigatorObject.clipboard.readText();
    } catch (error) {
      const name = String(error?.name || "");
      const message = String(error?.message || "");
      if (
        name === "NotAllowedError"
        || name === "SecurityError"
        || /permissions[- ]policy|clipboard-read|read permission|not allowed/i.test(message)
      ) {
        throw new Error("当前页面策略禁止主动读取剪贴板，请使用系统粘贴快捷键。");
      }
      throw error;
    }
  };

  return {
    createReservation() {
      if (
        !navigatorObject?.clipboard?.write
        || typeof ClipboardItemCtor !== "function"
        || typeof BlobCtor !== "function"
        || !windowObject?.isSecureContext
      ) {
        return null;
      }
      let resolveText;
      let rejectText;
      const textPromise = new Promise((resolve, reject) => {
        resolveText = resolve;
        rejectText = reject;
      });
      const item = new ClipboardItemCtor({
        "text/plain": textPromise.then((text) => new BlobCtor([String(text || "")], { type: "text/plain" })),
      });
      const promise = navigatorObject.clipboard.write([item]);
      promise.catch(() => {});
      return {
        promise,
        reject(error) {
          rejectText(error || new Error("attachment clipboard canceled"));
        },
        resolve(text) {
          resolveText(String(text || ""));
        },
      };
    },
    async readFiles() {
      const files = [];
      if (navigatorObject?.clipboard?.read && windowObject?.isSecureContext) {
        try {
          const items = await navigatorObject.clipboard.read();
          for (const item of items || []) {
            const types = Array.from(item?.types || []);
            for (const type of types.filter((value) => !String(value).startsWith("text/"))) {
              const blob = await item.getType(type);
              if (!blob || blob.size <= 0) {
                continue;
              }
              const extension = fileExtensionFromType(blob.type) || ".bin";
              files.push(createFile([blob], `clipboard-${timestamp()}-${files.length + 1}${extension}`, { type: blob.type || type }));
            }
          }
        } catch {
        }
      }
      if (files.length > 0) {
        return files;
      }
      const text = await readText();
      if (!text) {
        throw new Error("剪贴板没有可导入的内容。");
      }
      return [createFile([text], `clipboard-${timestamp()}.txt`, { type: "text/plain;charset=utf-8" })];
    },
  };
}
