export function createServerRevisionAPI({
  windowObject = globalThis.window,
  fetchImpl = globalThis.fetch?.bind(globalThis),
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("server revision API requires fetch");
  }

  const url = ({ name = "", clientID = "" } = {}) => {
    const requestURL = new URL("./api/server-revision", windowObject.location.href);
    if (name) {
      requestURL.searchParams.set("name", name);
    }
    requestURL.searchParams.set("client_id", String(clientID || ""));
    return requestURL;
  };

  const request = async (options) => {
    const response = await fetchImpl(url(options), { cache: "no-store" });
    if (!response.ok) {
      throw new Error(await response.text() || `Server revision request failed (${response.status})`);
    }
    return response;
  };

  return Object.freeze({
    async read(options) {
      return (await request(options)).json();
    },
    url,
  });
}
