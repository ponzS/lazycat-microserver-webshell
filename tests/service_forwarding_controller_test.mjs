import assert from "node:assert/strict";
import test from "node:test";

import { createServiceForwardingController } from "../runtime/static/service_forwarding/index.js";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
};

const settle = async () => {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
};

const createFakeView = () => {
  const state = {
    busy: false,
    editor: null,
    editorOpen: false,
    focusCount: 0,
    form: {
      protocol: "https",
      host: "::1",
      port: "8443",
      path: "?token=1",
      title: "Demo Service",
      subdomain: "demo-service",
      iconFile: null,
      skipAuth: true,
    },
    lastEntries: [],
    lastRenderOptions: null,
    status: [],
    subdomain: "",
    title: "",
  };
  return {
    state,
    view: {
      elements: {},
      focusPort() {
        state.focusCount += 1;
      },
      isAvailable: () => true,
      isEditorOpen: () => state.editorOpen,
      openEditor(options) {
        state.editorOpen = true;
        state.editor = structuredClone(options);
      },
      readForm: () => ({ ...state.form }),
      renderList(entries, options) {
        state.lastEntries = entries.map((entry) => ({ ...entry }));
        state.lastRenderOptions = { ...options };
      },
      resetEditor() {
        state.editorOpen = false;
        state.editor = null;
      },
      resolveListAction: (event) => event?.action ? { action: event.action, id: event.id } : null,
      setBusy(value) {
        state.busy = value === true;
      },
      setStatus(message, tone = "info") {
        state.status.push({ message, tone });
      },
      setSubdomain(value) {
        state.subdomain = String(value || "");
      },
      stepPort() {},
      subdomainValue: () => state.subdomain,
      titleValue: () => state.title,
    },
  };
};

const createLifecycleHarness = () => {
  let handlers = null;
  let starts = 0;
  let disposes = 0;
  return {
    factory(options) {
      handlers = options.handlers;
      return {
        dispose() {
          disposes += 1;
        },
        start() {
          starts += 1;
        },
      };
    },
    get disposes() {
      return disposes;
    },
    get handlers() {
      return handlers;
    },
    get starts() {
      return starts;
    },
  };
};

test("service forwarding filters records by target and rejects a late refresh from the old target", async () => {
  const firstList = deferred();
  let target = { selector: "alpha@deploy-a", displayName: "Alpha" };
  let listCalls = 0;
  const api = {
    list() {
      listCalls += 1;
      if (listCalls === 1) {
        return firstList.promise;
      }
      return Promise.resolve([
        { id: "beta", instance_name: "beta", title: "Beta" },
        { id: "other", instance_name: "other", title: "Other" },
      ]);
    },
    status: async () => ({ ready: true }),
  };
  const { state, view } = createFakeView();
  const lifecycle = createLifecycleHarness();
  const controller = createServiceForwardingController({
    api,
    view,
    lifecycleFactory: lifecycle.factory,
    getTarget: () => target,
  });

  controller.start();
  controller.setSelected(true);
  await Promise.resolve();
  target = { selector: "beta@deploy-b", displayName: "Beta" };
  controller.handleTargetChange();
  await settle();

  assert.equal(listCalls, 2);
  assert.deepEqual(controller.snapshot().entries.map((entry) => entry.id), ["beta"]);
  assert.deepEqual(state.lastEntries.map((entry) => entry.id), ["beta"]);

  firstList.resolve([{ id: "alpha", instance_name: "alpha", title: "Alpha" }]);
  await settle();
  assert.deepEqual(controller.snapshot().entries.map((entry) => entry.id), ["beta"]);
});

