import assert from "node:assert/strict";
import test from "node:test";

import { createTerminalTopologyController } from "./runtime/static/terminal_topology_controller.js";

const pane = (id, {
  tabID = "tab-a",
  measured = true,
  visible = tabID === "tab-a",
  connectable = measured,
  interaction = 0,
  initializationOrder = 0,
} = {}) => ({
  id,
  tabId: tabID,
  measured,
  topologyVisible: visible,
  topologyConnectable: connectable,
  lastUserInteractionAt: interaction,
  initializationOrder,
});

const commandsFor = (commands, type) => commands.filter((command) => command.type === type);

const bootstrap = ({
  panes,
  activePane = panes[0],
  initializationOrderReady = true,
  commands = [],
} = {}) => {
  const controller = createTerminalTopologyController({ onCommand: (command) => commands.push(command) });
  controller.refresh({
    targetName: "instance-a",
    tabID: "tab-a",
    panes,
    activePane,
    initializationOrderReady,
  });
  return { controller, commands };
};

const finishBootstrap = (controller, commands) => {
  const first = commandsFor(commands, "start-fast")[0];
  controller.fastTransportOpened({ eventEpoch: first.epoch, slot: first.slot, attemptID: first.attemptID });
  controller.fastRendered(first.pane, { eventEpoch: first.epoch, attemptID: first.attemptID });
  const queue = commandsFor(commands, "start-queue-transport")[0];
  if (queue) {
    controller.queueTransportOpened({ eventEpoch: queue.epoch, attemptID: queue.attemptID });
  }
  return { first, queue };
};

test("global startup waits for one logical Fast pane before one Queue transport", () => {
  const panes = Array.from({ length: 32 }, (_, index) => pane(`pane-${index + 1}`, {
    initializationOrder: index + 1,
  }));
  const { controller, commands } = bootstrap({ panes });

  const first = commandsFor(commands, "start-fast")[0];
  assert.equal(first.paneID, "pane-1");
  assert.equal(controller.snapshot().fastSlots.length, 1);
  assert.equal(commandsFor(commands, "start-fast").length, 1);
  assert.equal(commandsFor(commands, "start-queue-transport").length, 0);
  controller.fastTransportOpened({ eventEpoch: first.epoch, slot: first.slot, attemptID: first.attemptID });
  assert.equal(commandsFor(commands, "start-queue-transport").length, 0);
  controller.fastRendered(first.pane, { eventEpoch: first.epoch, attemptID: first.attemptID });
  const queue = commandsFor(commands, "start-queue-transport")[0];
  assert.ok(queue);
  controller.queueTransportOpened({ eventEpoch: queue.epoch, attemptID: queue.attemptID });
  assert.deepEqual(commandsFor(commands, "sync-queue-candidates").at(-1).paneIDs, panes.slice(1).map((item) => item.id));
});

test("physical Fast OPEN does not start Queue before hidden Fast replay is ready", () => {
  const panes = [
    pane("a-1", { initializationOrder: 1 }),
    pane("b-1", { tabID: "tab-b", visible: false, measured: false, connectable: true, initializationOrder: 2 }),
    pane("c-1", { tabID: "tab-c", visible: false, measured: false, connectable: true, initializationOrder: 3 }),
  ];
  const { controller, commands } = bootstrap({ panes });
  const first = commandsFor(commands, "start-fast")[0];
  controller.fastTransportOpened({ eventEpoch: first.epoch, slot: first.slot, attemptID: first.attemptID });
  assert.equal(commandsFor(commands, "start-queue-transport").length, 0);
  assert.equal(controller.snapshot().queue.state, "closed");
  controller.fastRendered(first.pane, { eventEpoch: first.epoch, attemptID: first.attemptID });
  assert.equal(commandsFor(commands, "start-queue-transport").length, 1);
  assert.equal(controller.snapshot().queue.state, "starting");
});

test("a late workspace pane rechecks physical Fast readiness and starts Queue", () => {
  const initialPanes = [pane("a-1", { initializationOrder: 1 })];
  const extraPane = pane("b-1", {
    tabID: "tab-b",
    visible: false,
    initializationOrder: 3,
  });
  const { controller, commands } = bootstrap({ panes: initialPanes });
  const first = commandsFor(commands, "start-fast")[0];
  controller.fastTransportOpened({ eventEpoch: first.epoch, slot: first.slot, attemptID: first.attemptID });
  assert.equal(commandsFor(commands, "start-queue-transport").length, 0);

  controller.refresh({
    targetName: "instance-a",
    tabID: "tab-a",
    panes: [...initialPanes, extraPane],
    activePane: initialPanes[0],
    initializationOrderReady: true,
  });

  controller.fastRendered(first.pane, { eventEpoch: first.epoch, attemptID: first.attemptID });
  assert.equal(commandsFor(commands, "start-queue-transport").length, 1);
  assert.equal(controller.snapshot().queue.state, "starting");
});

