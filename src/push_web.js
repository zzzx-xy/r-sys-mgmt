import { auditAppend } from "./audit";

export async function webPushEnable(vapidPublicKey) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "PUSH_WEB: UNSUPPORTED";

  const reg = await navigator.serviceWorker.ready;
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return "PUSH_WEB: PERMISSION_DENIED";

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });

  auditAppend({ type: "PUSH_WEB_SUBSCRIBED" });

  await fetch("/.netlify/functions/push-subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sub }),
  });

  return "PUSH_WEB: ENABLED";
}

export async function webPushDisable() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch {}
  auditAppend({ type: "PUSH_WEB_UNSUBSCRIBED" });
  return "PUSH_WEB: DISABLED";
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}
