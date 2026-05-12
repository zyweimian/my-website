import { authClient, corsHeaders, getUser, json, recordEvent, text } from "../_shared/common.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "DELETE") return text("Method not allowed", 405);

  const user = await getUser(req.headers.get("Authorization"));
  if (!user) return text("Unauthorized", 401);

  const { error } = await authClient(req.headers.get("Authorization"))
    .from("reflection_entries")
    .delete()
    .eq("user_id", user.id);

  if (error) return text(error.message, 500);

  await recordEvent("account_data_cleared", user.id, {});
  return json({ ok: true });
});
