/**
 * Owns workspace layout DOM materialization and split-divider interaction.
 * Layout data is supplied by the workspace state owner; terminal resources
 * and persistence are reached only through explicit callbacks.
 */
export function createWorkspaceLayoutViewController({
  documentObject = globalThis.document,
  windowObject = globalThis.window,
  getCurrentTab = () => null,
  isApplyingWorkspaceState = () => false,
  setActivePane = () => {},
  resizeTab = () => {},
  scheduleTabResize = () => {},
  postWorkspaceAction = () => Promise.resolve(),
  showToast = () => {},
} = {}) {
  let disposed = false;

  const renderLeaf = (tab, node) => {
    const pane = tab?.panes?.get?.(node?.paneId);
    if (!pane) {
      const missing = documentObject?.createElement?.("div");
      if (!missing) {
        return null;
      }
      missing.className = "missing-pane";
      missing.textContent = "窗格不可用";
      return missing;
    }
    pane.shellEl.style.flexBasis = node.size ? `${node.size}%` : "";
    pane.shellEl.style.flexGrow = "1";
    pane.shellEl.style.flexShrink = "1";
    return pane.shellEl;
  };

  const installSplitResizeHandle = (divider, node, childIndex, direction) => {
    divider.addEventListener("pointerdown", (event) => {
      if (disposed) {
        return;
      }
      event.preventDefault();
      const container = divider.parentElement;
      if (!container) {
        return;
      }
      const first = container.children[childIndex * 2];
      const second = container.children[childIndex * 2 + 2];
      if (!(first instanceof HTMLElement) || !(second instanceof HTMLElement)) {
        return;
      }
      const rect = container.getBoundingClientRect();
      const total = direction === "vertical" ? rect.width : rect.height;
      if (total <= 0) {
        return;
      }
      const start = direction === "vertical" ? event.clientX : event.clientY;
      const firstBasis = (first.getBoundingClientRect()[direction === "vertical" ? "width" : "height"] / total) * 100;
      const secondBasis = (second.getBoundingClientRect()[direction === "vertical" ? "width" : "height"] / total) * 100;
      const combined = firstBasis + secondBasis;
      divider.classList.add("is-dragging");
      container.classList.add("is-resizing");
      documentObject?.body?.classList.add("split-resize-active");
      divider.setPointerCapture?.(event.pointerId);

      const onMove = (moveEvent) => {
        if (disposed) {
          return;
        }
        const current = direction === "vertical" ? moveEvent.clientX : moveEvent.clientY;
        const delta = ((current - start) / total) * 100;
        const nextFirst = Math.max(12, Math.min(combined - 12, firstBasis + delta));
        const nextSecond = Math.max(12, combined - nextFirst);
        node.children[childIndex].size = nextFirst;
        node.children[childIndex + 1].size = nextSecond;
        first.style.flexBasis = `${nextFirst}%`;
        second.style.flexBasis = `${nextSecond}%`;
        scheduleTabResize(getCurrentTab(), {
          forceFullRender: true,
          hideUntilRender: true,
        });
      };

      const onUp = () => {
        divider.classList.remove("is-dragging");
        container.classList.remove("is-resizing");
        documentObject?.body?.classList.remove("split-resize-active");
        divider.removeEventListener("pointermove", onMove);
        divider.removeEventListener("pointerup", onUp);
        divider.removeEventListener("pointercancel", onUp);
        scheduleTabResize(getCurrentTab(), {
          forceFullRender: true,
          hideUntilRender: true,
        }, { immediate: true });
        const tab = getCurrentTab();
        if (tab && !isApplyingWorkspaceState()) {
          Promise.resolve(postWorkspaceAction("update_layout", {
            tab_id: tab.id,
            layout: tab.layout,
            active_pane_id: tab.activePaneId,
          })).catch((error) => showToast(error.message));
        }
      };

      divider.addEventListener("pointermove", onMove);
      divider.addEventListener("pointerup", onUp);
      divider.addEventListener("pointercancel", onUp);
    });
  };

  const renderLayoutNode = (tab, node) => {
    if (!node || node.type === "leaf") {
      return renderLeaf(tab, node || { paneId: tab?.activePaneId });
    }
    const wrapper = documentObject?.createElement?.("div");
    if (!wrapper) {
      return null;
    }
    wrapper.className = `split-node ${node.direction}`;
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach((child, index) => {
      const childEl = renderLayoutNode(tab, child);
      if (!childEl) {
        return;
      }
      childEl.style.flexBasis = child.size ? `${child.size}%` : `${100 / Math.max(1, children.length)}%`;
      childEl.style.flexGrow = "1";
      childEl.style.flexShrink = "1";
      wrapper.appendChild(childEl);
      if (index < children.length - 1) {
        const divider = documentObject.createElement("div");
        divider.className = "split-divider";
        divider.setAttribute("role", "separator");
        divider.setAttribute("aria-orientation", node.direction === "vertical" ? "vertical" : "horizontal");
        installSplitResizeHandle(divider, node, index, node.direction);
        wrapper.appendChild(divider);
      }
    });
    return wrapper;
  };

  const renderTabLayout = (tab) => {
    if (disposed || !tab?.layoutHost) {
      return false;
    }
    tab.layoutHost.textContent = "";
    if (tab.layout && tab.panes?.size > 0) {
      const layout = renderLayoutNode(tab, tab.layout);
      if (layout) {
        tab.layoutHost.appendChild(layout);
      }
    }
    setActivePane(tab, tab.activePaneId, {
      focus: false,
      resizeIfActive: true,
      syncConnection: false,
    });
    windowObject?.requestAnimationFrame?.(() => resizeTab(tab));
    return true;
  };

  const dispose = () => {
    if (disposed) {
      return false;
    }
    disposed = true;
    return true;
  };

  return Object.freeze({
    dispose,
    isDisposed: () => disposed,
    renderTabLayout,
  });
}
