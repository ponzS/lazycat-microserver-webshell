import { createWorkspaceStateApplyLifecycle } from "./state_apply_lifecycle.js";

export function createWorkspaceStateApplyController({
  getTabs = () => new Map(),
  getActiveName = () => "",
  getActiveGeneration = () => 0,
  isCurrentRequest = () => true,
  ensureResponseSelector = () => {},
  responseSelector = () => "",
  showToast = () => {},
  readRestartTabForName = () => "",
  clearRestartTabForReload = () => {},
  readRequestedTab = () => "",
  setWorkspaceGenerationFromState = () => false,
  destroyLocalHistory = () => Promise.resolve(false),
  closeTab = () => {},
  createTab = () => null,
  recreateTabButton = () => {},
  createPaneSession = () => null,
  disposePane = () => {},
  updatePaneActivity = () => {},
  renderTabLabel = () => {},
  renderTabLayout = () => {},
  clearTabButtons = () => {},
  applyRecentTabIds = () => [],
  loadStoredRecentTabIds = () => [],
  getRecentTabIds = () => [],
  readLastActiveTab = () => "",
  setActiveTab = () => {},
  clearActiveTab = () => {},
  updateEmptyState = () => {},
  scheduleOverviewRender = () => {},
  resizeActiveTabForCurrentDevice = () => {},
  connectPendingSessionsForTab = () => {},
  flushPendingMembershipRefresh = () => {},
  measureTask = (name, task) => task(),
  lifecycleFactory = createWorkspaceStateApplyLifecycle,
  lifecycleOptions = {},
} = {}) {
  let applying = false;
  let disposed = false;
  const lifecycle = lifecycleFactory(lifecycleOptions);

  const runApplying = (task) => {
    if (disposed) {
      return false;
    }
    const previous = applying;
    applying = true;
    try {
      return task();
    } finally {
      applying = previous;
    }
  };

  const apply = (state, {
    focus = false,
    instanceName = getActiveName(),
    generation = getActiveGeneration(),
    preferStateActiveTab = false,
  } = {}) => measureTask("workspace apply", () => {
    const expectedName = String(instanceName || "").trim();
    ensureResponseSelector(state, expectedName);
    const targetName = responseSelector(state) || expectedName;
    if (disposed || !targetName || !isCurrentRequest(targetName, generation)) {
      return false;
    }
    const agentNotice = String(state?.agent_notice || "").trim();
    if (agentNotice) {
      showToast(agentNotice);
    }
    const restartTab = readRestartTabForName(targetName);
    const requestedTab = String(readRequestedTab() || "").trim();
    const tabs = getTabs();
    const workspaceGenerationChanged = setWorkspaceGenerationFromState(state, targetName);
    const previousApplying = applying;
    applying = true;
    try {
        if (workspaceGenerationChanged) {
          for (const tab of [...tabs.values()]) {
            closeTab(tab.id, { remember: false });
          }
        }
        const nextTabIDs = new Set((state?.tabs || []).map((tab) => tab.id));
        for (const tab of [...tabs.values()]) {
          if (!nextTabIDs.has(tab.id)) {
            for (const pane of tab.panes.values()) {
              if (pane.name === targetName) {
                destroyLocalHistory(pane);
              }
            }
            closeTab(tab.id, { remember: false });
          }
        }

        clearTabButtons();
        for (const tabState of state?.tabs || []) {
          let tab = tabs.get(tabState.id);
          if (!tab) {
            tab = createTab({
              id: tabState.id,
              label: tabState.label,
              customLabel: tabState.custom_label,
              focus: false,
              connect: false,
              empty: true,
              activate: false,
            });
          }
          tab.label = tabState.label || tab.label;
          tab.customLabel = Boolean(tabState.custom_label);
          tab.activePaneId = tabState.active_pane_id;
          tab.layout = tabState.layout || null;
          recreateTabButton(tab);

          const wantedPaneIDs = new Set((tabState.panes || []).map((pane) => pane.id));
          for (const pane of [...tab.panes.values()]) {
            if (!wantedPaneIDs.has(pane.id)) {
              if (pane.name === targetName) {
                destroyLocalHistory(pane);
              }
              disposePane(pane);
              tab.panes.delete(pane.id);
            }
          }
          for (const paneState of tabState.panes || []) {
            if (!tab.panes.has(paneState.id)) {
              createPaneSession(tab, targetName, {
                id: paneState.id,
                connect: true,
                cols: paneState.cols,
                rows: paneState.rows,
              });
            }
            const pane = tab.panes.get(paneState.id);
            if (pane?.workspaceExitPending) {
              pane.workspaceExitPending = false;
              pane.exitExpected = false;
              pane.pendingConnect = true;
            } else if (pane && !pane.socket) {
              pane.pendingConnect = true;
            }
            updatePaneActivity(paneState);
          }
          renderTabLabel(tab);
          renderTabLayout(tab);
        }

        const stateRecentTabIds = Array.isArray(state?.recent_tab_ids) ? state.recent_tab_ids : null;
        if (stateRecentTabIds) {
          applyRecentTabIds(stateRecentTabIds, { name: targetName });
        } else {
          const storedRecentTabIds = loadStoredRecentTabIds(targetName);
          const currentRecentTabIds = getRecentTabIds();
          applyRecentTabIds(
            storedRecentTabIds.length > 0 ? storedRecentTabIds : currentRecentTabIds,
            { name: targetName },
          );
        }
        const savedTab = readLastActiveTab(targetName);
        const stateActiveTab = state?.active_tab_id || "";
        const nextActiveTab = preferStateActiveTab
          ? tabs.get(restartTab) || tabs.get(stateActiveTab) || tabs.get(requestedTab) || tabs.get(savedTab) || tabs.values().next().value || null
          : tabs.get(restartTab) || tabs.get(requestedTab) || tabs.get(savedTab) || tabs.get(stateActiveTab) || tabs.values().next().value || null;
        if (nextActiveTab) {
          setActiveTab(nextActiveTab.id, { focus, rememberRecent: !stateRecentTabIds });
          const appliedRecentTabIds = getRecentTabIds();
          if (stateRecentTabIds && appliedRecentTabIds[0] !== nextActiveTab.id) {
            applyRecentTabIds([nextActiveTab.id, ...appliedRecentTabIds], { name: targetName });
          }
        } else {
          clearActiveTab();
        }
        updateEmptyState();
        scheduleOverviewRender();
        lifecycle.scheduleFrame(() => {
          if (!isCurrentRequest(targetName, generation)) {
            return;
          }
          resizeActiveTabForCurrentDevice();
          connectPendingSessionsForTab(nextActiveTab, { allowHidden: true });
        });
      return true;
    } finally {
      clearRestartTabForReload();
      applying = previousApplying;
      flushPendingMembershipRefresh("workspace_restored");
    }
  });

  const dispose = () => {
    if (disposed) {
      return false;
    }
    disposed = true;
    applying = false;
    lifecycle.dispose();
    return true;
  };

  return Object.freeze({
    apply,
    dispose,
    isApplying: () => applying,
    isDisposed: () => disposed,
    runApplying,
  });
}
