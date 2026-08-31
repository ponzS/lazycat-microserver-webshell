export function workspaceResponseSelector(state) {
  return String(state?.selector || "").trim();
}

export function ensureWorkspaceResponseSelector(state, expectedName, label = "Workspace") {
  const selector = workspaceResponseSelector(state);
  const expected = String(expectedName || "").trim();
  if (selector && expected && selector !== expected) {
    throw new Error(`${label} selector mismatch: expected ${expected}, got ${selector}`);
  }
}

export function createWorkspaceAPI({
  windowObject = globalThis.window,
  fetchImpl = (...args) => windowObject.fetch(...args),
  getActiveName = () => "",
  getActiveGeneration = () => 0,
  getTerminalSize = () => ({ cols: 120, rows: 32 }),
  isCurrentRequest = () => true,
  observeServerRevision = () => {},
  applyWorkspaceState = () => {},
} = {}) {
  let disposed = false;

  const normalizedSize = () => {
    const size = getTerminalSize() || {};
    return {
      cols: Math.max(1, Number(size.cols) || 120),
      rows: Math.max(1, Number(size.rows) || 32),
    };
  };

  const workspaceURL = (name = getActiveName(), size = normalizedSize()) => {
    const url = new URL("./api/workspace", windowObject.location.href);
    url.searchParams.set("name", String(name || "").trim());
    url.searchParams.set("cols", String(size.cols));
    url.searchParams.set("rows", String(size.rows));
    return url;
  };

  const activityURL = (name = getActiveName(), size = normalizedSize()) => {
    const url = new URL("./api/workspace/activity", windowObject.location.href);
    url.searchParams.set("name", String(name || "").trim());
    url.searchParams.set("cols", String(size.cols));
    url.searchParams.set("rows", String(size.rows));
    return url;
  };

  const responseError = async (response, fallback) => {
    const message = await response.text();
    return new Error(message || fallback);
  };

  const fetchState = async (name = getActiveName()) => {
    const requestName = String(name || "").trim();
    if (!requestName) {
      throw new Error("No running container is available.");
    }
    if (disposed) {
      throw new Error("Workspace API is disposed.");
    }
    const response = await fetchImpl(workspaceURL(requestName), { cache: "no-store" });
    if (!response.ok) {
      throw await responseError(response, `Workspace request failed (${response.status})`);
    }
    return response.json();
  };

  const postAction = async (action, payload = {}, {
    focus = true,
    preferStateActiveTab = true,
    applyResponse = true,
  } = {}) => {
    const requestName = String(getActiveName() || "").trim();
    const generation = getActiveGeneration();
    if (!requestName) {
      throw new Error("No running container is available.");
    }
    if (disposed) {
      throw new Error("Workspace API is disposed.");
    }
    const size = normalizedSize();
    const response = await fetchImpl(workspaceURL(requestName, size), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, cols: size.cols, rows: size.rows, ...payload }),
    });
    if (!response.ok) {
      throw await responseError(response, `Workspace action failed (${response.status})`);
    }
    const state = await response.json();
    if (disposed || !isCurrentRequest(requestName, generation)) {
      return state;
    }
    ensureWorkspaceResponseSelector(state, requestName);
    observeServerRevision(state);
    if (applyResponse) {
      applyWorkspaceState(state, {
        focus,
        instanceName: requestName,
        generation,
        preferStateActiveTab,
      });
    }
    return state;
  };

  const dispose = () => {
    if (disposed) {
      return false;
    }
    disposed = true;
    return true;
  };

  return Object.freeze({
    activityURL,
    dispose,
    fetchState,
    isDisposed: () => disposed,
    postAction,
    workspaceURL,
  });
}
