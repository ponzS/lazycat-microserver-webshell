const legacyAppShellCachePrefix = "lcmd-webshell-app-shell-";
const legacyTerminalCacheName = "lcmd-webshell-terminal-v2";

const controlledWindowClients = async () => {
  try {
    return await self.clients.matchAll({ type: "window" });
  } catch (_error) {
    return [];
  }
};

const deleteLegacyCaches = async () => {
  let names = [];
  try {
    names = await caches.keys();
  } catch (_error) {
    return;
  }
  await Promise.allSettled(names
    .filter((name) => name === legacyTerminalCacheName || name.startsWith(legacyAppShellCachePrefix))
    .map((name) => caches.delete(name)));
};

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const clients = await controlledWindowClients();
    await deleteLegacyCaches();
    try {
      await self.registration.unregister();
    } catch (_error) {
    }
    await Promise.allSettled(clients.map((client) => {
      try {
        return client.navigate(client.url);
      } catch (_error) {
        return false;
      }
    }));
  })());
});