test("cold startup includes background tabs in one stable global Queue order", () => {
  const panes = [
    pane("a-1", { initializationOrder: 1 }),
    pane("a-2", { initializationOrder: 2 }),
    pane("b-1", { tabID: "tab-b", visible: false, initializationOrder: 3 }),
    pane("b-2", { tabID: "tab-b", visible: false, initializationOrder: 4 }),
  ];
  const { controller, commands } = bootstrap({ panes });
  finishBootstrap(controller, commands);
  assert.deepEqual(commandsFor(commands, "sync-queue-candidates").at(-1).paneIDs, ["a-2", "b-1", "b-2"]);
});

test("cold startup does not let an unmeasured background pane delay Queue after Fast", () => {
  const panes = [
    pane("a-1", { initializationOrder: 1 }),
    pane("b-1", { tabID: "tab-b", visible: false, measured: false, connectable: true, initializationOrder: 2 }),
    pane("c-1", { tabID: "tab-c", visible: false, measured: false, connectable: true, initializationOrder: 3 }),
  ];
  const { controller, commands } = bootstrap({ panes });
  const first = commandsFor(commands, "start-fast")[0];
  controller.fastTransportOpened({ eventEpoch: first.epoch, slot: first.slot, attemptID: first.attemptID });
  controller.fastRendered(first.pane, { eventEpoch: first.epoch, attemptID: first.attemptID });
  const queue = commandsFor(commands, "start-queue-transport")[0];
  assert.ok(queue, "Queue must be created after Fast is ready");
  assert.equal(controller.snapshot().queue.state, "starting");
});

test("pane measurement in running phase fills only an empty Fast slot and never reorders healthy slots", () => {
  const panes = [
    pane("a-1", { initializationOrder: 1 }),
    pane("a-2", { initializationOrder: 2 }),
    pane("a-3", { measured: false, connectable: false, initializationOrder: 0 }),
  ];
  const { controller, commands } = bootstrap({ panes });
  finishBootstrap(controller, commands);
  const fastStartCount = commandsFor(commands, "start-fast").length;
  const fastStopCount = commandsFor(commands, "stop-fast").length;
  controller.paneMeasured(panes[2]);
  assert.equal(commandsFor(commands, "start-fast").length, fastStartCount);
  assert.equal(commandsFor(commands, "stop-fast").length, fastStopCount);
  assert.deepEqual(controller.snapshot().fastSlots.map((slot) => slot?.paneID), ["a-1"]);
});

test("tab switch replaces only logical Fast bindings and preserves Queue and epoch", () => {
  const panes = [
    pane("a-1", { initializationOrder: 1 }),
    pane("a-2", { initializationOrder: 2 }),
    pane("b-1", { tabID: "tab-b", visible: false, initializationOrder: 3 }),
    pane("b-2", { tabID: "tab-b", visible: false, initializationOrder: 4 }),
  ];
  const { controller, commands } = bootstrap({ panes });
  finishBootstrap(controller, commands);
  const initialEpoch = controller.snapshot().epoch;
  const stopQueueCount = commandsFor(commands, "stop-queue-transport").length;
  panes[0].topologyVisible = false;
  panes[1].topologyVisible = false;
  panes[2].topologyVisible = true;
  panes[3].topologyVisible = true;
  controller.refresh({
    targetName: "instance-a",
    tabID: "tab-b",
    panes,
    activePane: panes[2],
    initializationOrderReady: true,
    reason: "active_tab_changed",
  });
  assert.equal(controller.snapshot().epoch, initialEpoch);
  assert.equal(commandsFor(commands, "stop-queue-transport").length, stopQueueCount);
  const stops = commandsFor(commands, "stop-fast").slice(-1);
  assert.deepEqual(stops.map((item) => item.paneID), ["a-1"]);
  for (const stop of stops) {
    controller.fastStopped(stop.pane, {
      eventEpoch: stop.epoch,
      attemptID: stop.attemptID,
      reason: "tab_priority_changed",
    });
  }
  assert.deepEqual(controller.snapshot().fastSlots.map((slot) => slot?.paneID), ["b-1"]);
  assert.equal(controller.snapshot().queue.state, "open");
});

