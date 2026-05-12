import { authClient, corsHeaders, getUser, json, recordEvent, text } from "../_shared/common.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const user = await getUser(req.headers.get("Authorization"));
  if (!user) return text("Unauthorized", 401);

  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const maybeId = parts[parts.length - 1] === "entries" ? null : parts[parts.length - 1];

  if (req.method === "GET") {
    const { data, error } = await authClient(req.headers.get("Authorization"))
      .from("reflection_entries")
      .select("id, input_text, state, action, quote, followup, safety, art, created_at")
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) return text(error.message, 500);
    return json({ entries: data ?? [] });
  }

  if (req.method === "DELETE" && maybeId) {
    const { error } = await authClient(req.headers.get("Authorization"))
      .from("reflection_entries")
      .delete()
      .eq("id", maybeId);

    if (error) return text(error.message, 500);
    await recordEvent("entry_deleted", user.id, {});
    return json({ ok: true });
  }

  return text("Method not allowed", 405);
});
