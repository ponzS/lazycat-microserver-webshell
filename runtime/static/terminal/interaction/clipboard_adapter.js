export function createBrowserClipboardAdapter({
  documentObject = globalThis.document,
  navigatorObject = globalThis.navigator,
  windowObject = globalThis.window,
} = {}) {
  return Object.freeze({
    async copyText(text) {
      const value = String(text || "");
      if (!value) {
        return false;
      }
      if (navigatorObject?.clipboard?.writeText && windowObject?.isSecureContext) {
        try {
          await navigatorObject.clipboard.writeText(value);
          return true;
        } catch (error) {
        }
      }
      const textarea = documentObject?.createElement?.("textarea");
      if (!textarea || !documentObject?.body) {
        return false;
      }
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "0";
      documentObject.body.appendChild(textarea);
      textarea.select();
      let copied = false;
      try {
        copied = documentObject.execCommand?.("copy") === true;
      } finally {
        textarea.remove();
      }
      return copied;
    },
    async readText() {
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
    },
  });
}
