const createSelectionHandle = (documentObject, role) => {
  const handle = documentObject.createElement("button");
  handle.type = "button";
  handle.className = `mobile-selection-handle ${role}`;
  handle.dataset.selectionHandle = role;
  handle.tabIndex = -1;
  handle.setAttribute("aria-label", role === "start" ? "Adjust selection start" : "Adjust selection end");
  const bar = documentObject.createElement("span");
  bar.className = "mobile-selection-handle-bar";
  const knob = documentObject.createElement("span");
  knob.className = "mobile-selection-handle-knob";
  handle.append(bar, knob);
  return handle;
};

export function createTerminalSelectionView({
  documentObject = globalThis.document,
  windowObject = globalThis.window,
} = {}) {
  const selectionSheet = documentObject?.getElementById?.("selectionSheet") || null;
  const mobileShortcuts = documentObject?.getElementById?.("mobileShortcuts") || null;
  const overlays = new Map();

  const setOverlayVisible = (entry, visible) => {
    if (entry?.overlay) {
      entry.overlay.hidden = !visible;
    }
  };

  const hideSheet = () => {
    if (!selectionSheet) {
      return;
    }
    selectionSheet.hidden = true;
    selectionSheet.style.removeProperty("left");
    selectionSheet.style.removeProperty("top");
    selectionSheet.style.removeProperty("bottom");
    selectionSheet.style.removeProperty("visibility");
  };

  const positionHandles = (session, entry) => {
    const term = session?.term;
    const position = term?.getSelectionPosition?.();
    const canvas = term?.canvas || term?.element?.querySelector?.("canvas");
    const metrics = term?.renderer?.getMetrics?.();
    if (!entry || !term?.hasSelection?.() || !position || !canvas || !metrics?.width || !metrics?.height) {
      setOverlayVisible(entry, false);
      return false;
    }
    const shellRect = session.shellEl.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const left = canvasRect.left - shellRect.left;
    const top = canvasRect.top - shellRect.top;
    const startX = left + position.start.x * metrics.width;
    const startY = top + position.start.y * metrics.height;
    const endX = left + (position.end.x + 1) * metrics.width;
    const endY = top + position.end.y * metrics.height;
    entry.startHandle.style.left = `${startX}px`;
    entry.startHandle.style.top = `${startY}px`;
    entry.startHandle.style.height = `${Math.max(32, metrics.height + 20)}px`;
    entry.endHandle.style.left = `${endX}px`;
    entry.endHandle.style.top = `${endY}px`;
    entry.endHandle.style.height = `${Math.max(32, metrics.height + 20)}px`;
    setOverlayVisible(entry, true);
    return true;
  };

  return Object.freeze({
    cellFromPoint(session, clientX, clientY) {
      const term = session?.term;
      const renderer = term?.renderer;
      const canvas = term?.canvas || term?.element?.querySelector?.("canvas");
      const metrics = renderer?.getMetrics?.();
      if (!term || !renderer || !canvas || !metrics?.width || !metrics?.height) {
        return null;
      }
      const rect = canvas.getBoundingClientRect();
      const x = Math.max(rect.left, Math.min(clientX, rect.right - 1));
      const y = Math.max(rect.top, Math.min(clientY, rect.bottom - 1));
      const col = Math.max(0, Math.min(term.cols - 1, Math.floor((x - rect.left) / metrics.width)));
      const row = Math.max(0, Math.min(term.rows - 1, Math.floor((y - rect.top) / metrics.height)));
      const scrollback = term.wasmTerm?.getScrollbackLength?.() || 0;
      const viewportY = Math.floor(term.getViewportY?.() || term.viewportY || 0);
      return { col, row, absoluteRow: scrollback + row - viewportY };
    },

    createSessionOverlay(session) {
      if (!session?.shellEl || !documentObject?.createElement) {
        return null;
      }
      const existing = overlays.get(session);
      if (existing) {
        return existing;
      }
      const overlay = documentObject.createElement("div");
      overlay.className = "mobile-selection-overlay";
      overlay.hidden = true;
      const startHandle = createSelectionHandle(documentObject, "start");
      const endHandle = createSelectionHandle(documentObject, "end");
      overlay.append(startHandle, endHandle);
      session.shellEl.appendChild(overlay);
      const entry = { overlay, startHandle, endHandle };
      overlays.set(session, entry);
      return entry;
    },

    dispose() {
      for (const entry of overlays.values()) {
        entry.overlay?.remove?.();
      }
      overlays.clear();
      hideSheet();
    },

    getSelectionSheet() {
      return selectionSheet;
    },

    hideHandles(session) {
      setOverlayVisible(overlays.get(session), false);
    },

    hideSheet() {
      hideSheet();
    },

    isSheetOpen() {
      return Boolean(selectionSheet && !selectionSheet.hidden);
    },

    positionSheet(session) {
      const term = session?.term;
      const position = term?.getSelectionPosition?.();
      const canvas = term?.canvas || term?.element?.querySelector?.("canvas");
      const metrics = term?.renderer?.getMetrics?.();
      if (!selectionSheet || !term?.hasSelection?.() || !position || !canvas || !metrics?.width || !metrics?.height) {
        return false;
      }
      const viewport = windowObject?.visualViewport;
      const viewportLeft = viewport?.offsetLeft || 0;
      const viewportTop = viewport?.offsetTop || 0;
      const viewportWidth = Math.max(1, viewport?.width || windowObject?.innerWidth || documentObject?.documentElement?.clientWidth || 1);
      const viewportHeight = Math.max(1, viewport?.height || windowObject?.innerHeight || documentObject?.documentElement?.clientHeight || 1);
      const canvasRect = canvas.getBoundingClientRect();
      const startX = canvasRect.left + position.start.x * metrics.width;
      const endX = canvasRect.left + (position.end.x + 1) * metrics.width;
      const selectedTop = canvasRect.top + Math.min(position.start.y, position.end.y) * metrics.height;
      const selectedBottom = canvasRect.top + (Math.max(position.start.y, position.end.y) + 1) * metrics.height;
      selectionSheet.hidden = false;
      selectionSheet.style.visibility = "hidden";
      selectionSheet.style.left = "0px";
      selectionSheet.style.top = "0px";
      selectionSheet.style.bottom = "auto";
      const rect = selectionSheet.getBoundingClientRect();
      const margin = 8;
      const preferredX = (startX + endX) / 2;
      const minLeft = viewportLeft + margin;
      const maxLeft = viewportLeft + viewportWidth - rect.width - margin;
      const left = Math.max(minLeft, Math.min(maxLeft, preferredX - rect.width / 2));
      const minTop = viewportTop + margin;
      const maxTop = viewportTop + viewportHeight - rect.height - margin;
      const verticalGap = 10;
      let top = selectedBottom + verticalGap;
      if (top > maxTop) {
        top = selectedTop - rect.height - verticalGap;
      }
      top = Math.max(minTop, Math.min(maxTop, top));
      selectionSheet.style.left = `${Math.round(left)}px`;
      selectionSheet.style.top = `${Math.round(top)}px`;
      selectionSheet.style.visibility = "";
      return true;
    },

    removeSession(session) {
      const entry = overlays.get(session);
      entry?.overlay?.remove?.();
      overlays.delete(session);
    },

    syncMobileMenuSelectionState(hasSelection) {
      for (const button of mobileShortcuts?.querySelectorAll?.('[data-mobile-action="open_mobile_menu"]') || []) {
        button.classList.toggle("has-selection", hasSelection);
        button.setAttribute("aria-label", hasSelection ? "Menu. Selection active" : "Menu");
        button.setAttribute("title", hasSelection ? "Menu. Selection active" : "Menu");
      }
    },

    updateHandles(session, touchLayout) {
      for (const [candidate, entry] of overlays) {
        if (candidate !== session) {
          setOverlayVisible(entry, false);
        }
      }
      if (!session || !touchLayout) {
        if (session) {
          setOverlayVisible(overlays.get(session), false);
        }
        return false;
      }
      return positionHandles(session, overlays.get(session));
    },
  });
}
