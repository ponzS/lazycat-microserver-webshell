const normalizeID = (value) => String(value || "").trim();

const asFiniteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const paneIsUsable = (pane) => Boolean(
  pane
  && pane.visible !== false
  && pane.closed !== true,
);

const comparePanes = (left, right, activePaneID) => {
  const leftActive = left.id === activePaneID ? 0 : 1;
  const rightActive = right.id === activePaneID ? 0 : 1;
  return leftActive - rightActive
    || asFiniteNumber(right.lastUserInteractionAt) - asFiniteNumber(left.lastUserInteractionAt)
    || asFiniteNumber(right.lastBecameVisibleAt) - asFiniteNumber(left.lastBecameVisibleAt)
    || asFiniteNumber(right.lastOutputAt) - asFiniteNumber(left.lastOutputAt)
    || left.order - right.order
    || left.id.localeCompare(right.id);
};

const normalizePane = (pane, order) => ({
  id: normalizeID(pane?.id),
  ref: pane,
  measured: pane?.measured === true || asFiniteNumber(pane?.measuredFitGeneration) > 0,
  visible: pane?.visible !== false,
  closed: pane?.closed === true,
  lastUserInteractionAt: asFiniteNumber(pane?.lastUserInteractionAt),
  lastBecameVisibleAt: asFiniteNumber(pane?.lastBecameVisibleAt),
  lastOutputAt: asFiniteNumber(pane?.lastOutputAt ?? pane?.lastTerminalOutputAt),
  order,
  state: "awaiting_measurement",
});

const intentionalStopReasons = new Set([
  "context_changed",
  "network_offline",
  "page_disposed",
  "tab_or_target_removed",
  "session_closed",
  "promote_to_fast",
]);