test("a newly activated tab promotes its panes after delayed measurement", () => {
  const panes = [
    pane("a-1", { initializationOrder: 1 }),
    pane("a-2", { initializationOrder: 2 }),
    pane("b-1", { tabID: "tab-b", visible: false, measured: false, initializationOrder: 3 }),
    pane("b-2", { tabID: "tab-b", visible: false, measured: false, initializationOrder: 4 }),
  ];
  const { controller, commands } = bootstrap({ panes });
  finishBootstrap(controller, commands);
  panes[0].topologyVisible = false;
  panes[1].topologyVisible = false;
  panes[2].topologyVisible = true;
  panes[3].topologyVisible = true;
  controller.refresh({
    targetName: "instance-a",
    tabID: "tab-b",
    panes,
    activePane: panes[2],
    initializationOrderReady: true,
  });
  controller.paneMeasured(panes[2]);
  controller.paneMeasured(panes[3]);
  const stops = commandsFor(commands, "stop-fast").slice(-1);
  assert.equal(stops.length, 1);
  assert.deepEqual(stops.map((item) => item.paneID), ["a-1"]);
});

test("target switch is the boundary that resets physical transports and epoch", () => {
  const panes = [pane("one", { initializationOrder: 1 }), pane("two", { initializationOrder: 2 })];
  const { controller, commands } = bootstrap({ panes });
  const first = commandsFor(commands, "start-fast")[0];
  const oldEpoch = first.epoch;
  controller.refresh({
    targetName: "instance-b",
    tabID: "tab-a",
    panes,
    activePane: panes[0],
    initializationOrderReady: true,
  });
  assert.notEqual(controller.snapshot().epoch, oldEpoch);
  assert.equal(commandsFor(commands, "reset-fast-transports").length >= 1, true);
  assert.equal(controller.fastRendered(first.pane, { eventEpoch: first.epoch, attemptID: first.attemptID }), false);
});

test("Fast failure remains retryable without losing its logical assignment", () => {
  const panes = [pane("one", { initializationOrder: 1 }), pane("two", { initializationOrder: 2 }), pane("three", { initializationOrder: 3 })];
  const { controller, commands } = bootstrap({ panes });
  const first = commandsFor(commands, "start-fast")[0];
  assert.equal(controller.fastFailed(first.pane, {
    eventEpoch: first.epoch,
    attemptID: first.attemptID,
    reason: "network_failure",
  }), true);
  assert.equal(controller.snapshot().fastSlots[0].paneID, "one");
  assert.equal(controller.snapshot().fastSlots[0].state, "starting");
  assert.equal(controller.snapshot().panes.find((item) => item.paneID === "one").state, "retrying");
});

test("promotion replaces one logical Fast binding while Queue remains open", () => {
  const panes = [
    pane("one", { interaction: 40, initializationOrder: 1 }),
    pane("two", { interaction: 30, initializationOrder: 2 }),
    pane("three", { interaction: 10, initializationOrder: 3 }),
  ];
  const { controller, commands } = bootstrap({ panes, activePane: panes[0] });
  finishBootstrap(controller, commands);
  assert.equal(controller.promote(panes[2]), true);
  const stop = commandsFor(commands, "stop-fast").at(-1);
  assert.equal(commandsFor(commands, "stop-queue-transport").length, 0);
  controller.fastStopped(stop.pane, {
    eventEpoch: stop.epoch,
    attemptID: stop.attemptID,
    reason: "promote_to_fast",
  });
  assert.equal(controller.snapshot().fastSlots.some((slot) => slot?.paneID === "three"), true);
  assert.equal(controller.snapshot().queue.state, "open");
});

test("removing all non-Fast panes stops the retained Queue transport", () => {
  const panes = [
    pane("one", { initializationOrder: 1 }),
    pane("two", { initializationOrder: 2 }),
    pane("three", { initializationOrder: 3 }),
  ];
  const { controller, commands } = bootstrap({ panes });
  finishBootstrap(controller, commands);
  assert.equal(controller.snapshot().queue.state, "open");

  controller.refresh({
    targetName: "instance-a",
    tabID: "tab-a",
    panes: [panes[0]],
    activePane: panes[0],
    initializationOrderReady: true,
    reason: "workspace_pruned",
  });

  const stop = commandsFor(commands, "stop-queue-transport").at(-1);
  assert.ok(stop);
  assert.equal(stop.reason, "workspace_pruned");
  assert.equal(controller.snapshot().queue.state, "closed");
  assert.deepEqual(controller.snapshot().fastSlots.map((slot) => slot?.paneID), ["one"]);

  controller.refresh({
    targetName: "instance-a",
    tabID: "tab-a",
    panes: [panes[0], panes[1]],
    activePane: panes[0],
    initializationOrderReady: true,
    reason: "new_tab",
  });
  assert.equal(controller.snapshot().queue.state, "starting");
  assert.equal(commandsFor(commands, "start-queue-transport").length, 2);
});

