const webpush = require("web-push");

let SUBS = []; // demo only (in-memory)

exports.handler = async () => {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return { statusCode: 500, body: "Missing VAPID keys" };

  webpush.setVapidDetails("mailto:admin@example.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const payload = JSON.stringify({ title: "SYS-MGMT: ERROR", body: "E|R=R1|S=WARN|D=0000-00-00" });

  const results = [];
  for (const sub of SUBS) {
    try {
      await webpush.sendNotification(sub, payload, { TTL: 60 });
      results.push({ ok: true });
    } catch (e) {
      results.push({ ok: false, err: String(e) });
    }
  }

  return { statusCode: 200, body: JSON.stringify(results) };
};
