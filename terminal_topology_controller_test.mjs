import assert from "node:assert/strict";
import test from "node:test";

import { createTerminalTopologyController } from "./runtime/static/terminal_topology_controller.js";

const pane = (id, { measured = true, visible = true, interaction = 0 } = {}) => ({
  id,
  measured,
  visible,
  lastUserInteractionAt: interaction,
});

const commandsFor = (commands, type) => commands.filter((command) => command.type === type);

const bootstrap = ({ panes, activePane = panes[0], commands = [] } = {}) => {
  const controller = createTerminalTopologyController({ onCommand: (command) => commands.push(command) });
  controller.refresh({ targetName: "instance-a", tabID: "tab-a", panes, activePane });
  return { controller, commands };
};

test("32 panes wait for Fast A then Fast B before Queue transport", () => {
  const panes = Array.from({ length: 32 }, (_, index) => pane(`pane-${index + 1}`));
  const { controller, commands } = bootstrap({ panes });

  const first = commandsFor(commands, "start-fast")[0];
  assert.equal(first.slot, 0);
  assert.equal(commandsFor(commands, "start-queue-transport").length, 0);
  controller.fastRendered(first.pane, { eventEpoch: first.epoch, attemptID: first.attemptID });
  const fast = commandsFor(commands, "start-fast");
  assert.equal(fast.length, 2);
  assert.equal(fast[1].slot, 1);
  assert.equal(commandsFor(commands, "start-queue-transport").length, 0);
  controller.fastRendered(fast[1].pane, { eventEpoch: fast[1].epoch, attemptID: fast[1].attemptID });
  const queue = commandsFor(commands, "start-queue-transport");
  assert.equal(queue.length, 1);
  assert.equal(controller.snapshot().phase, "queue_starting");
  controller.queueTransportOpened({ eventEpoch: queue[0].epoch, attemptID: queue[0].attemptID });
  assert.equal(commandsFor(commands, "sync-queue-candidates").at(-1).panes.length, 30);
  assert.equal(controller.snapshot().fastSlots.filter(Boolean).length, 2);
});

test("repeated render events cannot churn a Fast slot", () => {
  const panes = [pane("one"), pane("two"), pane("three")];
  const { controller, commands } = bootstrap({ panes });
  const first = commandsFor(commands, "start-fast")[0];
  assert.equal(controller.fastRendered(first.pane, { eventEpoch: first.epoch, attemptID: first.attemptID }), true);
  assert.equal(controller.fastRendered(first.pane, { eventEpoch: first.epoch, attemptID: first.attemptID }), true);
  assert.equal(commandsFor(commands, "stop-fast").length, 0);
  assert.equal(commandsFor(commands, "start-fast").length, 2);
});

test("delayed measurement has an explicit wait state and joins Queue without click", () => {
  const panes = [pane("one"), pane("two"), pane("later", { measured: false })];
  const { controller, commands } = bootstrap({ panes });
  const first = commandsFor(commands, "start-fast")[0];
  controller.fastRendered(first.pane, { eventEpoch: first.epoch, attemptID: first.attemptID });
  const second = commandsFor(commands, "start-fast")[1];
  controller.fastRendered(second.pane, { eventEpoch: second.epoch, attemptID: second.attemptID });
  assert.equal(commandsFor(commands, "start-queue-transport").length, 0);
  assert.equal(controller.snapshot().panes.find((item) => item.paneID === "later").state, "awaiting_measurement");
  controller.paneMeasured({ id: "later" });
  const queue = commandsFor(commands, "start-queue-transport")[0];
  assert.ok(queue);
  controller.queueTransportOpened({ eventEpoch: queue.epoch, attemptID: queue.attemptID });
  assert.deepEqual(commandsFor(commands, "sync-queue-candidates").at(-1).paneIDs, ["later"]);
});

test("the active pane must be measurable before Fast A starts", () => {
  const panes = [pane("active", { measured: false }), pane("other", { measured: true })];
  const { controller, commands } = bootstrap({ panes, activePane: panes[0] });
  assert.equal(commandsFor(commands, "start-fast").length, 0);
  assert.equal(controller.snapshot().phase, "awaiting_measurement");
  controller.paneMeasured(panes[0]);
  assert.equal(commandsFor(commands, "start-fast")[0].paneID, "active");
});

test("stale epoch and attempt callbacks are ignored", () => {
  const panes = [pane("one"), pane("two"), pane("three")];
  const { controller, commands } = bootstrap({ panes });
  const first = commandsFor(commands, "start-fast")[0];
  controller.refresh({ targetName: "instance-a", tabID: "tab-b", panes, activePane: panes[0] });
  assert.equal(controller.fastRendered(first.pane, { eventEpoch: first.epoch, attemptID: first.attemptID }), false);
  assert.equal(commandsFor(commands, "start-fast").at(-1).slot, 0);
});

test("Fast failure keeps the same bootstrap pane and phase", () => {
  const panes = [pane("one"), pane("two"), pane("three")];
  const { controller, commands } = bootstrap({ panes });
  const first = commandsFor(commands, "start-fast")[0];
  assert.equal(controller.fastFailed(first.pane, { eventEpoch: first.epoch, attemptID: first.attemptID }), true);
  assert.equal(controller.snapshot().phase, "fast_a_starting");
  assert.equal(controller.snapshot().fastSlots[0].paneID, "one");
  assert.equal(commandsFor(commands, "start-fast").length, 1);
});

test("promotion only stops the LRU Fast and preserves Queue transport", () => {
  const panes = [pane("one", { interaction: 40 }), pane("two", { interaction: 30 }), pane("three", { interaction: 10 })];
  const { controller, commands } = bootstrap({ panes, activePane: panes[0] });
  const first = commandsFor(commands, "start-fast")[0];
  controller.fastRendered(first.pane, { eventEpoch: first.epoch, attemptID: first.attemptID });
  const second = commandsFor(commands, "start-fast")[1];
  controller.fastRendered(second.pane, { eventEpoch: second.epoch, attemptID: second.attemptID });
  const queue = commandsFor(commands, "start-queue-transport")[0];
  controller.queueTransportOpened({ eventEpoch: queue.epoch, attemptID: queue.attemptID });
  assert.equal(controller.promote(panes[2]), true);
  const stop = commandsFor(commands, "stop-fast").at(-1);
  assert.equal(stop.paneID, "two");
  assert.equal(commandsFor(commands, "stop-queue-transport").length, 0);
  controller.fastStopped(stop.pane, { eventEpoch: stop.epoch, attemptID: stop.attemptID, reason: "promote_to_fast" });
  assert.equal(commandsFor(commands, "start-fast").at(-1).paneID, "three");
  assert.equal(controller.snapshot().queue.state, "open");
});
