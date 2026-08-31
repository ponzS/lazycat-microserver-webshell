export function createTerminalSearchView({ documentObject = globalThis.document } = {}) {
  const panel = documentObject?.getElementById?.("searchPanel") || null;
  const input = documentObject?.getElementById?.("searchInput") || null;
  const count = documentObject?.getElementById?.("searchCount") || null;
  const previous = documentObject?.getElementById?.("searchPrevious") || null;
  const next = documentObject?.getElementById?.("searchNext") || null;
  const close = documentObject?.getElementById?.("searchClose") || null;

  const closePanel = () => {
    if (panel) {
      panel.hidden = true;
    }
  };

  return Object.freeze({
    canOpen() {
      return Boolean(panel && input);
    },
    close: closePanel,
    dispose() {
      closePanel();
    },
    elements: Object.freeze({ close, input, next, previous }),
    focusAndSelect() {
      input?.focus?.();
      input?.select?.();
    },
    isOpen() {
      return Boolean(panel && !panel.hidden);
    },
    open(query) {
      if (!panel || !input) {
        return false;
      }
      panel.hidden = false;
      input.value = String(query || "");
      return true;
    },
    readQuery() {
      return String(input?.value || "");
    },
    setCount(current, total) {
      if (!count) {
        return;
      }
      count.textContent = total > 0 ? `${current}/${total}` : "0/0";
    },
    setQuery(query, { select = false } = {}) {
      if (!input) {
        return;
      }
      input.value = String(query || "");
      if (select) {
        input.select?.();
      }
    },
  });
}