test("service forwarding performs create, edit, install, list, and delete through provider routes", async () => {
  const requests = [];
  const feedback = [];
  let records = [];
  let pendingUpstream = "";
  class FakeFormData {
    constructor() {
      this.values = new Map();
    }

    get(name) {
      return this.values.get(name);
    }

    set(name, value) {
      this.values.set(name, value);
    }
  }
  const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    requests.push({ path: parsed.pathname, options });
    if (parsed.pathname === "/api/publish/status") {
      return jsonResponse({ ready: true });
    }
    if (parsed.pathname === "/api/publish/list") {
      return jsonResponse(records);
    }
    if (parsed.pathname === "/api/publish/http/create") {
      const payload = JSON.parse(options.body);
      pendingUpstream = payload.upstream;
      assert.equal(payload.instance_name, "alpha@deploy-a");
      return jsonResponse({ record: { id: "publish-1" } });
    }
    if (parsed.pathname === "/api/publish/http/update") {
      const payload = JSON.parse(options.body);
      const entry = records.find((item) => item.id === payload.id);
      entry.upstream = payload.upstream;
      pendingUpstream = payload.upstream;
      return jsonResponse({ record: { id: payload.id } });
    }
    if (parsed.pathname === "/api/publish/http/install-shell-lpk") {
      assert.ok(options.body instanceof FakeFormData);
      const id = options.body.get("id");
      const current = records.find((item) => item.id === id);
      const next = current || { id, instance_name: "alpha@deploy-a" };
      next.upstream = pendingUpstream;
      next.title = options.body.get("title");
      next.subdomain = options.body.get("subdomain");
      next.skip_auth = options.body.get("skip_auth") === "true";
      next.installed_at = "now";
      next.app_url = `https://${next.subdomain}.example.test`;
      if (!current) {
        records.push(next);
      }
      return jsonResponse({});
    }
    if (parsed.pathname === "/api/publish/http/delete") {
      const payload = JSON.parse(options.body);
      records = records.filter((item) => item.id !== payload.id);
      return jsonResponse({});
    }
    return jsonResponse({ error: "unexpected route" }, 404);
  };
  const { state, view } = createFakeView();
  const lifecycle = createLifecycleHarness();
  const controller = createServiceForwardingController({
    fetchImpl,
    baseURL: "https://webshell.example.test/",
    FormDataCtor: FakeFormData,
    FileCtor: null,
    view,
    lifecycleFactory: lifecycle.factory,
    getTarget: () => ({ selector: "alpha@deploy-a", displayName: "Alpha" }),
    setFeedback: (message, tone) => feedback.push({ message, tone }),
    confirmDelete: async () => true,
  });

  controller.start();
  assert.equal(await lifecycle.handlers.onSubmit(), true);
  assert.equal(requests.find((request) => request.path.endsWith("/create")).options.headers["Content-Type"], "application/json");
  assert.equal(records[0].upstream, "https://[::1]:8443/?token=1");
  assert.equal(records[0].skip_auth, true);
  assert.deepEqual(controller.snapshot().entries.map((entry) => entry.id), ["publish-1"]);
  assert.deepEqual(feedback.at(-1), { message: "服务已部署。", tone: "success" });

  lifecycle.handlers.onListAction({ action: "edit", id: "publish-1" });
  state.form.path = "/updated";
  assert.equal(await lifecycle.handlers.onSubmit(), true);
  assert.equal(records[0].upstream, "https://[::1]:8443/updated");
  assert.equal(requests.some((request) => request.path.endsWith("/update")), true);

  lifecycle.handlers.onListAction({ action: "edit", id: "publish-1" });
  assert.equal(await lifecycle.handlers.onDeleteCurrent(), true);
  assert.deepEqual(records, []);
  assert.deepEqual(controller.snapshot().entries, []);
  assert.deepEqual(feedback.at(-1), { message: "服务已删除。", tone: "success" });
});

test("a failed app installation rolls back a newly created publish record", async () => {
  const removed = [];
  const feedback = [];
  const api = {
    status: async () => ({ ready: true }),
    create: async () => ({ record: { id: "publish-new" } }),
    install: async () => {
      throw new Error("install failed");
    },
    remove: async (payload) => {
      removed.push(payload.id);
      return {};
    },
  };
  const { view } = createFakeView();
  const lifecycle = createLifecycleHarness();
  const controller = createServiceForwardingController({
    api,
    view,
    lifecycleFactory: lifecycle.factory,
    getTarget: () => ({ selector: "alpha@deploy-a", displayName: "Alpha" }),
    setFeedback: (message, tone) => feedback.push({ message, tone }),
  });

  controller.start();
  assert.equal(await lifecycle.handlers.onSubmit(), false);
  assert.deepEqual(removed, ["publish-new"]);
  assert.deepEqual(feedback.at(-1), { message: "install failed", tone: "error" });
  assert.equal(controller.snapshot().busy, false);
});

