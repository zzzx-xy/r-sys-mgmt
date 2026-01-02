import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// VAPID config (server-side)
webpush.setVapidDetails(
  "mailto:admin@example.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: "METHOD_NOT_ALLOWED" }),
    };
  }

  // Admin gate
  if (event.headers["x-admin-token"] !== process.env.ADMIN_TOKEN) {
    return {
      statusCode: 403,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: "FORBIDDEN" }),
    };
  }

  // Validate env
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: "MISSING_SUPABASE_ENV" }),
    };
  }
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: "MISSING_VAPID_KEYS" }),
    };
  }

  // Parse body
  let payloadIn;
  try {
    payloadIn = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: "INVALID_JSON" }),
    };
  }

  const restaurant = payloadIn?.restaurant;
  const severity = payloadIn?.severity;
  const codeType = payloadIn?.codeType;
  const code = payloadIn?.code;

  if (!restaurant || !severity || !codeType || code == null) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: "BAD_REQUEST" }),
    };
  }

  // 1) Create incident
  const { data: incident, error: insErr } = await supabase
    .from("incidents")
    .insert({
      restaurant,
      severity,
      code_type: String(codeType),
      code_value: String(code),
    })
    .select("*")
    .single();

  if (insErr || !incident) {
    console.error("incident insert error:", insErr);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: "INCIDENT_INSERT_FAILED", details: insErr?.message || null }),
    };
  }

  // 2) Update per-restaurant status (best effort)
  try {
    const { error: rsErr } = await supabase
      .from("restaurant_status")
      .update({
        open_incident_id: incident.id,
        open_severity: severity,
        updated_at: new Date().toISOString(),
      })
      .eq("restaurant", restaurant);

    if (rsErr) console.error("restaurant_status update error:", rsErr);
  } catch (e) {
    console.error("restaurant_status update exception:", e);
  }

  // 3) Load subscriptions
  const { data: rows, error: selErr } = await supabase
    .from("push_subscriptions")
    .select("id, subscription");

  if (selErr) {
    console.error("push_subscriptions select error:", selErr);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: "SUB_SELECT_FAILED", details: selErr.message }),
    };
  }

  // 4) Send push to all subscribers
  const bodyStr = `E|I=${incident.id}|R=${restaurant}|S=${severity}|C=${codeType}|V=${code}`;
  const pushPayload = JSON.stringify({
    title: "SYS-MGMT: ERROR",
    body: bodyStr,
  });

  let sent = 0;
  let failed = 0;

  for (const r of rows || []) {
    try {
      await webpush.sendNotification(r.subscription, pushPayload, { TTL: 60 });
      sent++;
    } catch (e) {
      failed++;
      // Extremely useful for debugging (410 Gone, 401, etc.)
      console.error(
        "push send failed:",
        {
          id: r.id,
          statusCode: e?.statusCode,
          body: e?.body,
          message: e?.message,
        }
      );

      // Optional cleanup: if endpoint is gone, remove subscription
      if (e?.statusCode === 410 || e?.statusCode === 404) {
        try {
          await supabase.from("push_subscriptions").delete().eq("id", r.id);
          console.error("deleted dead subscription:", r.id);
        } catch (delErr) {
          console.error("failed to delete dead subscription:", r.id, delErr);
        }
      }
    }
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: true,
      incident_id: incident.id,
      subs: (rows || []).length,
      sent,
      failed,
    }),
  };
};
