export function createTerminalStartupErrorAPI({
  windowObject = globalThis.window,
  fetchImpl = globalThis.fetch,
} = {}) {
  const startupErrorURL = (name) => {
    const url = new URL("./api/agent/startup-error", windowObject.location.href);
    url.searchParams.set("name", String(name || "").trim());
    return url;
  };

  const read = async (name) => {
    const requestName = String(name || "").trim();
    if (!requestName) {
      return "";
    }
    const response = await fetchImpl(startupErrorURL(requestName), { cache: "no-store" });
    if (!response.ok) {
      return "";
    }
    const data = await response.json();
    return String(data?.error || "").trim();
  };

  return Object.freeze({ read, startupErrorURL });
}
