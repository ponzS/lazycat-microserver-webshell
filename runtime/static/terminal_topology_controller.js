const normalizeID = (value) => String(value || "").trim();

const asFiniteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const paneIsUsable = (pane) => Boolean(
  pane
  && pane.closed !== true
  && pane.connectable !== false,
);

const compareRuntimePanes = (left, right, activeTabID, activePaneID) => {
  const leftTab = left.tabID === activeTabID ? 0 : 1;
  const rightTab = right.tabID === activeTabID ? 0 : 1;
  const leftActive = left.id === activePaneID ? 0 : 1;
  const rightActive = right.id === activePaneID ? 0 : 1;
  return leftTab - rightTab
    || leftActive - rightActive
    || asFiniteNumber(right.lastUserInteractionAt) - asFiniteNumber(left.lastUserInteractionAt)
    || asFiniteNumber(right.lastBecameVisibleAt) - asFiniteNumber(left.lastBecameVisibleAt)
    || asFiniteNumber(right.lastOutputAt) - asFiniteNumber(left.lastOutputAt)
    || left.initializationOrder - right.initializationOrder
    || left.order - right.order
    || left.id.localeCompare(right.id);
};

const compareInitializationPanes = (left, right) => {
  const leftOrder = asFiniteNumber(left.initializationOrder) || Number.MAX_SAFE_INTEGER;
  const rightOrder = asFiniteNumber(right.initializationOrder) || Number.MAX_SAFE_INTEGER;
  return leftOrder - rightOrder
    || left.order - right.order
    || left.id.localeCompare(right.id);
};

const normalizePane = (pane, order) => {
  const measured = pane?.measured === true || asFiniteNumber(pane?.measuredFitGeneration) > 0;
  const initialCols = asFiniteNumber(pane?.initialCols);
  const initialRows = asFiniteNumber(pane?.initialRows);
  const terminalCols = asFiniteNumber(pane?.term?.cols);
  const terminalRows = asFiniteNumber(pane?.term?.rows);
  return {
    id: normalizeID(pane?.id),
    tabID: normalizeID(pane?.tabId || pane?.tabID),
    ref: pane,
    measured,
    visible: pane?.topologyVisible === true || pane?.visible === true,
    connectable: pane?.topologyConnectable === true
      || measured
      || (initialCols >= 2 && initialRows >= 1)
      || (terminalCols >= 2 && terminalRows >= 1),
    closed: pane?.closed === true,
    lastUserInteractionAt: asFiniteNumber(pane?.lastUserInteractionAt),
    lastBecameVisibleAt: asFiniteNumber(pane?.lastBecameVisibleAt),
    lastOutputAt: asFiniteNumber(pane?.lastOutputAt ?? pane?.lastTerminalOutputAt),
    initializationOrder: asFiniteNumber(pane?.initializationOrder),
    order,
    state: "awaiting_measurement",
  };
};

const intentionalStopReasons = new Set([
  "context_changed",
  "network_offline",
  "page_disposed",
  "tab_or_target_removed",
  "session_closed",
  "promote_to_fast",
  "tab_priority_changed",
  "pane_removed",
]);

