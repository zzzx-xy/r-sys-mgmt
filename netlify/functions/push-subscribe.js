import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { sub } = JSON.parse(event.body || "{}");
  if (!sub) return { statusCode: 400, body: "Missing subscription" };

  await supabase.from("push_subscriptions").insert({ subscription: sub });

  return { statusCode: 200, body: "OK" };
};
