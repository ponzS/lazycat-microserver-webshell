// src/errors.ts
var LzcMobileBridgeError = class extends Error {
  constructor(message, code, cause) {
    super(message);
    this.code = code;
    this.cause = cause;
    this.name = "LzcMobileBridgeError";
  }
};
var BridgeUnavailableError = class extends LzcMobileBridgeError {
  constructor() {
    super(
      "LzcClientBridge is unavailable. Open this page inside a supported Lazycat mobile application.",
      "BRIDGE_UNAVAILABLE"
    );
    this.name = "BridgeUnavailableError";
  }
};
var UnsupportedCapabilityError = class extends LzcMobileBridgeError {
  constructor(method) {
    super(`The native application does not implement ${method}.`, "UNSUPPORTED_CAPABILITY");
    this.method = method;
    this.name = "UnsupportedCapabilityError";
  }
};
var InvalidBridgeResponseError = class extends LzcMobileBridgeError {
  constructor(method, response) {
    super(`The native application returned an invalid response for ${method}.`, "INVALID_RESPONSE");
    this.method = method;
    this.response = response;
    this.name = "InvalidBridgeResponseError";
  }
};

// src/transport.ts
var RESPONSE_EVENT = "lzc-mobile-bridge-response";
var CALL_TIMEOUT_MS = 15e3;
var androidTransportCache = /* @__PURE__ */ new WeakMap();
var nextCallId = 0;
function createAndroidTransport(nativeBridge) {
  const pending = /* @__PURE__ */ new Map();
  globalThis.addEventListener(RESPONSE_EVENT, ((event) => {
    let detail;
    try {
      detail = typeof event.detail === "string" ? JSON.parse(event.detail) : event.detail;
    } catch {
      return;
    }
    const callId = detail?.callId;
    if (typeof callId !== "string") return;
    const call = pending.get(callId);
    if (!call) return;
    pending.delete(callId);
    clearTimeout(call.timeout);
    const error = detail.error;
    if (error) {
      call.reject(error.code === "UNSUPPORTED_CAPABILITY" ? new UnsupportedCapabilityError(call.method) : new LzcMobileBridgeError(
        typeof error.message === "string" ? error.message : "Native bridge call failed.",
        typeof error.code === "string" ? error.code : "NATIVE_ERROR"
      ));
      return;
    }
    call.resolve(detail.result);
  }));
  return {
    has(method) {
      return typeof nativeBridge[method] === "function" || typeof nativeBridge.call === "function";
    },
    async call(method, parameters = []) {
      const directMethod = nativeBridge[method];
      if (typeof directMethod === "function") {
        return await directMethod.apply(nativeBridge, parameters);
      }
      if (typeof nativeBridge.call !== "function") {
        throw new UnsupportedCapabilityError(method);
      }
      const callId = `lzc-${Date.now()}-${++nextCallId}`;
      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(callId);
          reject(new LzcMobileBridgeError(
            `Native bridge call timed out: ${method}`,
            "NATIVE_TIMEOUT"
          ));
        }, CALL_TIMEOUT_MS);
        pending.set(callId, { method, resolve, reject, timeout });
        try {
          nativeBridge.call(callId, method, JSON.stringify(parameters));
        } catch (error) {
          clearTimeout(timeout);
          pending.delete(callId);
          reject(error);
        }
      });
    }
  };
}
function resolveBridgeTransport() {
  const bridgeGlobal = globalThis;
  if (typeof bridgeGlobal.LzcClientBridge?.call === "function") {
    return bridgeGlobal.LzcClientBridge;
  }
  const nativeBridge = bridgeGlobal.LzcClientBridgeNative;
  if (!nativeBridge) {
    throw new BridgeUnavailableError();
  }
  const cached = androidTransportCache.get(nativeBridge);
  if (cached) {
    return cached;
  }
  const transport = createAndroidTransport(nativeBridge);
  androidTransportCache.set(nativeBridge, transport);
  return transport;
}
async function callNative(transport, method, parameters = []) {
  if (transport.ready && !await transport.ready) {
    throw new BridgeUnavailableError();
  }
  if (transport.has && !transport.has(method)) {
    throw new UnsupportedCapabilityError(method);
  }
  try {
    return await transport.call(method, parameters);
  } catch (error) {
    if (error instanceof LzcMobileBridgeError) {
      throw error;
    }
    const nativeError = error;
    throw new LzcMobileBridgeError(
      typeof nativeError?.message === "string" ? nativeError.message : `Native bridge call failed: ${method}`,
      typeof nativeError?.code === "string" ? nativeError.code : "NATIVE_ERROR",
      error
    );
  }
}

