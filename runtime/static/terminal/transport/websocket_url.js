/**
 * Resolves a relative terminal endpoint against the page URL and converts
 * HTTP(S) schemes to the corresponding WebSocket scheme.
 */
export function terminalWebSocketURL(path, { windowObject = globalThis.window, baseURL = "" } = {}) {
  const fallbackBase = baseURL || windowObject?.location?.href || globalThis.location?.href;
  if (!fallbackBase) {
    throw new Error("A page URL is required to build a WebSocket URL.");
  }
  const url = new URL(path, fallbackBase);
  if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else if (url.protocol === "http:") {
    url.protocol = "ws:";
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`Unsupported WebSocket protocol: ${url.protocol || "unknown"}`);
  }
  return url;
}

/**
 * Builds the page-level Unified endpoint. Protocol query fields belong to the
 * transport boundary so application orchestration only supplies identity.
 */
export function terminalUnifiedWebSocketURL(
  targetName,
  {
    windowObject = globalThis.window,
    baseURL = "",
    clientID = "",
    path = "./ws",
  } = {},
) {
  const url = terminalWebSocketURL(path, { windowObject, baseURL });
  url.searchParams.set("mode", "unified");
  url.searchParams.set("transport_role", "unified");
  url.searchParams.set("protocol_version", "1");
  url.searchParams.set("name", String(targetName || ""));
  url.searchParams.set("client_id", String(clientID || ""));
  return url;
}
