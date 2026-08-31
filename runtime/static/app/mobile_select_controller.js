/**
 * Owns the mobile replacement UI for native select elements. The controller
 * only manages its popover DOM and listener lifecycle; it does not own the
 * settings or service-forwarding values represented by a select.
 */
export function createMobileSelectController({
  documentObject = globalThis.document,
  windowObject = globalThis.window,
  isEnabled = () => false,
  HTMLSelectElementCtor = globalThis.HTMLSelectElement,
  HTMLElementCtor = globalThis.HTMLElement,
  EventCtor = globalThis.Event,
} = {}) {
  let state = null;
  let popover = null;
  let scrim = null;
  let panel = null;
  let list = null;
  let disposed = false;
  let focusTimer = 0;
  let positionFrame = 0;
  const installedSelects = new Set();

  const isSelect = (value) => (
    typeof HTMLSelectElementCtor === "function"
      ? value instanceof HTMLSelectElementCtor
      : Boolean(value && value.tagName === "SELECT")
  );
  const isElement = (value) => (
    typeof HTMLElementCtor === "function"
      ? value instanceof HTMLElementCtor
      : Boolean(value && typeof value.getBoundingClientRect === "function")
  );

  const clearFocusTimer = () => {
    if (!focusTimer) {
      return;
    }
    windowObject?.clearTimeout?.(focusTimer);
    focusTimer = 0;
  };

  const clearPositionFrame = () => {
    if (!positionFrame) {
      return;
    }
    windowObject?.cancelAnimationFrame?.(positionFrame);
    positionFrame = 0;
  };

  const labelFor = (select) => String(
    select?.getAttribute?.("aria-label")
      || select?.closest?.("label")?.querySelector?.("span")?.textContent
      || "选择",
  ).trim() || "选择";

  const ensurePopover = () => {
    if (popover) {
      return popover;
    }
    popover = documentObject.createElement("div");
    popover.className = "mobile-custom-select-popover";
    popover.id = "mobileCustomSelectPopover";
    popover.hidden = true;

    scrim = documentObject.createElement("button");
    scrim.type = "button";
    scrim.className = "mobile-custom-select-scrim";
    scrim.setAttribute("aria-label", "关闭选择菜单");

    panel = documentObject.createElement("section");
    panel.className = "mobile-custom-select-panel";
    panel.setAttribute("role", "listbox");
    panel.setAttribute("aria-label", "选择");

    list = documentObject.createElement("div");
    list.className = "mobile-custom-select-options";
    panel.appendChild(list);
    popover.append(scrim, panel);
    documentObject.body?.appendChild(popover);
    scrim.addEventListener("click", () => close());
    return popover;
  };

  const close = ({ focus = false } = {}) => {
    const current = state;
    if (!current) {
      clearFocusTimer();
      return false;
    }
    clearFocusTimer();
    current.select?.classList?.remove("mobile-custom-select-open");
    current.popover.hidden = true;
    current.list.textContent = "";
    state = null;
    if (focus) {
      focusTimer = windowObject?.setTimeout?.(() => {
        focusTimer = 0;
        if (!disposed) {
          current.select?.focus?.({ preventScroll: true });
        }
      }, 0) || 0;
    }
    return true;
  };

  const position = (select, nextPanel, nextList) => {
    if (!select || !nextPanel || !nextList) {
      return false;
    }
    const viewport = windowObject?.visualViewport;
    const viewportLeft = viewport?.offsetLeft || 0;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportWidth = Math.max(
      1,
      viewport?.width || windowObject?.innerWidth || documentObject?.documentElement?.clientWidth || 1,
    );
    const viewportHeight = Math.max(
      1,
      viewport?.height || windowObject?.innerHeight || documentObject?.documentElement?.clientHeight || 1,
    );
    const rect = select.getBoundingClientRect();
    const margin = 8;
    const minWidth = Math.max(180, rect.width);
    const width = Math.min(viewportWidth - margin * 2, minWidth);
    const left = Math.max(viewportLeft + margin, Math.min(viewportLeft + viewportWidth - width - margin, rect.left));
    const below = viewportTop + viewportHeight - rect.bottom - margin;
    const above = rect.top - viewportTop - margin;
    const maxHeight = Math.max(120, Math.min(360, Math.max(below, above) - 6));
    const top = below >= Math.min(280, maxHeight)
      ? rect.bottom + 6
      : Math.max(viewportTop + margin, rect.top - maxHeight - 6);
    nextPanel.style.left = `${Math.round(left)}px`;
    nextPanel.style.top = `${Math.round(top)}px`;
    nextPanel.style.width = `${Math.round(width)}px`;
    nextPanel.style.maxHeight = `${Math.round(maxHeight)}px`;
    nextList.style.maxHeight = `${Math.round(maxHeight)}px`;
    return true;
  };

  const syncPosition = () => {
    if (disposed || !state) {
      return false;
    }
    if (!isEnabled() || state.select.disabled || !documentObject.body?.contains?.(state.select)) {
      close();
      return false;
    }
    return position(state.select, state.panel, state.list);
  };

  const open = (select) => {
    if (disposed || !isSelect(select) || select.disabled || !isEnabled()) {
      return false;
    }
    const options = Array.from(select.options || []);
    if (options.length === 0) {
      return false;
    }
    close();
    const nextPopover = ensurePopover();
    const nextPanel = panel || nextPopover.querySelector?.(".mobile-custom-select-panel");
    const nextList = list || nextPopover.querySelector?.(".mobile-custom-select-options");
    if (!isElement(nextPanel) || !isElement(nextList)) {
      return false;
    }
    nextPanel.setAttribute("aria-label", labelFor(select));
    nextList.textContent = "";
    const selectedIndex = Number(select.selectedIndex);
    options.forEach((option, index) => {
      const button = documentObject.createElement("button");
      button.type = "button";
      button.className = "mobile-custom-select-option";
      button.dataset.optionIndex = String(index);
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", index === selectedIndex ? "true" : "false");
      button.disabled = option.disabled;
      button.textContent = option.textContent || option.label || option.value;
      if (index === selectedIndex) {
        button.classList.add("is-selected");
      }
      button.addEventListener("click", () => {
        if (disposed || button.disabled) {
          return;
        }
        const previousIndex = select.selectedIndex;
        select.selectedIndex = index;
        if (typeof select.dispatchEvent === "function" && typeof EventCtor === "function") {
          select.dispatchEvent(new EventCtor("input", { bubbles: true }));
          if (select.selectedIndex !== previousIndex) {
            select.dispatchEvent(new EventCtor("change", { bubbles: true }));
          }
        }
        close({ focus: true });
      });
      nextList.appendChild(button);
    });
    nextPopover.hidden = false;
    select.classList.add("mobile-custom-select-open");
    state = { select, popover: nextPopover, panel: nextPanel, list: nextList };
    position(select, nextPanel, nextList);
    clearPositionFrame();
    positionFrame = windowObject?.requestAnimationFrame?.(() => {
      positionFrame = 0;
      if (!disposed && state?.select === select) {
        state.list.querySelector?.(".mobile-custom-select-option.is-selected")?.scrollIntoView?.({ block: "nearest" });
      }
    }) || 0;
    return true;
  };

  const openFromEvent = (event) => {
    const select = event?.currentTarget;
    if (!isSelect(select) || !isEnabled()) {
      return;
    }
    event.preventDefault?.();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
    if (state?.select === select) {
      return;
    }
    open(select);
  };

  const keydown = (event) => {
    if (
      !isSelect(event?.currentTarget)
      || !isEnabled()
      || !["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)
    ) {
      return;
    }
    openFromEvent(event);
  };

  const install = () => {
    if (disposed) {
      return false;
    }
    for (const select of documentObject.querySelectorAll?.("select") || []) {
      if (!isSelect(select) || installedSelects.has(select) || select.dataset.mobileCustomSelectInstalled === "true") {
        continue;
      }
      installedSelects.add(select);
      select.dataset.mobileCustomSelectInstalled = "true";
      select.addEventListener("touchstart", openFromEvent, { capture: true, passive: false });
      select.addEventListener("pointerdown", openFromEvent, { capture: true, passive: false });
      select.addEventListener("click", openFromEvent, { capture: true });
      select.addEventListener("keydown", keydown, { capture: true });
    }
    return true;
  };

  const dispose = () => {
    if (disposed) {
      return false;
    }
    disposed = true;
    close();
    clearFocusTimer();
    clearPositionFrame();
    for (const select of installedSelects) {
      select.removeEventListener("touchstart", openFromEvent, { capture: true });
      select.removeEventListener("pointerdown", openFromEvent, { capture: true });
      select.removeEventListener("click", openFromEvent, { capture: true });
      select.removeEventListener("keydown", keydown, { capture: true });
    }
    installedSelects.clear();
    scrim?.remove?.();
    popover?.remove?.();
    state = null;
    popover = null;
    scrim = null;
    panel = null;
    list = null;
    return true;
  };

  return Object.freeze({
    close,
    dispose,
    install,
    isOpen: () => Boolean(state),
    open,
    syncPosition,
  });
}
