const defaultRetryDelays = [250, 750, 1500, 3000];

const abortError = () => {
  const error = new Error("Instance loading was cancelled");
  error.name = "AbortError";
  return error;
};

const responseDetail = (body) => {
  const text = String(body || "").trim();
  if (!text) {
    return "";
  }
  try {
    const parsed = JSON.parse(text);
    const detail = String(parsed?.error || parsed?.message || "").trim();
    if (detail) {
      return detail;
    }
  } catch (error) {
  }
  return text;
};

const waitForRetry = (delay, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(abortError());
    return;
  }
  const timer = globalThis.setTimeout(() => {
    signal?.removeEventListener("abort", onAbort);
    resolve();
  }, delay);
  const onAbort = () => {
    globalThis.clearTimeout(timer);
    reject(abortError());
  };
  signal?.addEventListener("abort", onAbort, { once: true });
});

const loadOnce = async (fetchImpl, signal) => {
  let response;
  try {
    response = await fetchImpl("./api/instances", {
      cache: "no-store",
      signal: signal || undefined,
    });
  } catch (cause) {
    if (cause?.name === "AbortError" || signal?.aborted) {
      throw abortError();
    }
    const error = new Error(`Failed to load instances: ${cause?.message || "network error"}`);
    error.retryable = true;
    error.cause = cause;
    throw error;
  }

  let body;
  try {
    body = await response.text();
  } catch (cause) {
    const error = new Error(`Failed to load instances (${response.status}): ${cause?.message || "response read failed"}`);
    error.status = response.status;
    error.retryable = response.status >= 500;
    error.cause = cause;
    throw error;
  }
  if (!response.ok) {
    const detail = responseDetail(body);
    const error = new Error(`Failed to load instances (${response.status})${detail ? `: ${detail}` : ""}`);
    error.status = response.status;
    error.retryable = response.status === 502 || response.status === 503 || response.status === 504;
    throw error;
  }

  let instances;
  try {
    instances = JSON.parse(body);
  } catch (cause) {
    const error = new Error(`Invalid instances response: ${cause?.message || "invalid JSON"}`);
    error.cause = cause;
    throw error;
  }
  if (!Array.isArray(instances)) {
    throw new Error("Invalid instances response");
  }
  return instances;
};

export const createInstancesLoader = ({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  retryDelays = defaultRetryDelays,
  wait = waitForRetry,
  isDisposed = () => false,
  onInstances = () => {},
  onRetry = () => {},
} = {}) => {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is unavailable");
  }
  let inflight = null;
  let generation = 0;

  const load = () => {
    if (inflight) {
      return inflight.promise;
    }
    const currentGeneration = ++generation;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const signal = controller?.signal || null;
    const promise = (async () => {
      for (let attempt = 0; ; attempt += 1) {
        if (isDisposed() || signal?.aborted || currentGeneration !== generation) {
          throw abortError();
        }
        try {
          const instances = await loadOnce(fetchImpl, signal);
          if (isDisposed() || signal?.aborted || currentGeneration !== generation) {
            throw abortError();
          }
          onInstances(instances);
          return instances;
        } catch (error) {
          const delay = retryDelays[attempt];
          if (error?.name === "AbortError" || !error?.retryable || delay === undefined) {
            throw error;
          }
          onRetry({ attempt: attempt + 1, delay, error });
          await wait(delay, signal);
        }
      }
    })();
    inflight = { promise, controller, generation: currentGeneration };
    promise.finally(() => {
      if (inflight?.generation === currentGeneration) {
        inflight = null;
      }
    }).catch(() => {});
    return promise;
  };

  const dispose = () => {
    generation += 1;
    inflight?.controller?.abort();
    inflight = null;
  };

  return { load, dispose };
};