// Owns the page-level logical Fast/Queue topology. Physical transports are
// target-scoped and survive tab changes; commands only replace logical streams.
export const createTerminalTopologyController = ({ onCommand = () => {} } = {}) => {
  let epoch = 0;
  let targetName = "";
  let activeTabID = "";
  let activePaneID = "";
  let online = true;
  let phase = "idle";
  let nextAttemptID = 1;
  let nextPaneOrder = 1;
  let panes = new Map();
  let fastSlots = [null];
  let pendingReplacements = [null];
  let queue = { state: "closed", attemptID: 0 };
  let initializationOrderReady = false;
  let initializationOrderingActive = false;
  let initializationOrderCaptured = false;
  let pendingTabPriorityReconcile = false;

  const command = (type, payload = {}) => {
    onCommand({ type, epoch, ...payload });
  };

  const setPhase = (next, reason) => {
    if (phase === next) {
      return;
    }
    const previous = phase;
    phase = next;
    command("transition", { from: previous, to: next, reason: String(reason || "") });
  };

  const paneByRefOrID = (pane) => {
    const id = normalizeID(typeof pane === "object" ? pane?.id : pane);
    return panes.get(id) || null;
  };

  const setPaneState = (record, state, reason = "") => {
    if (!record || record.state === state) {
      return;
    }
    record.state = state;
    command("pane-state", {
      pane: record.ref,
      paneID: record.id,
      state,
      reason: String(reason || ""),
    });
  };

  const currentFastAssignments = () => fastSlots.filter(Boolean);
  const currentFastPaneIDs = () => new Set(currentFastAssignments().map((assignment) => assignment.pane.id));
  const pendingReplacementPaneIDs = () => new Set(pendingReplacements.filter(Boolean).map((replacement) => replacement.target.id));
  const workspacePanes = () => Array.from(panes.values()).filter((record) => record.ref?.closed !== true);

  const initializationCandidates = () => Array.from(panes.values())
    .filter(paneIsUsable)
    .sort(compareInitializationPanes);

  const activeTabCandidates = () => Array.from(panes.values())
    .filter((record) => (
      paneIsUsable(record)
      && record.tabID === activeTabID
      && record.visible
      && record.measured
    ))
    .sort(compareInitializationPanes);

  const activeTabPriorityReady = () => {
    const activePaneCount = Array.from(panes.values()).filter((record) => (
      record.ref?.closed !== true && record.tabID === activeTabID
    )).length;
    return activeTabCandidates().length >= Math.min(fastSlots.length, activePaneCount);
  };

  const runtimeCandidates = () => Array.from(panes.values())
    .filter(paneIsUsable)
    .sort((left, right) => compareRuntimePanes(left, right, activeTabID, activePaneID));

  const desiredFastCandidates = () => {
    const desired = activeTabCandidates();
    if (desired.length >= fastSlots.length) {
      return desired.slice(0, fastSlots.length);
    }
    const selected = new Set(desired.map((record) => record.id));
    for (const record of initializationOrderingActive ? initializationCandidates() : runtimeCandidates()) {
      if (selected.has(record.id)) {
        continue;
      }
      desired.push(record);
      selected.add(record.id);
      if (desired.length >= fastSlots.length) {
        break;
      }
    }
    return desired;
  };

  const queueCandidates = () => {
    if (!online || queue.state !== "open") {
      return [];
    }
    const excluded = currentFastPaneIDs();
    for (const paneID of pendingReplacementPaneIDs()) {
      excluded.add(paneID);
    }
    const candidates = initializationOrderingActive ? initializationCandidates() : runtimeCandidates();
    return candidates.filter((record) => !excluded.has(record.id));
  };

  const syncQueueCandidates = (reason = "", { initialization = false } = {}) => {
    if (queue.state !== "open") {
      return;
    }
    const candidates = queueCandidates();
    for (const record of candidates) {
      if (record.state !== "ready") {
        setPaneState(record, "queued", reason);
      }
    }
    command("sync-queue-candidates", {
      panes: candidates.map((record) => record.ref),
      paneIDs: candidates.map((record) => record.id),
      initialization: initialization === true,
      reason: String(reason || ""),
    });
  };

  const queueNeededForWorkspace = () => {
    const fast = currentFastAssignments();
    if (fast.length < fastSlots.length || fast.some((assignment) => assignment.state !== "ready")) {
      return false;
    }
    const fastIDs = currentFastPaneIDs();
    return workspacePanes().some((record) => !fastIDs.has(record.id));
  };

  const queueHasWorkspaceCandidates = () => {
    const fastIDs = currentFastPaneIDs();
    return workspacePanes().some((record) => !fastIDs.has(record.id));
  };

  const maybeStartQueueTransport = (reason) => {
    if (queue.state !== "closed" || !queuePhysicalPrerequisiteReady()) {
      return false;
    }
    return startQueueTransport(reason);
  };

  const stopQueueTransportIfUnneeded = (reason) => {
    if (queue.state !== "starting" && queue.state !== "open") {
      return false;
    }
    // Queue may remain open while the Fast logical binding is being
    // replaced. Only the absence of every non-Fast workspace pane warrants a
    // physical Queue shutdown; Fast readiness is a startup gate, not a close
    // gate.
    if (queueHasWorkspaceCandidates()) {
      return false;
    }
    const previousQueue = queue;
    queue = { state: "closed", attemptID: 0 };
    command("stop-queue-transport", {
      attemptID: previousQueue.attemptID,
      reason: String(reason || "queue_not_needed"),
    });
    // A Queue transport may be stopping while the surviving Fast pane is
    // still being promoted. Keep the phase descriptive so a subsequent
    // refresh can continue the normal Fast -> Queue bootstrap path.
    if (phase === "queue_starting") {
      setPhase(
        currentFastAssignments().some((assignment) => assignment?.state !== "ready")
          ? "fast_starting"
          : "running",
        reason,
      );
    }
    return true;
  };

  const setWaitingStates = () => {
    const fast = currentFastPaneIDs();
    const pending = pendingReplacementPaneIDs();
    for (const record of panes.values()) {
      if (!paneIsUsable(record) || fast.has(record.id) || pending.has(record.id) || record.state === "ready") {
        continue;
      }
      setPaneState(record, record.connectable ? "waiting_fast_gate" : "awaiting_measurement");
    }
  };

  const startFast = (slot, record, reason) => {
    if (!record || fastSlots[slot] || !paneIsUsable(record)) {
      return false;
    }
    const attemptID = nextAttemptID++;
    const assignment = {
      pane: record,
      slot,
      attemptID,
      state: "starting",
      physicalReady: false,
    };
    fastSlots[slot] = assignment;
    setPaneState(record, "attaching", reason);
    command("start-fast", {
      pane: record.ref,
      paneID: record.id,
      slot,
      attemptID,
      reason: String(reason || ""),
    });
    return true;
  };

  const startQueueTransport = (reason) => {
    if (queue.state !== "closed") {
      return false;
    }
    queue = { state: "starting", attemptID: nextAttemptID++ };
    setPhase("queue_starting", reason);
    command("start-queue-transport", { attemptID: queue.attemptID, reason: String(reason || "") });
    return true;
  };

  // Queue is created after the single Fast logical pane has completed replay
  // and its physical socket is OPEN. The bootstrap contract is Fast -> Queue.
  const queuePhysicalPrerequisiteReady = () => {
    const assignments = currentFastAssignments();
    return assignments.length === fastSlots.length
      && assignments.every((assignment) => assignment.physicalReady === true)
      && fastLogicalPrerequisiteReady()
      && workspacePanes().some((record) => !currentFastPaneIDs().has(record.id));
  };

  const fastLogicalPrerequisiteReady = () => (
    fastSlots.length === 1
      && fastSlots.every((assignment) => assignment?.state === "ready")
  );

  const requestSlotReplacement = (slot, target, reason) => {
    const assignment = fastSlots[slot];
    if (assignment?.pane.id === target?.id) {
      return false;
    }
    pendingReplacements[slot] = target ? { target, reason: String(reason || "") } : null;
    if (!assignment) {
      const replacement = pendingReplacements[slot];
      pendingReplacements[slot] = null;
      if (replacement?.target) {
        startFast(slot, replacement.target, replacement.reason);
      }
      return true;
    }
    if (assignment.state === "stopping") {
      return true;
    }
    assignment.state = "stopping";
    command("stop-fast", {
      pane: assignment.pane.ref,
      paneID: assignment.pane.id,
      slot,
      attemptID: assignment.attemptID,
      reason: String(reason || "tab_priority_changed"),
    });
    return true;
  };

  const reconcileRuntimeFast = (reason) => {
    if (phase !== "running" || !online) {
      return;
    }
    const desired = desiredFastCandidates();
    const desiredIDs = new Set(desired.map((record) => record.id));
    const assignedIDs = new Set();
    for (const assignment of currentFastAssignments()) {
      if (desiredIDs.has(assignment.pane.id) && assignment.state !== "stopping") {
        assignedIDs.add(assignment.pane.id);
      }
    }
    const unassignedDesired = desired.filter((record) => !assignedIDs.has(record.id));
    for (let slot = 0; slot < fastSlots.length; slot += 1) {
      const assignment = fastSlots[slot];
      if (assignment && desiredIDs.has(assignment.pane.id)) {
        continue;
      }
      requestSlotReplacement(slot, unassignedDesired.shift() || null, reason);
    }
    syncQueueCandidates(reason);
  };

  // Measurement may make an empty Fast slot eligible, but must never reorder
  // healthy assignments. Explicit tab/pane priority changes use the full
  // reconcile path above.
  const fillEmptyFastSlots = (reason) => {
    if (phase !== "running" || !online) {
      return false;
    }
    const desired = desiredFastCandidates();
    const assigned = currentFastPaneIDs();
    let started = false;
    for (let slot = 0; slot < fastSlots.length; slot += 1) {
      if (fastSlots[slot]) {
        continue;
      }
      const target = desired.find((record) => !assigned.has(record.id));
      if (!target) {
        continue;
      }
      assigned.add(target.id);
      started = startFast(slot, target, reason) || started;
    }
    if (started) {
      return true;
    }
    maybeStartQueueTransport(reason);
    syncQueueCandidates(reason);
    return false;
  };

  const driveBootstrap = (reason = "refresh") => {
    if (!online || !targetName || !activeTabID) {
      setPhase(online ? "idle" : "suspended", reason);
      return;
    }
    setWaitingStates();
    if (!initializationOrderReady) {
      setPhase("awaiting_measurement", reason);
      return;
    }
    const candidates = initializationCandidates();
    const first = fastSlots[0];
    if (!first) {
      if (candidates[0]) {
        setPhase("fast_starting", reason);
        startFast(0, candidates[0], reason);
      } else {
        setPhase("awaiting_measurement", reason);
      }
      return;
    }
    if (first.state !== "ready") {
      setPhase("fast_starting", reason);
      return;
    }
    if (maybeStartQueueTransport(reason)) {
      return;
    }
    setPhase("running", reason);
    if (queue.state === "open") {
      syncQueueCandidates(reason, { initialization: initializationOrderingActive });
    }
    initializationOrderingActive = false;
  };

  const stopCurrentTopology = (reason) => {
    const previousEpoch = epoch;
    for (const assignment of currentFastAssignments()) {
      command("stop-fast", {
        epoch: previousEpoch,
        pane: assignment.pane.ref,
        paneID: assignment.pane.id,
        slot: assignment.slot,
        attemptID: assignment.attemptID,
        reason,
      });
    }
    if (queue.state === "starting" || queue.state === "open") {
      command("stop-queue-transport", {
        epoch: previousEpoch,
        attemptID: queue.attemptID,
        reason,
      });
    }
    command("reset-fast-transports", { epoch: previousEpoch, reason });
  };

  const resetTopology = (reason) => {
    stopCurrentTopology(reason);
    fastSlots = [null];
    pendingReplacements = [null];
    queue = { state: "closed", attemptID: 0 };
  };

  // A physical transport failure invalidates every logical stream bound to
  // it. Keep the pane registry, but discard all assignments and force the
  // next refresh through the deterministic Fast -> Queue path.
  const transportFailure = (reason = "transport_failure") => {
    if (!targetName) {
      return false;
    }
    stopCurrentTopology(reason);
    epoch += 1;
    fastSlots = [null];
    pendingReplacements = [null];
    queue = { state: "closed", attemptID: 0 };
    setPhase(online ? "idle" : "suspended", reason);
    initializationOrderingActive = initializationOrderReady;
    pendingTabPriorityReconcile = false;
    for (const record of panes.values()) {
      if (!paneIsUsable(record)) {
        continue;
      }
      record.state = "retrying";
      command("pane-state", {
        pane: record.ref,
        paneID: record.id,
        state: "retrying",
        reason: String(reason || "transport_failure"),
      });
    }
    command("transport-failure", { reason: String(reason || "transport_failure") });
    return true;
  };

  const refresh = ({
    targetName: nextTargetName,
    tabID: nextTabID,
    panes: nextPanes = [],
    activePane = null,
    initializationOrderReady: nextInitializationOrderReady = false,
    online: nextOnline = true,
    reason = "refresh",
  } = {}) => {
    const normalizedTarget = normalizeID(nextTargetName);
    const normalizedTab = normalizeID(nextTabID);
    const targetChanged = normalizedTarget !== targetName;
    const tabChanged = !targetChanged && normalizedTab !== activeTabID;
    const nextOnlineState = nextOnline !== false;
    if (targetChanged || (!nextOnlineState && online)) {
      resetTopology(targetChanged ? "context_changed" : "network_offline");
      epoch += 1;
      targetName = normalizedTarget;
      initializationOrderReady = false;
      initializationOrderingActive = false;
      initializationOrderCaptured = false;
      pendingTabPriorityReconcile = false;
    }
    activeTabID = normalizedTab;
    online = nextOnlineState;
    activePaneID = normalizeID(typeof activePane === "object" ? activePane?.id : activePane);
    if (nextInitializationOrderReady === true) {
      initializationOrderReady = true;
      if (!initializationOrderCaptured) {
        initializationOrderCaptured = true;
        initializationOrderingActive = true;
      }
    }

    const previous = panes;
    panes = new Map();
    for (const pane of Array.from(nextPanes || [])) {
      const id = normalizeID(pane?.id);
      if (!id) {
        continue;
      }
      const prior = previous.get(id);
      const record = normalizePane(pane, prior?.order || nextPaneOrder++);
      record.state = prior?.state || record.state;
      record.initializationOrder = asFiniteNumber(pane?.initializationOrder)
        || asFiniteNumber(prior?.initializationOrder);
      panes.set(id, record);
    }
    for (let slot = 0; slot < fastSlots.length; slot += 1) {
      const assignment = fastSlots[slot];
      if (!assignment) {
        continue;
      }
      const current = panes.get(assignment.pane.id);
      if (!current || !paneIsUsable(current)) {
        pendingReplacements[slot] = null;
        assignment.state = "stopping";
        command("stop-fast", {
          pane: assignment.pane.ref,
          paneID: assignment.pane.id,
          slot,
          attemptID: assignment.attemptID,
          reason: "pane_removed",
        });
      } else {
        assignment.pane = current;
      }
    }
    for (let slot = 0; slot < pendingReplacements.length; slot += 1) {
      const replacement = pendingReplacements[slot];
      if (replacement) {
        replacement.target = panes.get(replacement.target.id) || null;
        if (!replacement.target) {
          pendingReplacements[slot] = null;
        }
      }
    }

    // Queue intentionally keeps its physical socket alive when its last
    // logical stream closes. Reconcile removals before considering startup so
    // a workspace reduced to only its Fast pane cannot retain a stale Queue
    // transport or leave the next pane waiting behind it.
    stopQueueTransportIfUnneeded(reason);

    // Physical Fast OPEN can happen while workspace restoration is still
    // adding panes. Re-evaluate it after every refresh so a missed OPEN event
    // cannot leave Queue permanently disabled until a tab switch.
    if (maybeStartQueueTransport(reason)) {
      return snapshot();
    }

    if (phase === "running" && tabChanged) {
      pendingTabPriorityReconcile = !activeTabPriorityReady();
      reconcileRuntimeFast("tab_priority_changed");
    } else if (phase === "running") {
      fillEmptyFastSlots(reason);
      maybeStartQueueTransport(reason);
      syncQueueCandidates(reason);
    } else {
      driveBootstrap(reason);
    }
    // Fast assignment changes can make a previously queued-only workspace
    // eligible for the single-pane topology immediately. Re-run the close
    // gate after reconciliation so a sole pane does not leave Queue enabled
    // merely because it was still queued at the start of this refresh.
    stopQueueTransportIfUnneeded(reason);
    return snapshot();
  };

  const paneMeasured = (pane, options = {}) => {
    const record = paneByRefOrID(pane);
    if (!record) {
      return false;
    }
    if (typeof pane === "object" && pane) {
      record.ref = pane;
    }
    record.measured = options.measured !== false;
    record.connectable = true;
    if (maybeStartQueueTransport(options.reason || "pane_measured")) {
      return true;
    }
    if (phase === "running") {
      fillEmptyFastSlots(options.reason || "pane_measured");
      if (pendingTabPriorityReconcile && activeTabPriorityReady()) {
        pendingTabPriorityReconcile = false;
        reconcileRuntimeFast("tab_priority_changed");
      }
      maybeStartQueueTransport(options.reason || "pane_measured");
      syncQueueCandidates(options.reason || "pane_measured");
    } else {
      driveBootstrap(options.reason || "pane_measured");
    }
    return true;
  };

  const fastRendered = (pane, { eventEpoch = epoch, attemptID = 0 } = {}) => {
    if (eventEpoch !== epoch) {
      return false;
    }
    const record = paneByRefOrID(pane);
    const assignment = fastSlots.find((slot) => slot?.pane.id === record?.id);
    if (!record || !assignment || assignment.attemptID !== Number(attemptID) || assignment.state === "stopping") {
      return false;
    }
    assignment.state = "ready";
    setPaneState(record, "ready", "fast_rendered");
    if (maybeStartQueueTransport("fast_rendered")) {
      return true;
    }
    if (phase === "running") {
      fillEmptyFastSlots("fast_rendered");
      maybeStartQueueTransport("fast_rendered");
      syncQueueCandidates("fast_rendered");
    } else {
      setPhase("fast_ready", "fast_rendered");
      driveBootstrap("fast_rendered");
    }
    return true;
  };

  const fastFailed = (pane, { eventEpoch = epoch, attemptID = 0, reason = "fast_failed" } = {}) => {
    if (eventEpoch !== epoch) {
      return false;
    }
    const record = paneByRefOrID(pane);
    const assignment = fastSlots.find((slot) => slot?.pane.id === record?.id);
    if (!record || !assignment || assignment.attemptID !== Number(attemptID) || assignment.state === "stopping") {
      return false;
    }
    assignment.state = "starting";
    setPaneState(record, "retrying", reason);
    return true;
  };

  const fastStopped = (pane, { eventEpoch = epoch, attemptID = 0, reason = "" } = {}) => {
    if (eventEpoch !== epoch) {
      return false;
    }
    // A workspace refresh removes closed panes from the registry before the
    // asynchronous WebSocket close event arrives. Match the assignment by
    // its stable pane ID so that close confirmation can still release the
    // physical Fast slot and promote the surviving pane.
    const paneID = normalizeID(typeof pane === "object" ? pane?.id : pane);
    const slot = fastSlots.findIndex((assignment) => (
      assignment?.pane.id === paneID && assignment.attemptID === Number(attemptID)
    ));
    if (slot < 0) {
      return false;
    }
    const assignment = fastSlots[slot];
    if (!intentionalStopReasons.has(String(reason || "")) && assignment.state !== "stopping") {
      return false;
    }
    fastSlots[slot] = null;
    const replacement = pendingReplacements[slot];
    pendingReplacements[slot] = null;
    if (replacement?.target && paneIsUsable(replacement.target)) {
      startFast(slot, replacement.target, replacement.reason || reason);
    } else if (phase === "running") {
      reconcileRuntimeFast("fast_stopped");
    } else {
      driveBootstrap("fast_stopped");
    }
    stopQueueTransportIfUnneeded(reason || "fast_stopped");
    syncQueueCandidates(reason || "fast_stopped");
    return true;
  };

  const queueTransportOpened = ({ eventEpoch = epoch, attemptID = 0 } = {}) => {
    if (eventEpoch !== epoch || queue.state !== "starting" || queue.attemptID !== Number(attemptID)) {
      return false;
    }
    queue.state = "open";
    if (fastLogicalPrerequisiteReady()) {
      setPhase("running", "queue_transport_opened");
      syncQueueCandidates("queue_transport_opened", { initialization: initializationOrderingActive });
      initializationOrderingActive = false;
    } else {
      setPhase("fast_starting", "queue_transport_opened");
    }
    return true;
  };

  const queueTransportClosed = ({ eventEpoch = epoch, attemptID = 0, retryable = true, reason = "queue_closed" } = {}) => {
    if (eventEpoch !== epoch || queue.attemptID !== Number(attemptID)) {
      return false;
    }
    queue = { state: "closed", attemptID: 0 };
    if (retryable && online) {
      if (queuePhysicalPrerequisiteReady()) {
        startQueueTransport(reason);
      }
    }
    return true;
  };

  const fastTransportOpened = ({ eventEpoch = epoch, slot = -1, attemptID = 0 } = {}) => {
    if (eventEpoch !== epoch) {
      return false;
    }
    const assignment = fastSlots[Math.floor(Number(slot))];
    if (!assignment || assignment.attemptID !== Number(attemptID)) {
      return false;
    }
    assignment.physicalReady = true;
    if (queue.state === "closed" && queuePhysicalPrerequisiteReady()) {
      startQueueTransport("fast_physical_open");
    }
    return true;
  };

  const fastTransportClosed = ({ eventEpoch = epoch, slot = -1, attemptID = 0 } = {}) => {
    if (eventEpoch !== epoch) {
      return false;
    }
    const assignment = fastSlots[Math.floor(Number(slot))];
    if (!assignment || assignment.attemptID !== Number(attemptID)) {
      return false;
    }
    assignment.physicalReady = false;
    if (assignment.state === "ready") {
      assignment.state = "starting";
      setPaneState(assignment.pane, "retrying", "fast_transport_closed");
    }
    return true;
  };

  const promote = (pane, { reason = "user_interaction" } = {}) => {
    const target = paneByRefOrID(pane);
    if (!target || !paneIsUsable(target) || !target.measured || target.tabID !== activeTabID) {
      return false;
    }
    if (currentFastAssignments().some((assignment) => assignment.pane.id === target.id)) {
      return true;
    }
    if (phase !== "running" || pendingReplacements.some(Boolean)) {
      return false;
    }
    const readyAssignments = currentFastAssignments().filter((assignment) => assignment.state === "ready");
    if (readyAssignments.length === 0) {
      return false;
    }
    const victim = readyAssignments.slice().sort((left, right) => (
      compareRuntimePanes(right.pane, left.pane, activeTabID, activePaneID)
    ))[0];
    if (!victim) {
      return false;
    }
    setPaneState(target, "waiting_fast_gate", reason);
    requestSlotReplacement(victim.slot, target, "promote_to_fast");
    return true;
  };

  const paneState = (pane, state, { eventEpoch = epoch, reason = "" } = {}) => {
    if (eventEpoch !== epoch) {
      return false;
    }
    const record = paneByRefOrID(pane);
    if (!record) {
      return false;
    }
    setPaneState(record, String(state || ""), reason);
    return true;
  };

  const isQueueAllowed = () => queue.state === "open" && fastLogicalPrerequisiteReady();

  const snapshot = () => ({
    epoch,
    targetName,
    tabID: activeTabID,
    activePaneID,
    online,
    phase,
    initializationOrderReady,
    initializationOrderingActive,
    initializationOrderCaptured,
    fastSlots: fastSlots.map((slot) => slot && ({
      paneID: slot.pane.id,
      slot: slot.slot,
      attemptID: slot.attemptID,
      state: slot.state,
      physicalReady: slot.physicalReady === true,
    })),
    queue: { ...queue },
    panes: Array.from(panes.values(), (record) => ({
      paneID: record.id,
      tabID: record.tabID,
      measured: record.measured,
      connectable: record.connectable,
      state: record.state,
    })),
    queuePaneIDs: queueCandidates().map((record) => record.id),
  });

  return {
    refresh,
    paneMeasured,
    fastRendered,
    fastFailed,
    fastStopped,
    queueTransportOpened,
    queueTransportClosed,
    fastTransportOpened,
    fastTransportClosed,
    transportFailure,
    promote,
    paneState,
    fastPane: (slot) => fastSlots[Math.floor(Number(slot))]?.pane.ref || null,
    queueCandidates: () => queueCandidates().map((record) => record.ref),
    isQueueAllowed,
    snapshot,
  };
};
