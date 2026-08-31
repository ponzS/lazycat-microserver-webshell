import assert from "node:assert/strict";
import test from "node:test";

import {
  createInstancesController,
  instanceDisplayName,
  instanceSelector,
  isClientInstanceName,
  readInstanceTargetName,
} from "../runtime/static/instances/index.js";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
};

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
});

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener, options) {
    const listeners = this.listeners.get(type) || [];
    listeners.push({ listener, options });
    this.listeners.set(type, listeners);
  }

  emit(type, event = {}) {
    for (const { listener } of [...(this.listeners.get(type) || [])]) {
      listener({ target: this, ...event });
    }
  }

  listenerCount(type) {
    return (this.listeners.get(type) || []).length;
  }

  removeEventListener(type, listener, options) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter((entry) => (
      entry.listener !== listener || entry.options !== options
    )));
  }
}

const createFakeView = ({ elements = {} } = {}) => {
  const state = {
    disposed: 0,
    feedback: [],
    homeBusy: [],
    open: false,
    renders: [],
    selectedName: "",
  };
  return {
    state,
    view: {
      elements,
      closeSwitcher() {
        state.open = false;
      },
      containsTarget(target) {
        return target === elements.root;
      },
      dispose() {
        state.disposed += 1;
        state.open = false;
      },
      isAvailable: () => true,
      isSwitcherOpen: () => state.open,
      openSwitcher() {
        state.open = true;
      },
      renderList(options) {
        state.renders.push({
          activeName: options.activeName,
          instances: options.instances.map((item) => ({ ...item })),
        });
      },
      selectedNameFromEvent() {
        return state.selectedName;
      },
      setFeedback(message) {
        state.feedback.push(String(message || ""));
      },
      setHomeBusy(busy) {
        state.homeBusy.push(busy === true);
      },
    },
  };
};

const noLifecycle = () => ({ dispose() {}, start() {} });

const staticNavigation = (homeURL = "https://lightos.example.test/home") => ({
  dispose() {},
  loadHomeURL: async () => homeURL,
  snapshot: () => ({ cached: true, loading: false }),
});

test("instance model keeps selectors explicit and client-aware", () => {
  assert.equal(instanceSelector({ selector: "explicit@target" }), "explicit@target");
  assert.equal(instanceSelector({ client_instance_id: "desktop-a" }), "client:desktop-a");
  assert.equal(instanceSelector({ name: "alpha", owner_deploy_id: "deploy-a" }), "alpha@deploy-a");
  assert.equal(instanceSelector({ name: "alpha" }), "");
  assert.equal(instanceDisplayName({ client_instance_id: "desktop-a" }), "client:desktop-a");
  assert.equal(isClientInstanceName("client:desktop-a"), true);
  assert.equal(isClientInstanceName("alpha@deploy-a"), false);
  assert.equal(readInstanceTargetName(new URLSearchParams("target=client%3Adesktop-a&name=ignored")), "client:desktop-a");
});

test("controller owns an immutable list snapshot and delegates workspace switching", async () => {
  let activeName = "alpha@deploy-a";
  const switchGate = deferred();
  const switches = [];
  const { state, view } = createFakeView();
  const controller = createInstancesController({
    fetchImpl: async () => response(200, JSON.stringify([
      { name: "alpha", owner_deploy_id: "deploy-a", status: "running" },
      { name: "Desktop", client_instance_id: "desktop-a", status: "running" },
    ])),
    view,
    lifecycleFactory: noLifecycle,
    navigation: staticNavigation(),
    getActiveName: () => activeName,
    onSwitchTarget: (name, options) => {
      activeName = name;
      switches.push({ name, options });
      return switchGate.promise;
    },
  });

  controller.start();
  await controller.load();
  assert.equal(controller.getActiveDisplayName(), "alpha");
  const firstSnapshot = controller.snapshot();
  firstSnapshot.instances[0].name = "mutated";
  assert.equal(controller.snapshot().instances[0].name, "alpha");

  const switching = controller.switchTo("client:desktop-a", { replaceURL: true });
  assert.equal(activeName, "client:desktop-a");
  assert.deepEqual(switches, [{
    name: "client:desktop-a",
    options: { replaceURL: true, updateURL: true },
  }]);
  assert.equal(state.renders.at(-1).activeName, "client:desktop-a");
  switchGate.resolve();
  await switching;
  controller.dispose();
});

test("refresh selects the first running target without taking workspace ownership", async () => {
  let activeName = "";
  const setNames = [];
  const locations = [];
  const { view } = createFakeView();
  const controller = createInstancesController({
    fetchImpl: async () => response(200, JSON.stringify([
      { name: "stopped", owner_deploy_id: "deploy-a", status: "stopped" },
      { name: "running", owner_deploy_id: "deploy-b", status: "running" },
    ])),
    view,
    lifecycleFactory: noLifecycle,
    navigation: staticNavigation(),
    getActiveName: () => activeName,
    setActiveName: (name) => {
      activeName = name;
      setNames.push(name);
    },
    updateLocation: (name, options) => locations.push({ name, options }),
  });

  await controller.refresh();
  assert.equal(activeName, "running@deploy-b");
  assert.deepEqual(setNames, ["running@deploy-b"]);
  assert.deepEqual(locations, [{
    name: "running@deploy-b",
    options: { replace: true, tabId: "" },
  }]);
  controller.dispose();
});