test("dispose removes lifecycle resources, clears focus work, and ignores a late load", async () => {
  const pendingList = deferred();
  const { state, view } = createFakeView();
  const lifecycle = createLifecycleHarness();
  const timers = new Map();
  let nextTimerID = 1;
  const windowObject = {
    clearTimeout(id) {
      timers.delete(id);
    },
    setTimeout(callback) {
      const id = nextTimerID++;
      timers.set(id, callback);
      return id;
    },
  };
  const controller = createServiceForwardingController({
    api: {
      list: () => pendingList.promise,
      status: async () => ({ ready: true }),
    },
    view,
    lifecycleFactory: lifecycle.factory,
    windowObject,
    getTarget: () => ({ selector: "alpha@deploy-a", displayName: "Alpha" }),
  });

  controller.start();
  controller.start();
  lifecycle.handlers.onAdd();
  assert.equal(lifecycle.starts, 1);
  assert.equal(timers.size, 1);
  controller.setSelected(true);
  controller.dispose();
  controller.dispose();
  assert.equal(lifecycle.disposes, 1);
  assert.equal(timers.size, 0);

  pendingList.resolve([{ id: "late", instance_name: "alpha" }]);
  await settle();
  assert.equal(controller.snapshot().disposed, true);
  assert.deepEqual(controller.snapshot().entries, []);
  assert.equal(state.focusCount, 0);
});

test("the public controller owns real DOM listener registration and removal", () => {
  class FakeElement {
    constructor() {
      this.children = [];
      this.dataset = {};
      this.disabled = false;
      this.files = [];
      this.hidden = false;
      this.listeners = new Map();
      this.textContent = "";
      this.value = "";
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }

    append(...children) {
      this.children.push(...children);
    }

    appendChild(child) {
      this.children.push(child);
      return child;
    }

    dispatch(type) {
      for (const listener of Array.from(this.listeners.get(type) || [])) {
        listener({ preventDefault() {}, target: this, type });
      }
    }

    focus() {}

    removeEventListener(type, listener) {
      this.listeners.get(type)?.delete(listener);
    }
  }
  const ids = [
    "serviceForwardAddButton",
    "serviceForwardCancelButton",
    "serviceForwardDeleteButton",
    "serviceForwardEditor",
    "serviceForwardEditorScrim",
    "serviceForwardForm",
    "serviceForwardFormTitle",
    "serviceForwardHostInput",
    "serviceForwardIconInput",
    "serviceForwardList",
    "serviceForwardPathInput",
    "serviceForwardPortInput",
    "serviceForwardPortStepDown",
    "serviceForwardPortStepUp",
    "serviceForwardProtocolInput",
    "serviceForwardSkipAuthInput",
    "serviceForwardStatus",
    "serviceForwardSubdomainInput",
    "serviceForwardSubmitButton",
    "serviceForwardTitleInput",
  ];
  const elements = new Map(ids.map((id) => [id, new FakeElement()]));
  elements.get("serviceForwardEditor").hidden = true;
  const timers = new Map();
  let nextTimerID = 1;
  const controller = createServiceForwardingController({
    api: {},
    documentObject: {
      createElement: () => new FakeElement(),
      getElementById: (id) => elements.get(id) || null,
    },
    windowObject: {
      clearTimeout: (id) => timers.delete(id),
      setTimeout(callback) {
        const id = nextTimerID++;
        timers.set(id, callback);
        return id;
      },
    },
    getTarget: () => ({ selector: "alpha@deploy-a", displayName: "Alpha" }),
  });

  controller.start();
  elements.get("serviceForwardAddButton").dispatch("click");
  assert.equal(elements.get("serviceForwardEditor").hidden, false);
  elements.get("serviceForwardCancelButton").dispatch("click");
  assert.equal(elements.get("serviceForwardEditor").hidden, true);

  controller.dispose();
  elements.get("serviceForwardAddButton").dispatch("click");
  assert.equal(elements.get("serviceForwardEditor").hidden, true);
  assert.equal(elements.get("serviceForwardAddButton").listeners.get("click")?.size || 0, 0);
});