// src/client.ts
var NATIVE_METHODS = {
  isIndependentClient: "IsIndependentClient",
  openConfigurationPage: "OpenConfigurationPage",
  getCurrentTheme: "GetCurrentTheme",
  setCurrentTheme: "SetCurrentTheme",
  getCurrentLanguage: "GetCurrentLanguage",
  setCurrentLanguage: "SetCurrentLanguage"
};
var THEMES = /* @__PURE__ */ new Set(["light", "dark", "system"]);
var LANGUAGES = /* @__PURE__ */ new Set(["auto", "zh-Hans", "en"]);
function assertBoolean(value, method) {
  if (typeof value === "boolean") {
    return value;
  }
  throw new InvalidBridgeResponseError(method, value);
}
function assertTheme(value, method) {
  if (typeof value === "string" && THEMES.has(value)) {
    return value;
  }
  throw new InvalidBridgeResponseError(method, value);
}
function assertLanguage(value, method) {
  if (typeof value === "string" && LANGUAGES.has(value)) {
    return value;
  }
  throw new InvalidBridgeResponseError(method, value);
}
function validateTheme(theme) {
  if (!THEMES.has(theme)) {
    throw new TypeError(`Invalid theme: ${String(theme)}`);
  }
}
function validateLanguage(language) {
  if (!LANGUAGES.has(language)) {
    throw new TypeError(`Invalid language: ${String(language)}`);
  }
}
function createMobileBridge(transport = resolveBridgeTransport()) {
  let independentClientPromise;
  return {
    isIndependentClient() {
      if (!independentClientPromise) {
        const method = NATIVE_METHODS.isIndependentClient;
        independentClientPromise = callNative(transport, method).then((value) => assertBoolean(value, method)).catch((error) => {
          independentClientPromise = void 0;
          throw error;
        });
      }
      return independentClientPromise;
    },
    async openConfigurationPage() {
      await callNative(transport, NATIVE_METHODS.openConfigurationPage);
    },
    async getCurrentTheme() {
      const method = NATIVE_METHODS.getCurrentTheme;
      return assertTheme(await callNative(transport, method), method);
    },
    async setCurrentTheme(theme) {
      validateTheme(theme);
      await callNative(transport, NATIVE_METHODS.setCurrentTheme, [theme]);
    },
    async getCurrentLanguage() {
      const method = NATIVE_METHODS.getCurrentLanguage;
      return assertLanguage(await callNative(transport, method), method);
    },
    async setCurrentLanguage(language) {
      validateLanguage(language);
      await callNative(transport, NATIVE_METHODS.setCurrentLanguage, [language]);
    }
  };
}

// src/index.ts
var defaultTransport;
var defaultBridgeInstance;
function defaultBridge() {
  const transport = resolveBridgeTransport();
  if (transport !== defaultTransport || !defaultBridgeInstance) {
    defaultTransport = transport;
    defaultBridgeInstance = createMobileBridge(transport);
  }
  return defaultBridgeInstance;
}
async function isIndependentClient() {
  return await defaultBridge().isIndependentClient();
}
function isAndroidClient() {
  const bridge = globalThis.LzcClientBridgeNative;
  return bridge !== null && typeof bridge === "object";
}
async function openConfigurationPage() {
  await defaultBridge().openConfigurationPage();
}
async function getCurrentTheme() {
  return await defaultBridge().getCurrentTheme();
}
async function setCurrentTheme(theme) {
  await defaultBridge().setCurrentTheme(theme);
}
async function getCurrentLanguage() {
  return await defaultBridge().getCurrentLanguage();
}
async function setCurrentLanguage(language) {
  await defaultBridge().setCurrentLanguage(language);
}
export {
  BridgeUnavailableError,
  InvalidBridgeResponseError,
  LzcMobileBridgeError,
  NATIVE_METHODS,
  UnsupportedCapabilityError,
  createMobileBridge,
  getCurrentLanguage,
  getCurrentTheme,
  isAndroidClient,
  isIndependentClient,
  openConfigurationPage,
  resolveBridgeTransport,
  setCurrentLanguage,
  setCurrentTheme
};
