import { PushNotifications } from "@capacitor/push-notifications";
import { isCapacitorNativePlatform } from "./notifications";
import { auditAppend } from "./audit";

export async function nativePushEnable() {
  if (!isCapacitorNativePlatform()) return "PUSH_NATIVE: NOT_NATIVE";

  const perm = await PushNotifications.checkPermissions();
  if (perm.receive !== "granted") await PushNotifications.requestPermissions();

  await PushNotifications.register();

  PushNotifications.addListener("registration", (token) => {
    auditAppend({ type: "PUSH_NATIVE_TOKEN", token: token?.value || null });
  });

  PushNotifications.addListener("registrationError", (err) => {
    auditAppend({ type: "PUSH_NATIVE_REG_ERROR", err: String(err) });
  });

  PushNotifications.addListener("pushNotificationReceived", (notification) => {
    auditAppend({ type: "PUSH_NATIVE_RECEIVED", notification });
  });

  PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    auditAppend({ type: "PUSH_NATIVE_ACTION", action });
  });

  auditAppend({ type: "PUSH_NATIVE_ENABLED" });
  return "PUSH_NATIVE: ENABLED";
}

export async function nativePushDisable() {
  // No universal unregister; treat as app-level flag in production
  auditAppend({ type: "PUSH_NATIVE_DISABLED_FLAG_SET" });
  return "PUSH_NATIVE: DISABLED_FLAG_SET";
}
