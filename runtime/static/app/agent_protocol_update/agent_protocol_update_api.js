export function createAgentProtocolUpdateAPI({
  windowObject = globalThis.window,
  fetchImpl = globalThis.fetch?.bind(globalThis),
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("agent protocol update API requires fetch");
  }

  return Object.freeze({
    async update({ name = "", currentProtocolVersion = "" } = {}) {
      const requestURL = new URL("./api/agent/protocol-update", windowObject.location.href);
      requestURL.searchParams.set("name", String(name || ""));
      const response = await fetchImpl(requestURL, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_protocol_version: String(currentProtocolVersion || "") }),
      });
      if (!response.ok) {
        throw new Error(await response.text() || `Terminal service update failed (${response.status})`);
      }
      return response.json();
    },
  });
}
