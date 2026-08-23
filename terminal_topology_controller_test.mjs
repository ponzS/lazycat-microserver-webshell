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
  const second = commandsFor(commands, "start-fast")[1];
  controller.fastTransportOpened({ eventEpoch: second.epoch, slot: second.slot, attemptID: second.attemptID });
  controller.fastRendered(second.pane, { eventEpoch: second.epoch, attemptID: second.attemptID });
  const queue = commandsFor(commands, "start-queue-transport")[0];
  if (queue) {
    controller.queueTransportOpened({ eventEpoch: queue.epoch, attemptID: queue.attemptID });
  }
  return { first, second, queue };
};

test("global startup waits for both physical Fast transports before one Queue transport", () => {
  const panes = Array.from({ length: 32 }, (_, index) => pane(`pane-${index + 1}`, {
    initializationOrder: index + 1,
  }));
  const { controller, commands } = bootstrap({ panes });

  const first = commandsFor(commands, "start-fast")[0];
  assert.equal(first.paneID, "pane-1");
  assert.equal(commandsFor(commands, "start-queue-transport").length, 0);
  controller.fastTransportOpened({ eventEpoch: first.epoch, slot: first.slot, attemptID: first.attemptID });
  controller.fastRendered(first.pane, { eventEpoch: first.epoch, attemptID: first.attemptID });
  const second = commandsFor(commands, "start-fast")[1];
  assert.equal(second.paneID, "pane-2");
  assert.equal(commandsFor(commands, "start-queue-transport").length, 0);
  controller.fastTransportOpened({ eventEpoch: second.epoch, slot: second.slot, attemptID: second.attemptID });
  const queue = commandsFor(commands, "start-queue-transport")[0];
  assert.ok(queue);
  controller.fastRendered(second.pane, { eventEpoch: second.epoch, attemptID: second.attemptID });
  controller.queueTransportOpened({ eventEpoch: queue.epoch, attemptID: queue.attemptID });
  assert.deepEqual(commandsFor(commands, "sync-queue-candidates").at(-1).paneIDs, panes.slice(2).map((item) => item.id));
});

test("physical Fast OPEN starts Queue without waiting for a hidden Fast Canvas frame", () => {
  const panes = [
    pane("a-1", { initializationOrder: 1 }),
    pane("b-1", { tabID: "tab-b", visible: false, measured: false, connectable: true, initializationOrder: 2 }),
    pane("c-1", { tabID: "tab-c", visible: false, measured: false, connectable: true, initializationOrder: 3 }),
  ];
  const { controller, commands } = bootstrap({ panes });
  const first = commandsFor(commands, "start-fast")[0];
  controller.fastTransportOpened({ eventEpoch: first.epoch, slot: first.slot, attemptID: first.attemptID });
  controller.fastRendered(first.pane, { eventEpoch: first.epoch, attemptID: first.attemptID });
  const second = commandsFor(commands, "start-fast")[1];
  controller.fastTransportOpened({ eventEpoch: second.epoch, slot: second.slot, attemptID: second.attemptID });
  assert.ok(commandsFor(commands, "start-queue-transport").length === 1);
  assert.equal(controller.snapshot().queue.state, "starting");
});

test("a late workspace pane rechecks physical Fast readiness and starts Queue", () => {
  const initialPanes = [
    pane("a-1", { initializationOrder: 1 }),
    pane("a-2", { initializationOrder: 2 }),
  ];
  const extraPane = pane("b-1", {
    tabID: "tab-b",
    visible: false,
    initializationOrder: 3,
  });
  const { controller, commands } = bootstrap({ panes: initialPanes });
  const first = commandsFor(commands, "start-fast")[0];
  controller.fastRendered(first.pane, { eventEpoch: first.epoch, attemptID: first.attemptID });
  const second = commandsFor(commands, "start-fast")[1];
  controller.fastTransportOpened({ eventEpoch: first.epoch, slot: first.slot, attemptID: first.attemptID });
  controller.fastTransportOpened({ eventEpoch: second.epoch, slot: second.slot, attemptID: second.attemptID });
  assert.equal(commandsFor(commands, "start-queue-transport").length, 0);

  controller.refresh({
    targetName: "instance-a",
    tabID: "tab-a",
    panes: [...initialPanes, extraPane],
    activePane: initialPanes[0],
    initializationOrderReady: true,
  });

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
  assert.deepEqual(commandsFor(commands, "sync-queue-candidates").at(-1).paneIDs, ["b-1", "b-2"]);
});

test("cold startup does not let an unmeasured background pane delay Queue after Fast B", () => {
  const panes = [
    pane("a-1", { initializationOrder: 1 }),
    pane("b-1", { tabID: "tab-b", visible: false, measured: false, connectable: true, initializationOrder: 2 }),
    pane("c-1", { tabID: "tab-c", visible: false, measured: false, connectable: true, initializationOrder: 3 }),
  ];
  const { controller, commands } = bootstrap({ panes });
  const first = commandsFor(commands, "start-fast")[0];
  controller.fastTransportOpened({ eventEpoch: first.epoch, slot: first.slot, attemptID: first.attemptID });
  controller.fastRendered(first.pane, { eventEpoch: first.epoch, attemptID: first.attemptID });
  const second = commandsFor(commands, "start-fast")[1];
  assert.equal(second.paneID, "b-1");
  controller.fastTransportOpened({ eventEpoch: second.epoch, slot: second.slot, attemptID: second.attemptID });
  controller.fastRendered(second.pane, { eventEpoch: second.epoch, attemptID: second.attemptID });
  const queue = commandsFor(commands, "start-queue-transport")[0];
  assert.ok(queue, "Queue must be created after both Fast slots are ready");
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
  assert.deepEqual(controller.snapshot().fastSlots.map((slot) => slot?.paneID), ["a-1", "a-2"]);
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
  const stops = commandsFor(commands, "stop-fast").slice(-2);
  assert.deepEqual(stops.map((item) => item.paneID).sort(), ["a-1", "a-2"]);
  for (const stop of stops) {
    controller.fastStopped(stop.pane, {
      eventEpoch: stop.epoch,
      attemptID: stop.attemptID,
      reason: "tab_priority_changed",
    });
  }
  assert.deepEqual(controller.snapshot().fastSlots.map((slot) => slot?.paneID), ["b-1", "b-2"]);
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
  const stops = commandsFor(commands, "stop-fast").slice(-2);
  assert.equal(stops.length, 2);
  assert.deepEqual(stops.map((item) => item.paneID).sort(), ["a-1", "a-2"]);
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
  assert.equal(commandsFor(commands, "reset-fast-transports").length >= 2, true);
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

test("Queue physical failure starts one transport retry and keeps pane candidates", () => {
  const panes = [pane("one", { initializationOrder: 1 }), pane("two", { initializationOrder: 2 }), pane("three", { initializationOrder: 3 })];
  const { controller, commands } = bootstrap({ panes });
  const { queue } = finishBootstrap(controller, commands);
  assert.equal(controller.queueTransportClosed({
    eventEpoch: queue.epoch,
    attemptID: queue.attemptID,
    retryable: true,
  }), true);
  assert.equal(commandsFor(commands, "start-queue-transport").length, 2);
  assert.equal(controller.snapshot().queue.state, "starting");
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
  assert.deepEqual(failed.fastSlots, [null, null]);
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
  const recoverySecond = commandsFor(commands, "start-fast").at(-1);
  assert.equal(recoverySecond.paneID, "two");
});
