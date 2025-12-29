import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

webpush.setVapidDetails(
  "mailto:admin@example.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  if (event.headers["x-admin-token"] !== process.env.ADMIN_TOKEN) {
    return { statusCode: 403, body: "Forbidden" };
  }

  const { restaurant, severity, codeType, code } = JSON.parse(event.body || "{}");

  const payload = JSON.stringify({
    title: "SYS-MGMT: ERROR",
    body: `E|R=${restaurant}|S=${severity}|C=${codeType}|V=${code}`,
  });

  const { data: rows } = await supabase
    .from("push_subscriptions")
    .select("subscription");

  let sent = 0;
  for (const r of rows || []) {
    try {
      await webpush.sendNotification(r.subscription, payload);
      sent++;
    } catch {}
  }

  return { statusCode: 200, body: JSON.stringify({ sent }) };
};
