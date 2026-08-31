import assert from "node:assert/strict";
import test from "node:test";

import { createWorkspaceLayoutController } from "../runtime/static/workspace/index.js";

test("layout controller splits, removes, and collects panes", () => {
  const controller = createWorkspaceLayoutController();
  const tree = { type: "leaf", paneId: "pane-a", size: 100 };

  assert.equal(controller.splitLayout(tree, "pane-a", "vertical", "pane-b"), true);
  assert.deepEqual(controller.collectPaneIds(tree), ["pane-a", "pane-b"]);
  assert.equal(controller.removePaneFromLayout(tree, "pane-a").paneId, "pane-b");
  assert.equal(controller.dispose(), true);
  assert.equal(controller.isDisposed(), true);
});

test("direction selection only activates a geometrically valid neighbor", () => {
  const calls = [];
  const panes = new Map([
    ["active", { id: "active", shellEl: { getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100 }) } }],
    ["right", { id: "right", shellEl: { getBoundingClientRect: () => ({ left: 110, top: 0, right: 210, bottom: 100 }) } }],
    ["diagonal", { id: "diagonal", shellEl: { getBoundingClientRect: () => ({ left: 110, top: 150, right: 210, bottom: 250 }) } }],
  ]);
  const tab = { activePaneId: "active", panes };
  const controller = createWorkspaceLayoutController({
    getCurrentTab: () => tab,
    setActivePane: (_tab, paneId) => calls.push(paneId),
  });

  assert.equal(controller.selectPaneInDirection("right"), true);
  assert.deepEqual(calls, ["right"]);
  assert.equal(controller.selectPaneInDirection("down"), false);
});
