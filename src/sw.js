/* Service Worker for SYS-MGMT (PWA Web Push) */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || "SYS-MGMT: ERROR";
  const body = data.body || "";

  // Show notification
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, {
        body,
        tag: "sysmgmt-error",
        renotify: true,
      });

      // Forward payload to any open clients (so app shows error immediately)
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of clientsList) {
        c.postMessage({ type: "SYS_MGMT_PUSH", title, body });
      }
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

      // Focus existing tab if present
      for (const c of allClients) {
        if ("focus" in c) return c.focus();
      }

      // Otherwise open a new one
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })()
  );
});
