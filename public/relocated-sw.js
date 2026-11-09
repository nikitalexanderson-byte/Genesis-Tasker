self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: "window" });
    await Promise.all(windows.map((client) => {
      const destination = new URL(client.url);
      destination.protocol = "https:";
      destination.host = "genesiscalendar.com";
      return client.navigate(destination.href);
    }));
  })());
});
