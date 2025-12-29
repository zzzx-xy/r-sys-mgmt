import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  const { incidentId, eventType, actorId, actorLabel } = JSON.parse(event.body || "{}");
  if (!incidentId || !eventType || !actorId) return { statusCode: 400, body: "Bad Request" };

  if (eventType !== "ACK" && eventType !== "FIX") return { statusCode: 400, body: "Invalid eventType" };

  // Insert event row
  const { error: evErr } = await supabase.from("incident_events").insert({
    incident_id: incidentId,
    event_type: eventType,
    actor_id: actorId,
    actor_label: actorLabel || null,
  });

  if (evErr) return { statusCode: 500, body: "Insert failed" };

  // If FIX: mark incident resolved + clear restaurant status (only if this incident is still the open one)
  if (eventType === "FIX") {
    const { data: inc } = await supabase.from("incidents").select("restaurant").eq("id", incidentId).single();

    if (inc?.restaurant) {
      await supabase.from("incidents").update({ resolved_at: new Date().toISOString() }).eq("id", incidentId);

      // Clear status if this incident is the currently open one
      await supabase
        .from("restaurant_status")
        .update({ open_incident_id: null, open_severity: null, updated_at: new Date().toISOString() })
        .eq("restaurant", inc.restaurant)
        .eq("open_incident_id", incidentId);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
