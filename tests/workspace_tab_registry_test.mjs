import assert from "node:assert/strict";
import test from "node:test";

import { createWorkspaceTabRegistry } from "../runtime/static/workspace/index.js";

test("tab registry owns IDs, map entries, and the active tab snapshot", () => {
  const registry = createWorkspaceTabRegistry();
  const first = registry.allocateTabId();
  const explicit = registry.allocateTabId("tab-8");
  assert.equal(first, "tab-1");
  assert.equal(explicit, "tab-8");
  registry.set(first, { id: first });
  registry.set(explicit, { id: explicit });
  assert.equal(registry.size(), 2);
  assert.equal(registry.setActiveTabId(explicit), explicit);
  assert.equal(registry.getActiveTabId(), explicit);
  assert.equal(registry.dispose(), true);
  assert.equal(registry.size(), 0);
  assert.equal(registry.dispose(), false);
});