// Owns browser-side Fast/Queue topology only. The runtime maps its commands to
// scheduler leases and the Queue transport; no DOM or WebSocket dependency is kept here.
export const createTerminalTopologyController = ({ onCommand = () => {} } = {}) => {
  let epoch = 0;
  let targetName = "";
  let tabID = "";
  let activePaneID = "";
  let online = true;
  let phase = "idle";
  let nextAttemptID = 1;
  let nextPaneOrder = 1;
  let panes = new Map();
  let fastSlots = [null, null];
  let queue = { state: "closed", attemptID: 0 };
  let pendingPromotion = null;

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

  const currentFastRecords = () => fastSlots.filter(Boolean);

  const measuredCandidates = () => Array.from(panes.values())
    .filter((record) => paneIsUsable(record) && record.measured)
    .sort((left, right) => comparePanes(left, right, activePaneID));

  const hasPendingMeasurements = () => Array.from(panes.values())
    .some((record) => paneIsUsable(record) && !record.measured);

  const setWaitingStates = () => {
    const fast = new Set(currentFastRecords().map((assignment) => assignment.pane.id));
    for (const record of panes.values()) {
      if (!paneIsUsable(record) || fast.has(record.id) || pendingPromotion?.target?.id === record.id) {
        continue;
      }
      setPaneState(record, record.measured ? "waiting_fast_gate" : "awaiting_measurement");
    }
  };

  const startFast = (slot, record, reason) => {
    if (!record || fastSlots[slot]) {
      return false;
    }
    const attemptID = nextAttemptID++;
    const assignment = { pane: record, slot, attemptID, state: "starting" };
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

  const queueCandidates = () => {
    if (!online || !queue || queue.state !== "open" || fastSlots.some((slot) => !slot || slot.state !== "ready")) {
      return [];
    }
    const fast = new Set(currentFastRecords().map((assignment) => assignment.pane.id));
    return measuredCandidates().filter((record) => !fast.has(record.id) && pendingPromotion?.target?.id !== record.id);
  };

  const syncQueueCandidates = (reason = "") => {
    if (queue.state !== "open") {
      return;
    }
    const candidates = queueCandidates();
    for (const record of candidates) {
      setPaneState(record, "queued", reason);
    }
    command("sync-queue-candidates", {
      panes: candidates.map((record) => record.ref),
      paneIDs: candidates.map((record) => record.id),
      reason: String(reason || ""),
    });
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

  const drive = (reason = "refresh") => {
    if (!online || !targetName || !tabID) {
      setPhase(online ? "idle" : "suspended", reason);
      return;
    }
    setWaitingStates();
    const candidates = measuredCandidates();
    const first = fastSlots[0];
    if (!first) {
      const activeRecord = panes.get(activePaneID) || null;
      if (activeRecord && paneIsUsable(activeRecord) && !activeRecord.measured) {
        setPhase("awaiting_measurement", reason);
        return;
      }
      const firstCandidate = activeRecord?.measured ? activeRecord : candidates[0];
      if (firstCandidate) {
        setPhase("fast_a_starting", reason);
        startFast(0, firstCandidate, reason);
      } else {
        setPhase("awaiting_measurement", reason);
      }
      return;
    }
    if (first.state !== "ready") {
      setPhase("fast_a_starting", reason);
      return;
    }

    const second = fastSlots[1];
    if (!second) {
      const secondCandidate = candidates.find((record) => record !== first.pane);
      if (secondCandidate) {
        setPhase("fast_b_starting", reason);
        startFast(1, secondCandidate, reason);
        return;
      }
      // A one-pane tab is already fully initialized. If additional panes have
      // not measured yet, keep the Fast gate closed instead of creating Queue.
      setPhase(hasPendingMeasurements() ? "fast_a_ready" : "running", reason);
      if (queue.state === "open") {
        syncQueueCandidates(reason);
      }
      return;
    }
    if (second.state !== "ready") {
      setPhase("fast_b_starting", reason);
      return;
    }

    const queueNeeded = candidates.some((record) => record !== first.pane && record !== second.pane);
    if (queueNeeded && queue.state === "closed") {
      startQueueTransport(reason);
      return;
    }
    setPhase("running", reason);
    if (queue.state === "open") {
      syncQueueCandidates(reason);
    }
  };

  const stopCurrentTopology = (reason) => {
    const previousEpoch = epoch;
    for (const assignment of currentFastRecords()) {
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
  };

  const resetTopology = (reason) => {
    stopCurrentTopology(reason);
    fastSlots = [null, null];
    queue = { state: "closed", attemptID: 0 };
    pendingPromotion = null;
  };

  const refresh = ({ targetName: nextTargetName, tabID: nextTabID, panes: nextPanes = [], activePane = null, online: nextOnline = true, reason = "refresh" } = {}) => {
    const normalizedTarget = normalizeID(nextTargetName);
    const normalizedTab = normalizeID(nextTabID);
    const contextChanged = normalizedTarget !== targetName || normalizedTab !== tabID;
    const nextOnlineState = nextOnline !== false;
    if (contextChanged || (!nextOnlineState && online)) {
      resetTopology(contextChanged ? "context_changed" : "network_offline");
      epoch += 1;
      targetName = normalizedTarget;
      tabID = normalizedTab;
    }
    online = nextOnlineState;
    activePaneID = normalizeID(typeof activePane === "object" ? activePane?.id : activePane);

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
      panes.set(id, record);
    }
    for (let index = 0; index < fastSlots.length; index += 1) {
      const assignment = fastSlots[index];
      if (!assignment) {
        continue;
      }
      const current = panes.get(assignment.pane.id);
      if (!current || !paneIsUsable(current)) {
        assignment.state = "stopping";
        command("stop-fast", {
          pane: assignment.pane.ref,
          paneID: assignment.pane.id,
          slot: assignment.slot,
          attemptID: assignment.attemptID,
          reason: "pane_removed",
        });
      } else {
        assignment.pane = current;
      }
    }
    if (pendingPromotion) {
      pendingPromotion.target = panes.get(pendingPromotion.target.id) || null;
      if (!pendingPromotion.target) {
        pendingPromotion = null;
      }
    }
    drive(reason);
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
    drive(options.reason || "pane_measured");
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
    if (assignment.slot === 0) {
      setPhase("fast_a_ready", "fast_rendered");
    } else {
      setPhase("fast_b_ready", "fast_rendered");
    }
    drive("fast_rendered");
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
    const record = paneByRefOrID(pane);
    const index = fastSlots.findIndex((slot) => slot?.pane.id === record?.id && slot.attemptID === Number(attemptID));
    if (index < 0) {
      return false;
    }
    const assignment = fastSlots[index];
    if (!intentionalStopReasons.has(String(reason || "")) && assignment.state !== "stopping") {
      // Scheduler-owned retry keeps the same controller phase and pane.
      return false;
    }
    fastSlots[index] = null;
    if (pendingPromotion?.victimAttemptID === assignment.attemptID && pendingPromotion.slot === index) {
      const promotion = pendingPromotion;
      pendingPromotion = null;
      startFast(index, promotion.target, "promote_to_fast");
      syncQueueCandidates("promote_to_fast");
      return true;
    }
    drive("fast_stopped");
    return true;
  };

  const queueTransportOpened = ({ eventEpoch = epoch, attemptID = 0 } = {}) => {
    if (eventEpoch !== epoch || queue.state !== "starting" || queue.attemptID !== Number(attemptID)) {
      return false;
    }
    queue.state = "open";
    setPhase("running", "queue_transport_opened");
    syncQueueCandidates("queue_transport_opened");
    return true;
  };

  const queueTransportClosed = ({ eventEpoch = epoch, attemptID = 0, retryable = true, reason = "queue_closed" } = {}) => {
    if (eventEpoch !== epoch || queue.attemptID !== Number(attemptID)) {
      return false;
    }
    queue = { state: "closed", attemptID: 0 };
    if (retryable && online) {
      drive(reason);
    }
    return true;
  };

  const promote = (pane, { reason = "user_interaction" } = {}) => {
    const target = paneByRefOrID(pane);
    if (!target || !paneIsUsable(target) || !target.measured) {
      return false;
    }
    if (currentFastRecords().some((assignment) => assignment.pane.id === target.id)) {
      return true;
    }
    if (phase !== "running" || pendingPromotion || fastSlots.some((slot) => !slot || slot.state !== "ready")) {
      return false;
    }
    const victims = currentFastRecords().slice().sort((left, right) => (
      comparePanes(left.pane, right.pane, activePaneID) * -1
    ));
    const victim = victims[0];
    if (!victim) {
      return false;
    }
    pendingPromotion = {
      target,
      slot: victim.slot,
      victimAttemptID: victim.attemptID,
    };
    victim.state = "stopping";
    setPaneState(target, "waiting_fast_gate", reason);
    command("stop-fast", {
      pane: victim.pane.ref,
      paneID: victim.pane.id,
      slot: victim.slot,
      attemptID: victim.attemptID,
      reason: "promote_to_fast",
    });
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

  const isQueueAllowed = () => queue.state === "open" && fastSlots.every((slot) => slot?.state === "ready");

  const snapshot = () => ({
    epoch,
    targetName,
    tabID,
    activePaneID,
    online,
    phase,
    fastSlots: fastSlots.map((slot) => slot && ({
      paneID: slot.pane.id,
      slot: slot.slot,
      attemptID: slot.attemptID,
      state: slot.state,
    })),
    queue: { ...queue },
    panes: Array.from(panes.values(), (record) => ({
      paneID: record.id,
      measured: record.measured,
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
    promote,
    paneState,
    queueCandidates: () => queueCandidates().map((record) => record.ref),
    isQueueAllowed,
    snapshot,
  };
};
