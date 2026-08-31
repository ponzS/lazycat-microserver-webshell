import assert from "node:assert/strict";
import test from "node:test";

import { createAttachmentsController } from "../runtime/static/attachments/index.js";

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

class FakeBlob {
  constructor(parts = [], options = {}) {
    this.parts = parts;
    this.size = parts.reduce((sum, part) => sum + String(part || "").length, 0);
    this.type = options.type || "";
  }
}

class FakeFile extends FakeBlob {
  constructor(parts, name, options = {}) {
    super(parts, options);
    this.name = name;
  }
}

const createFakeWindow = () => {
  const timers = new Map();
  let nextTimerID = 1;
  return {
    clearTimeout(id) {
      timers.delete(id);
    },
    isSecureContext: true,
    location: { href: "https://webshell.example.test/app/" },
    navigator: {},
    runTimers() {
      const pending = [...timers.values()];
      timers.clear();
      for (const callback of pending) {
        callback();
      }
    },
    setTimeout(callback) {
      const id = nextTimerID++;
      timers.set(id, callback);
      return id;
    },
    timers,
  };
};

const createFakeView = ({ elements = {} } = {}) => {
  const state = {
    browserOpen: false,
    browserRenders: [],
    dialogOpen: false,
    disposed: 0,
    downloads: [],
    feedback: [],
    filePickerClicks: 0,
    focusBrowser: 0,
    focusClipboard: 0,
    inputFiles: [],
    removedUploads: [],
    uploads: new Map(),
  };
  return {
    state,
    view: {
      elements,
      closeBrowser() {
        state.browserOpen = false;
      },
      closeDialog() {
        state.dialogOpen = false;
      },
      consumeInputFiles() {
        const files = state.inputFiles;
        state.inputFiles = [];
        return files;
      },
      dispose() {
        state.disposed += 1;
        state.browserOpen = false;
        state.dialogOpen = false;
        state.uploads.clear();
      },
      focusBrowserBack() {
        state.focusBrowser += 1;
      },
      focusClipboard() {
        state.focusClipboard += 1;
      },
      isAvailable: () => true,
      isBrowserOpen: () => state.browserOpen,
      isDialogOpen: () => state.dialogOpen,
      openBrowser() {
        state.browserOpen = true;
      },
      openDialog() {
        state.dialogOpen = true;
      },
      openFilePicker() {
        state.filePickerClicks += 1;
      },
      removeUpload(id) {
        state.removedUploads.push(id);
        state.uploads.delete(id);
      },
      renderBrowser(options) {
        state.browserRenders.push({
          ...options,
          entries: options.entries.map((entry) => ({ ...entry })),
          selectedPaths: [...options.selectedPaths],
          sort: { ...options.sort },
        });
      },
      renderUpload(upload, options) {
        state.uploads.set(upload.id, {
          ...upload,
          files: upload.files.map((file) => file.name),
          host: options.host,
          searchOpen: options.searchOpen,
        });
      },
      resolveBreadcrumb: (event) => event?.path || "",
      resolveBrowserItem: (event) => event?.item || null,
      resolveSelection: (event) => event?.selection || null,
      resolveSortKey: (event) => event?.sortKey || "",
      setBrowserFeedback(message, tone = "info") {
        state.feedback.push({ message, tone });
      },
      triggerDownload(url, filename) {
        state.downloads.push({ filename, url: String(url) });
      },
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

test("attachments browser uses the client root and rejects a late response from the old target", async () => {
  const firstList = deferred();
  const requests = [];
  let context = {
    targetName: "alpha@deploy-a",
    cwd: "/home/alice/project",
    tabId: "tab-a",
    activeTabId: "tab-a",
  };
  const api = {
    downloadURL: () => new URL("https://webshell.example.test/download"),
    list({ targetName, path }) {
      requests.push({ path, targetName });
      if (targetName === "alpha@deploy-a") {
        return firstList.promise;
      }
      return Promise.resolve({
        path: "/",
        parent: "",
        entries: [{ name: "beta.txt", path: "/beta.txt", type: "file", size: 4 }],
      });
    },
  };
  const { state, view } = createFakeView();
  const lifecycle = createLifecycleHarness();
  const controller = createAttachmentsController({
    api,
    view,
    lifecycleFactory: lifecycle.factory,
    getContext: () => context,
    windowObject: createFakeWindow(),
    FileCtor: FakeFile,
    BlobCtor: FakeBlob,
  });

  controller.start();
  controller.openBrowser();
  assert.deepEqual(requests[0], { targetName: "alpha@deploy-a", path: "/home/alice/project" });

  context = {
    targetName: "client:client-b",
    isClient: true,
    cwd: "/Documents",
    tabId: "tab-b",
    activeTabId: "tab-b",
  };
  controller.handleTargetChange();
  controller.openBrowser();
  await settle();

  assert.deepEqual(requests[1], { targetName: "client:client-b", path: "/" });
  assert.equal(controller.snapshot().browser.currentPath, "/");
  assert.deepEqual(controller.snapshot().browser.entries.map((entry) => entry.name), ["beta.txt"]);

  firstList.resolve({
    path: "/home/alice/project",
    entries: [{ name: "stale.txt", path: "/home/alice/project/stale.txt", type: "file" }],
  });
  await settle();
  assert.deepEqual(controller.snapshot().browser.entries.map((entry) => entry.name), ["beta.txt"]);
  assert.equal(state.browserOpen, true);
});

test("attachments use only provider routes for list, upload, and download", async () => {
  const fetchRequests = [];
  const downloadTargets = [];
  class FakeFormData {
    constructor() {
      this.values = [];
    }

    append(name, value, filename) {
      this.values.push({ filename, name, value });
    }
  }
  class FakeTarget {
    constructor() {
      this.listeners = new Map();
    }

    addEventListener(type, listener) {
      const list = this.listeners.get(type) || [];
      list.push(listener);
      this.listeners.set(type, list);
    }

    emit(type, event = {}) {
      for (const listener of this.listeners.get(type) || []) {
        listener(event);
      }
    }
  }
  class FakeXHR extends FakeTarget {
    static instances = [];

    constructor() {
      super();
      this.upload = new FakeTarget();
      this.status = 0;
      this.responseText = "";
      FakeXHR.instances.push(this);
    }

    open(method, url) {
      this.method = method;
      this.url = String(url);
    }

    send(body) {
      this.body = body;
    }
  }
  const fetchImpl = async (url) => {
    fetchRequests.push(String(url));
    return new Response(JSON.stringify({
      path: "/home/alice",
      parent: "/home",
      entries: [{ name: "note.txt", path: "/home/alice/note.txt", type: "file", size: 5 }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const { state, view } = createFakeView();
  view.triggerDownload = (url, filename) => downloadTargets.push({ filename, url: String(url) });
  const lifecycle = createLifecycleHarness();
  const fakeWindow = createFakeWindow();
  const controller = createAttachmentsController({
    baseURL: fakeWindow.location.href,
    fetchImpl,
    XMLHttpRequestCtor: FakeXHR,
    FormDataCtor: FakeFormData,
    FileCtor: FakeFile,
    BlobCtor: FakeBlob,
    view,
    lifecycleFactory: lifecycle.factory,
    getContext: () => ({
      targetName: "alpha@deploy-a",
      cwd: "/home/alice",
      tabId: "tab-a",
      activeTabId: "tab-a",
    }),
    getTabHost: () => ({ id: "host-a" }),
    windowObject: fakeWindow,
    copyText: async () => true,
  });

  controller.start();
  controller.openBrowser();
  await settle();
  assert.match(fetchRequests[0], /\/api\/attachments\/files\?/);
  assert.match(fetchRequests[0], /name=alpha%40deploy-a/);
  assert.match(fetchRequests[0], /path=%2Fhome%2Falice/);

  lifecycle.handlers.onSelectionChange({ selection: { checked: true, path: "/home/alice/note.txt" } });
  lifecycle.handlers.onDownloadSelected();
  assert.equal(downloadTargets.length, 1);
  assert.match(downloadTargets[0].url, /\/api\/attachments\/download\?/);
  assert.match(downloadTargets[0].url, /path=%2Fhome%2Falice%2Fnote.txt/);
  assert.equal(downloadTargets[0].filename, "note.txt");

  const file = new FakeFile(["hello"], "note.txt", { type: "text/plain" });
  const uploadID = controller.uploadAttachments([file]);
  const xhr = FakeXHR.instances.at(-1);
  assert.equal(xhr.method, "POST");
  assert.match(xhr.url, /\/api\/attachments\?name=alpha%40deploy-a/);
  assert.equal(xhr.body.values[0].filename, "note.txt");
  xhr.status = 200;
  xhr.responseText = JSON.stringify({ files: [{ path: "/tmp/note.txt" }] });
  xhr.emit("load");
  await settle();
  assert.equal(controller.snapshot().uploads.find((upload) => upload.id === uploadID).status, "success");
  assert.equal(state.uploads.get(uploadID).paths, "/tmp/note.txt");
});

test("attachment uploads preserve progress, clipboard reservation, limits, and auto-close", async () => {
  const pendingUpload = deferred();
  let progress = null;
  let aborted = 0;
  const xhr = { abort: () => { aborted += 1; } };
  const api = {
    downloadURL: () => new URL("https://webshell.example.test/download"),
    list: async () => ({ path: "/", entries: [] }),
    upload(options) {
      progress = options.onProgress;
      return { promise: pendingUpload.promise, xhr };
    },
  };
  const reservationState = { rejected: 0, resolved: "" };
  const reservation = {
    promise: Promise.resolve(),
    reject() {
      reservationState.rejected += 1;
    },
    resolve(value) {
      reservationState.resolved = value;
    },
  };
  const toasts = [];
  const metrics = [];
  const { state, view } = createFakeView();
  const lifecycle = createLifecycleHarness();
  const fakeWindow = createFakeWindow();
  let clock = 100;
  const controller = createAttachmentsController({
    api,
    view,
    lifecycleFactory: lifecycle.factory,
    getContext: () => ({ targetName: "alpha@deploy-a", tabId: "tab-a", activeTabId: "tab-a" }),
    getTabHost: () => ({ id: "host-a" }),
    windowObject: fakeWindow,
    FileCtor: FakeFile,
    BlobCtor: FakeBlob,
    showToast: (message) => toasts.push(message),
    now: () => clock,
    recordPerformanceTask: (name, duration) => metrics.push({ duration, name }),
  });
  const file = new FakeFile(["hello"], "note.txt");
  const uploadID = controller.uploadAttachments([file], { clipboardReservation: reservation });
  progress({ lengthComputable: true, loaded: 3, total: 5 });
  assert.equal(controller.snapshot().uploads[0].loaded, 3);
  clock = 145;
  pendingUpload.resolve({ files: [{ path: "/tmp/note.txt" }] });
  await settle();

  assert.equal(reservationState.resolved, "/tmp/note.txt");
  assert.equal(reservationState.rejected, 0);
  assert.equal(controller.snapshot().uploads[0].status, "success");
  assert.deepEqual(metrics, [{ name: "attachment upload", duration: 45 }]);
  assert.equal(fakeWindow.timers.size, 1);
  fakeWindow.runTimers();
  assert.equal(controller.snapshot().uploads.length, 0);
  assert.deepEqual(state.removedUploads, [uploadID]);
  assert.equal(aborted, 0);

  const tooMany = Array.from({ length: 33 }, (_, index) => new FakeFile(["x"], `${index}.txt`));
  assert.equal(controller.uploadAttachments(tooMany), "");
  const oversized = new FakeFile(["x"], "large.bin");
  oversized.size = 2 * 1024 * 1024 * 1024 + 1;
  assert.equal(controller.uploadAttachments([oversized]), "");
  assert.deepEqual(toasts.slice(-2), ["一次最多上传 32 个文件。", "文件超过 2GB：large.bin"]);
});

test("target, tab, and dispose cleanup abort uploads and reject late clipboard work", async () => {
  const uploadDeferred = deferred();
  const clipboardDeferred = deferred();
  let aborted = 0;
  let reservationRejected = 0;
  let context = { targetName: "alpha@deploy-a", tabId: "tab-a", activeTabId: "tab-a" };
  const api = {
    downloadURL: () => new URL("https://webshell.example.test/download"),
    list: async () => ({ path: "/", entries: [] }),
    upload: () => ({ promise: uploadDeferred.promise, xhr: { abort: () => { aborted += 1; } } }),
  };
  const { state, view } = createFakeView();
  const lifecycle = createLifecycleHarness();
  const fakeWindow = createFakeWindow();
  const controller = createAttachmentsController({
    api,
    clipboard: {
      createReservation: () => ({
        promise: Promise.resolve(),
        reject: () => { reservationRejected += 1; },
        resolve() {},
      }),
      readFiles: () => clipboardDeferred.promise,
    },
    view,
    lifecycleFactory: lifecycle.factory,
    getContext: () => context,
    getTabHost: () => ({ id: "host" }),
    windowObject: fakeWindow,
    FileCtor: FakeFile,
    BlobCtor: FakeBlob,
  });

  controller.start();
  controller.start();
  assert.equal(lifecycle.starts, 1);
  controller.openDialog();
  assert.equal(fakeWindow.timers.size, 1);
  controller.closeAll({ focus: false });
  assert.equal(fakeWindow.timers.size, 0);
  controller.selectFiles();
  assert.equal(controller.snapshot().pendingFileClipboard, true);
  const uploadID = controller.uploadAttachments([new FakeFile(["x"], "a.txt")]);
  controller.handleTabRemoved("tab-a");
  assert.equal(aborted, 1);
  assert.equal(controller.snapshot().uploads.length, 0);
  uploadDeferred.resolve({ files: [{ path: "/tmp/stale.txt" }] });
  await settle();
  assert.equal(state.uploads.has(uploadID), false);

  const clipboardImport = controller.importFromClipboard();
  context = { targetName: "beta@deploy-b", tabId: "tab-b", activeTabId: "tab-b" };
  controller.handleTargetChange();
  clipboardDeferred.resolve([new FakeFile(["late"], "late.txt")]);
  assert.equal(await clipboardImport, false);
  assert.equal(reservationRejected, 1);

  controller.dispose();
  controller.dispose();
  assert.equal(lifecycle.disposes, 1);
  assert.equal(state.disposed, 1);
  assert.equal(fakeWindow.timers.size, 0);
});

test("the public controller owns real listener registration and removal", () => {
  class FakeEventTarget {
    constructor() {
      this.listeners = new Map();
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    dispatch(type, event = {}) {
      for (const listener of this.listeners.get(type) || []) {
        listener({ target: this, ...event });
      }
    }

    removeEventListener(type, listener) {
      this.listeners.set(type, (this.listeners.get(type) || []).filter((candidate) => candidate !== listener));
    }
  }
  const toggle = new FakeEventTarget();
  const close = new FakeEventTarget();
  const { state, view } = createFakeView({
    elements: {
      toggle,
      dialogClose: close,
    },
  });
  const controller = createAttachmentsController({
    api: {
      downloadURL: () => new URL("https://webshell.example.test/download"),
      list: async () => ({ path: "/", entries: [] }),
    },
    view,
    getContext: () => ({ targetName: "alpha@deploy-a", tabId: "tab-a", activeTabId: "tab-a" }),
    windowObject: createFakeWindow(),
    FileCtor: FakeFile,
    BlobCtor: FakeBlob,
  });

  controller.start();
  toggle.dispatch("click");
  assert.equal(state.dialogOpen, true);
  close.dispatch("click");
  assert.equal(state.dialogOpen, false);
  controller.dispose();
  toggle.dispatch("click");
  assert.equal(state.dialogOpen, false);
  assert.equal(toggle.listeners.get("click").length, 0);
});
