/* DealerLink service worker.
 * Only shows push alerts and opens the right page when one is tapped. It caches nothing,
 * so it can never serve a stale copy of the app. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "DealerLink", {
      body: data.body || "",
      tag: data.tag || undefined,
      renotify: Boolean(data.tag), // a newer update for the same order replaces the old alert but still buzzes
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin);
  const area = target.pathname.split("/")[1]; // "retailer", "dashboard" or "admin"
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Sign-in is per tab, so prefer a tab that is already open in the same part of the app (and therefore signed in).
      const match = windows.find((w) => {
        try {
          return new URL(w.url).pathname.split("/")[1] === area;
        } catch {
          return false;
        }
      });
      if (match) {
        try {
          await match.navigate(target.href);
        } catch {
          /* tab not controlled by this worker yet: just bring it to the front */
        }
        return match.focus();
      }
      return self.clients.openWindow(target.href);
    })(),
  );
});
