import { LocalNotifications } from "@capacitor/local-notifications";
import { Capacitor } from "@capacitor/core";
import { auditAppend } from "./audit";

export const TZ = "Europe/Rome";

export function isCapacitorNativePlatform() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function dateKeyInTimeZone(timeZone = TZ, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const yyyy = parts.find((p) => p.type === "year")?.value;
  const mm = parts.find((p) => p.type === "month")?.value;
  const dd = parts.find((p) => p.type === "day")?.value;

  return `${yyyy}-${mm}-${dd}`;
}

/**
 * UI active error storage.
 * Populated only when a notification actually fires or is tapped.
 */
export const ACTIVE_ERROR_KEY = "sysmgmt_active_error_v2";

export function setActiveError(payloadOrNull) {
  try {
    if (!payloadOrNull) {
      localStorage.removeItem(ACTIVE_ERROR_KEY);
      return;
    }
    localStorage.setItem(ACTIVE_ERROR_KEY, JSON.stringify(payloadOrNull));
  } catch {
    // ignore
  }
}

export function getActiveError() {
  try {
    const raw = localStorage.getItem(ACTIVE_ERROR_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function ensureNotificationPermissions() {
  const perm = await LocalNotifications.checkPermissions();
  if (perm.display !== "granted") {
    await LocalNotifications.requestPermissions();
  }
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 0..2/day distribution
 */
function pickDailyCount(maxPerDay) {
  const r = Math.random();
  let n = 0;
  if (r < 0.55) n = 0;
  else if (r < 0.9) n = 1;
  else n = 2;
  return Math.min(n, maxPerDay);
}

function randomTimeForDay(d) {
  // 10:00..21:59 (device local time)
  const hour = randInt(10, 21);
  const minute = randInt(0, 59);
  const out = new Date(d);
  out.setHours(hour, minute, 0, 0);
  return out;
}

function pickRestaurant() {
  const list = ["R1", "R2", "R3", "R4", "R5"];
  return list[randInt(0, list.length - 1)];
}

function pickSeverity() {
  // INFO is silent, WARN/CRITICAL can notify (we'll filter later)
  const r = Math.random();
  if (r < 0.55) return "WARN";
  if (r < 0.8) return "INFO";
  return "CRITICAL";
}

const NOTIF_SCHEDULE_KEY = "sysmgmt_notif_schedule_v4";

/**
 * Listeners update ACTIVE_ERROR when an error occurs (notification delivered/tapped).
 */
export async function registerNotificationListeners() {
  if (!isCapacitorNativePlatform()) return;

  LocalNotifications.addListener("localNotificationReceived", (n) => {
    const payload = parsePayload(n?.body);

    const active = {
      ts: Date.now(),
      title: n?.title || "ERROR",
      body: n?.body || "",
      restaurant: payload.restaurant || null,
      severity: payload.severity || null,
      incidentId: payload.incidentId || null,
    };

    setActiveError(active);
    auditAppend({ type: "LOCAL_NOTIF_RECEIVED", ...active });
  });

  LocalNotifications.addListener("localNotificationActionPerformed", (evt) => {
    const n = evt?.notification;
    const payload = parsePayload(n?.body);

    const active = {
      ts: Date.now(),
      title: n?.title || "ERROR",
      body: n?.body || "",
      restaurant: payload.restaurant || null,
      severity: payload.severity || null,
      incidentId: payload.incidentId || null,
    };

    setActiveError(active);
    auditAppend({ type: "LOCAL_NOTIF_ACTION", ...active });
  });
}

function saveSchedule(obj) {
  localStorage.setItem(NOTIF_SCHEDULE_KEY, JSON.stringify(obj));
}
function loadSchedule() {
  try {
    const raw = localStorage.getItem(NOTIF_SCHEDULE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function parsePayload(body) {
  // Expect: "E|I=<uuid>|R=R3|S=CRITICAL|C=HTTP|V=503"
  const out = {};
  if (typeof body !== "string") return out;

  const i = body.match(/\bI=([0-9a-fA-F-]{36})\b/);
  const r = body.match(/\bR=(R[1-5])\b/);
  const s = body.match(/\bS=(INFO|WARN|CRITICAL)\b/);

  if (i) out.incidentId = i[1];
  if (r) out.restaurant = r[1];
  if (s) out.severity = s[1];

  return out;
}

/**
 * Schedule randomized notifications for next N days (native only).
 * - max 2/day
 * - INFO is silent (not scheduled)
 * - restaurant tagged in notification body
 */
export async function scheduleErrorsForNextNDays({ nDays = 30, maxPerDay = 2 }) {
  if (!isCapacitorNativePlatform()) return;

  const today = new Date();
  const todayKey = dateKeyInTimeZone(TZ, today);

  const existing = loadSchedule();
  if (existing?.generatedFor === todayKey && existing?.nDays === nDays && existing?.maxPerDay === maxPerDay) {
    return;
  }

  // cancel pending to avoid duplicates
  const pending = await LocalNotifications.getPending();
  if (pending.notifications?.length) {
    await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  }

  const schedule = { generatedFor: todayKey, nDays, maxPerDay, days: {} };
  const notifications = [];
  let notifId = 5000;

  for (let i = 0; i < nDays; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);

    const dayKey = dateKeyInTimeZone(TZ, d);
    const count = pickDailyCount(maxPerDay);

    schedule.days[dayKey] = { count, items: [] };

    for (let k = 0; k < count; k++) {
      const restaurant = pickRestaurant();
      const severity = pickSeverity();

      // INFO => silent (do not schedule)
      if (severity === "INFO") {
        schedule.days[dayKey].items.push({ restaurant, severity, at: null });
        continue;
      }

      const at = randomTimeForDay(d);

      // Body encodes restaurant/severity without UI “randomization” text
      const body = `E|R=${restaurant}|S=${severity}|D=${dayKey}`;

      notifications.push({
        id: notifId++,
        title: "SYS-MGMT: ERROR",
        body,
        schedule: { at },
      });

      schedule.days[dayKey].items.push({ restaurant, severity, at: at.toISOString() });
    }
  }

  saveSchedule(schedule);
  auditAppend({ type: "LOCAL_NOTIF_SCHEDULED", tz: TZ, generatedFor: todayKey, nDays, maxPerDay });

  if (notifications.length) {
    await LocalNotifications.schedule({ notifications });
  }
}