test("switcher loads single-flight and ignores feedback after close or dispose", async () => {
  const request = deferred();
  let fetches = 0;
  let prepared = 0;
  const { state, view } = createFakeView();
  const controller = createInstancesController({
    fetchImpl: () => {
      fetches += 1;
      return request.promise;
    },
    view,
    lifecycleFactory: noLifecycle,
    navigation: staticNavigation(),
    prepareSwitcherOpen: () => {
      prepared += 1;
    },
  });

  const first = controller.openSwitcher();
  const second = controller.openSwitcher();
  assert.equal(fetches, 1);
  assert.equal(prepared, 2);
  controller.closeSwitcher();
  request.resolve(response(200, "[]"));
  await Promise.all([first, second]);
  assert.equal(state.open, false);
  assert.deepEqual(state.feedback, ["", ""]);

  controller.dispose();
  assert.equal(state.disposed, 1);
  assert.equal(controller.snapshot().instances.length, 0);

  const late = deferred();
  const lateView = createFakeView();
  const lateController = createInstancesController({
    view: lateView.view,
    lifecycleFactory: noLifecycle,
    loader: { dispose() {}, load: () => late.promise },
    navigation: staticNavigation(),
  });
  const lateLoad = lateController.load();
  lateController.dispose();
  late.resolve([{ name: "late", owner_deploy_id: "deploy-late", status: "running" }]);
  await assert.rejects(lateLoad, { name: "AbortError" });
  assert.equal(lateController.snapshot().instances.length, 0);
});

test("home navigation uses Provider URL, caches it, and rolls back failures", async () => {
  let fetches = 0;
  const assigned = [];
  const events = [];
  const toasts = [];
  const fakeWindow = {
    location: {
      href: "https://webshell.example.test/app/?name=alpha",
      search: "?name=alpha",
      assign(url) {
        assigned.push(url);
      },
    },
  };
  const { state, view } = createFakeView();
  const controller = createInstancesController({
    windowObject: fakeWindow,
    fetchImpl: async (url) => {
      fetches += 1;
      assert.equal(url, "./api/lightos-admin-info");
      return response(200, JSON.stringify({ home_url: "https://lightos.example.test/desktop" }));
    },
    view,
    lifecycleFactory: noLifecycle,
    loader: { dispose() {}, load: async () => [] },
    prepareHomeNavigation: () => events.push("prepare"),
    commitHomeNavigation: () => events.push("commit"),
    rollbackHomeNavigation: () => events.push("rollback"),
    getMobileRemoteDesktopEnabled: () => true,
    showToast: (message) => toasts.push(message),
  });

  assert.equal(await controller.navigateHome(), true);
  assert.equal(await controller.navigateHome(), true);
  assert.equal(fetches, 1);
  assert.equal(assigned.length, 2);
  assert.equal(new URL(assigned[0]).searchParams.get("mobile_remote_desktop"), "1");
  assert.deepEqual(events, ["prepare", "commit", "prepare", "commit"]);
  assert.deepEqual(toasts, []);
  assert.deepEqual(state.homeBusy, [true, true]);
  controller.dispose();

  const failed = createFakeView();
  const failedController = createInstancesController({
    windowObject: fakeWindow,
    fetchImpl: async () => response(503, "admin is starting"),
    view: failed.view,
    lifecycleFactory: noLifecycle,
    loader: { dispose() {}, load: async () => [] },
    prepareHomeNavigation: () => events.push("prepare-failed"),
    rollbackHomeNavigation: () => events.push("rollback-failed"),
    showToast: (message) => toasts.push(message),
  });
  assert.equal(await failedController.navigateHome(), false);
  assert.deepEqual(failed.state.homeBusy, [true, false]);
  assert.equal(toasts.at(-1), "admin is starting");
  assert.deepEqual(events.slice(-2), ["prepare-failed", "rollback-failed"]);
  failedController.dispose();
});

test("lifecycle owns instance listeners and removes them on dispose", () => {
  const documentObject = new FakeEventTarget();
  const windowObject = new FakeEventTarget();
  windowObject.location = {
    href: "https://webshell.example.test/app/?name=alpha%40deploy-a",
    search: "?name=alpha%40deploy-a",
  };
  const elements = {
    button: new FakeEventTarget(),
    homeButton: new FakeEventTarget(),
    list: new FakeEventTarget(),
    root: {},
  };
  const { state, view } = createFakeView({ elements });
  const controller = createInstancesController({
    documentObject,
    windowObject,
    view,
    loader: { dispose() {}, load: async () => [] },
    navigation: staticNavigation(),
    getActiveName: () => "alpha@deploy-a",
  });

  controller.start();
  assert.equal(elements.button.listenerCount("click"), 1);
  assert.equal(elements.list.listenerCount("click"), 1);
  assert.equal(elements.homeButton.listenerCount("click"), 1);
  assert.equal(documentObject.listenerCount("pointerdown"), 1);
  assert.equal(documentObject.listenerCount("keydown"), 1);
  assert.equal(windowObject.listenerCount("popstate"), 1);

  elements.button.emit("click");
  assert.equal(state.open, true);
  documentObject.emit("keydown", { key: "Escape" });
  assert.equal(state.open, false);

  controller.dispose();
  assert.equal(elements.button.listenerCount("click"), 0);
  assert.equal(elements.list.listenerCount("click"), 0);
  assert.equal(elements.homeButton.listenerCount("click"), 0);
  assert.equal(documentObject.listenerCount("pointerdown"), 0);
  assert.equal(documentObject.listenerCount("keydown"), 0);
  assert.equal(windowObject.listenerCount("popstate"), 0);
});