test("a preempted Fast pane is reassigned when its replacement is removed", () => {
  const panes = [
    pane("one", { interaction: 1, initializationOrder: 1 }),
    pane("two", { interaction: 2, initializationOrder: 2 }),
    pane("three", { interaction: 3, initializationOrder: 3 }),
  ];
  const { controller, commands } = bootstrap({ panes, activePane: panes[0] });
  finishBootstrap(controller, commands);
  assert.equal(controller.promote(panes[2]), true);
  const promoteStop = commandsFor(commands, "stop-fast").at(-1);
  controller.fastStopped(promoteStop.pane, {
    eventEpoch: promoteStop.epoch,
    attemptID: promoteStop.attemptID,
    reason: "promote_to_fast",
  });
  const promotedStart = commandsFor(commands, "start-fast").at(-1);
  assert.equal(promotedStart.paneID, "three");

  controller.refresh({
    targetName: "instance-a",
    tabID: "tab-a",
    panes: [panes[0]],
    activePane: panes[0],
    initializationOrderReady: true,
    reason: "workspace_pruned",
  });
  assert.equal(controller.snapshot().queue.state, "open");
  const removedStop = commandsFor(commands, "stop-fast").at(-1);
  assert.equal(removedStop.paneID, "three");

  controller.fastStopped(removedStop.pane, {
    eventEpoch: removedStop.epoch,
    attemptID: removedStop.attemptID,
    reason: "pane_removed",
  });
  assert.equal(controller.snapshot().queue.state, "closed");
  assert.equal(commandsFor(commands, "start-fast").at(-1).paneID, "one");
});

test("removing the Fast pane keeps Queue open while other workspace panes remain", () => {
  const panes = [
    pane("one", { initializationOrder: 1 }),
    pane("two", { initializationOrder: 2 }),
    pane("three", { initializationOrder: 3 }),
  ];
  const { controller, commands } = bootstrap({ panes });
  finishBootstrap(controller, commands);
  const beforeStops = commandsFor(commands, "stop-queue-transport").length;
  const fast = commandsFor(commands, "start-fast")[0];
  controller.refresh({
    targetName: "instance-a",
    tabID: "tab-a",
    panes: panes.slice(1),
    activePane: panes[1],
    initializationOrderReady: true,
    reason: "fast_pane_removed",
  });
  assert.equal(controller.snapshot().queue.state, "open");
  assert.equal(commandsFor(commands, "stop-queue-transport").length, beforeStops);
  const stopFast = commandsFor(commands, "stop-fast").at(-1);
  assert.equal(stopFast.paneID, "one");
  controller.fastStopped(fast.pane, {
    eventEpoch: fast.epoch,
    attemptID: fast.attemptID,
    reason: "pane_removed",
  });
  assert.equal(controller.snapshot().fastSlots[0]?.paneID, "two");
});

test("a sole Queue pane is promoted to Fast before Queue is closed", () => {
  const panes = [
    pane("one", { initializationOrder: 1 }),
    pane("two", { initializationOrder: 2 }),
  ];
  const { controller, commands } = bootstrap({ panes });
  finishBootstrap(controller, commands);
  const first = commandsFor(commands, "start-fast")[0];

  controller.refresh({
    targetName: "instance-a",
    tabID: "tab-a",
    panes: [panes[1]],
    activePane: panes[1],
    initializationOrderReady: true,
    reason: "fast_pane_removed",
  });
  const stop = commandsFor(commands, "stop-fast").at(-1);
  assert.equal(stop.paneID, "one");
  assert.equal(controller.snapshot().queue.state, "open");

  controller.fastStopped(first.pane, {
    eventEpoch: first.epoch,
    attemptID: first.attemptID,
    reason: "pane_removed",
  });
  assert.equal(controller.snapshot().fastSlots[0]?.paneID, "two");
  assert.equal(controller.snapshot().queue.state, "closed");
  assert.equal(commandsFor(commands, "stop-queue-transport").length, 1);
});

