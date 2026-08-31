import assert from "node:assert/strict";
import test from "node:test";

import { createAppDOMRegistry } from "../runtime/static/app/index.js";

const ids = [
  "tabs", "newTab", "mobileActiveTabTitle", "terminalArea", "emptyState", "emptyStateAction",
  "startupErrorPanel", "startupErrorText", "networkBanner", "toast",
  "dialogBackdrop", "dialogPanel", "dialogTitle", "dialogMessage", "dialogInput", "dialogCancel", "dialogOK",
  "mobileShortcuts", "mobileCloseConfirmSheet", "mobileCloseConfirmScrim", "mobileCloseConfirmHandle",
  "mobileCloseConfirmTitle", "mobileCloseConfirmMessage", "mobileCloseConfirmActions",
  "mobileCloseConfirmCancel", "mobileCloseConfirmOK",
];

const createDocument = (includeHost = true) => {
  const elements = new Map(ids.map((id) => [id, { id }]));
  if (!includeHost) {
    elements.delete("tabs");
  }
  const requested = [];
  return {
    documentObject: {
      getElementById(id) {
        requested.push(id);
        return elements.get(id) || null;
      },
    },
    requested,
  };
};

test("DOM registry groups and freezes page references", () => {
  const harness = createDocument();
  const registry = createAppDOMRegistry(harness);
  assert.equal(registry.workspace.tabs.id, "tabs");
  assert.equal(registry.dialog.ok.id, "dialogOK");
  assert.equal(registry.mobile.closeConfirmSheet.id, "mobileCloseConfirmSheet");
  assert.equal(registry.startup.toast.id, "toast");
  assert.equal(Object.isFrozen(registry), true);
  assert.equal(Object.isFrozen(registry.workspace), true);
  assert.equal(harness.requested.length, ids.length);
});

test("DOM registry rejects a page without the required shell", () => {
  const harness = createDocument(false);
  assert.throws(() => createAppDOMRegistry(harness), /webshell host not found/);
});
