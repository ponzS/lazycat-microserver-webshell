import { findFirstTerminalURL, findTerminalURLAtPosition } from "./link_model.js";

export function createTerminalLinkController({
  windowObject = globalThis.window,
  copyText = async () => false,
  showToast = () => {},
} = {}) {
  let started = false;
  let disposed = false;
  let operationGeneration = 0;

  return Object.freeze({
    async copy(url) {
      const value = String(url || "");
      if (disposed || !value) {
        return false;
      }
      const generation = operationGeneration;
      const copied = await copyText(value);
      if (disposed || generation !== operationGeneration) {
        return false;
      }
      showToast(copied ? "链接已复制。" : "复制失败。");
      return copied;
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      operationGeneration += 1;
    },
    findAtPosition(session, clientX, clientY) {
      return disposed ? null : findTerminalURLAtPosition(session, clientX, clientY);
    },
    findFirst(text) {
      return disposed ? "" : findFirstTerminalURL(text);
    },
    open(url) {
      const value = String(url || "");
      if (disposed || !value) {
        return false;
      }
      windowObject?.open?.(value, "_blank", "noopener,noreferrer");
      return true;
    },
    start() {
      if (started || disposed) {
        return;
      }
      started = true;
    },
  });
}