test("Queue physical failure starts one transport retry and keeps pane candidates", () => {
  const panes = [pane("one", { initializationOrder: 1 }), pane("two", { initializationOrder: 2 }), pane("three", { initializationOrder: 3 })];
  const { controller, commands } = bootstrap({ panes });
  const { queue } = finishBootstrap(controller, commands);
  const before = controller.snapshot();
  const resetFastCount = commandsFor(commands, "reset-fast-transports").length;
  assert.equal(controller.queueTransportClosed({
    eventEpoch: queue.epoch,
    attemptID: queue.attemptID,
    retryable: true,
  }), true);
  assert.equal(commandsFor(commands, "start-queue-transport").length, 2);
  const after = controller.snapshot();
  assert.equal(after.epoch, before.epoch);
  assert.deepEqual(after.fastSlots.map((slot) => slot?.paneID), before.fastSlots.map((slot) => slot?.paneID));
  assert.deepEqual(after.fastSlots.map((slot) => slot?.state), ["ready"]);
  assert.equal(after.queue.state, "starting");
  assert.equal(commandsFor(commands, "transport-failure").length, 0);
  assert.equal(commandsFor(commands, "reset-fast-transports").length, resetFastCount);
});

test("one Fast physical failure retries only its logical slot and preserves Queue", () => {
  const panes = [pane("one", { initializationOrder: 1 }), pane("two", { initializationOrder: 2 }), pane("three", { initializationOrder: 3 })];
  const { controller, commands } = bootstrap({ panes });
  const { first } = finishBootstrap(controller, commands);
  const before = controller.snapshot();

  assert.equal(controller.fastTransportClosed({
    eventEpoch: first.epoch,
    slot: first.slot,
    attemptID: first.attemptID,
  }), true);

  const after = controller.snapshot();
  assert.equal(after.epoch, before.epoch);
  assert.equal(after.fastSlots[0].paneID, "one");
  assert.equal(after.fastSlots[0].state, "starting");
  assert.equal(after.fastSlots[0].physicalReady, false);
  assert.equal(after.queue.state, "open");
  assert.equal(commandsFor(commands, "transport-failure").length, 0);
  assert.equal(commandsFor(commands, "stop-queue-transport").length, 0);
  assert.equal(commandsFor(commands, "pane-state").at(-1).state, "retrying");
});

test("Queue starts only after Fast replay ready and then starts candidates", () => {
  const panes = [pane("one", { initializationOrder: 1 }), pane("two", { initializationOrder: 2 }), pane("three", { initializationOrder: 3 })];
  const { controller, commands } = bootstrap({ panes });
  const first = commandsFor(commands, "start-fast")[0];
  controller.fastTransportOpened({ eventEpoch: first.epoch, slot: first.slot, attemptID: first.attemptID });
  assert.equal(commandsFor(commands, "start-queue-transport").length, 0);
  assert.equal(controller.snapshot().phase, "fast_starting");
  assert.equal(controller.isQueueAllowed(), false);

  controller.fastRendered(first.pane, { eventEpoch: first.epoch, attemptID: first.attemptID });
  const queue = commandsFor(commands, "start-queue-transport")[0];
  controller.queueTransportOpened({ eventEpoch: queue.epoch, attemptID: queue.attemptID });
  assert.equal(controller.snapshot().phase, "running");
  assert.equal(controller.isQueueAllowed(), true);
  assert.deepEqual(commandsFor(commands, "sync-queue-candidates").at(-1).paneIDs, ["two", "three"]);
});

test("physical transport failure clears stale leases and restarts the full topology", () => {
  const panes = [
    pane("one", { initializationOrder: 1 }),
    pane("two", { initializationOrder: 2 }),
    pane("three", { initializationOrder: 3 }),
  ];
  const { controller, commands } = bootstrap({ panes });
  finishBootstrap(controller, commands);
  const before = controller.snapshot();
  assert.equal(before.queue.state, "open");

  assert.equal(controller.transportFailure("network_resume"), true);
  const failed = controller.snapshot();
  assert.equal(failed.epoch, before.epoch + 1);
  assert.deepEqual(failed.fastSlots, [null]);
  assert.equal(failed.queue.state, "closed");
  assert.equal(commandsFor(commands, "transport-failure").length, 1);

  controller.refresh({
    targetName: "instance-a",
    tabID: "tab-a",
    panes,
    activePane: panes[0],
    initializationOrderReady: true,
    reason: "transport_recovery",
  });
  const recoveryFirst = commandsFor(commands, "start-fast").at(-1);
  assert.equal(recoveryFirst.paneID, "one");
  controller.fastRendered(recoveryFirst.pane, {
    eventEpoch: recoveryFirst.epoch,
    attemptID: recoveryFirst.attemptID,
  });
  assert.equal(commandsFor(commands, "start-fast").at(-1).paneID, "one");
});
