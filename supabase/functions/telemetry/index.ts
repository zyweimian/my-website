import { corsHeaders, getUser, json, recordEvent, text } from "../_shared/common.ts";

const allowedEvents = new Set([
  "page_view",
  "login_completed"
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return text("Method not allowed", 405);

  const body = await req.json().catch(() => ({}));
  const eventName = String(body.eventName || "");
  if (!allowedEvents.has(eventName)) return text("Unknown event", 400);

  const user = await getUser(req.headers.get("Authorization"));
  await recordEvent(eventName, user?.id ?? null, sanitizeMetadata(body.metadata));
  return json({ ok: true });
});

function sanitizeMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string | number | boolean> = {};

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[a-z0-9_]{1,40}$/.test(key)) continue;
    if (typeof raw === "string") result[key] = raw.slice(0, 80);
    if (typeof raw === "number" || typeof raw === "boolean") result[key] = raw;
  }

  return result;
}
