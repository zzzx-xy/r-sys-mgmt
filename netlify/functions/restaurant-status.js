import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export const handler = async () => {
  const { data, error } = await supabase
    .from("restaurant_status")
    .select("restaurant, open_incident_id, open_severity, updated_at")
    .order("restaurant", { ascending: true });

  if (error) return { statusCode: 500, body: "Query failed" };
  return { statusCode: 200, body: JSON.stringify(data || []) };
};
