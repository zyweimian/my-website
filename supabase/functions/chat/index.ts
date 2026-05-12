import {
  authClient,
  corsHeaders,
  fallbackReflection,
  getUser,
  isCrisisText,
  json,
  recordEvent,
  text
} from "../_shared/common.ts";

type ChatResult = {
  reply: string;
  source: "ai" | "fallback";
  errorCode: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return text("Method not allowed", 405);

  const authorization = req.headers.get("Authorization");
  const user = await getUser(authorization);
  const body = await req.json().catch(() => ({}));
  const message = String(body.message || "").trim();
  const entryId = body.entryId ? String(body.entryId) : null;
  const useMemory = Boolean(body.useMemory);

  if (!message) return text("Missing message", 400);
  if (message.length > 2000) return text("Message is too long", 400);

  const context = user && entryId ? await loadEntry(authorization, entryId) : body.reflection ?? null;
  const history = user && useMemory ? await loadHistory(authorization) : [];
  const result = await generateReply(message, context, history);

  await recordEvent("chat_replied", user?.id ?? null, {
    signed_in: Boolean(user),
    use_memory: useMemory,
    safety: isCrisisText(message) ? "crisis" : "normal",
    source: result.source,
    error_code: result.errorCode,
    message_length_bucket: message.length < 80 ? "short" : "medium"
  });

  return json(result);
});

async function loadEntry(authorization: string | null, entryId: string) {
  const { data } = await authClient(authorization)
    .from("reflection_entries")
    .select("state, action, quote, followup")
    .eq("id", entryId)
    .single();

  return data;
}

async function loadHistory(authorization: string | null) {
  const { data } = await authClient(authorization)
    .from("reflection_entries")
    .select("state, action, quote, created_at")
    .order("created_at", { ascending: false })
    .limit(5);

  return data ?? [];
}

async function generateReply(message: string, context: unknown, history: unknown[]): Promise<ChatResult> {
  if (isCrisisText(message)) {
    return {
      reply: fallbackReflection(message).action,
      source: "fallback",
      errorCode: "crisis_safety_override"
    };
  }

  const apiKey = Deno.env.get("DEEPSEEK_API_KEY");
  const model = Deno.env.get("DEEPSEEK_MODEL") || "deepseek-v4-flash";
  const baseUrl = Deno.env.get("DEEPSEEK_BASE_URL") || "https://api.deepseek.com";

  if (!apiKey) {
    return {
      reply: "我听见你又往里走了一点。试着把这句话补完：真正让我在意的不是这件事本身，而是它让我感觉到……",
      source: "fallback",
      errorCode: "missing_deepseek_api_key"
    };
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0.65,
        max_tokens: 220,
        messages: [
          {
            role: "system",
            content: "你是一个中文私密自我照见工具。用温柔但克制的语气回应，不做心理诊断，不承诺治疗。回答 80 字以内，最好以一个帮助用户继续看清自己的问题收束。"
          },
          {
            role: "user",
            content: JSON.stringify({ message, current_reflection: context, optional_history: history })
          }
        ]
      })
    });

    if (!response.ok) {
      console.error("DeepSeek chat request failed", response.status, await response.text());
      return {
        reply: "我听见你又往里走了一点。先不用急着解释全部，试着说说：这件事最刺痛你的地方在哪里？",
        source: "fallback",
        errorCode: `deepseek_http_${response.status}`
      };
    }

    const data = await response.json();
    return {
      reply: data.choices?.[0]?.message?.content?.trim() || "我在。你可以再慢一点说。",
      source: "ai",
      errorCode: null
    };
  } catch (error) {
    console.error("DeepSeek chat request errored", error);
    return {
      reply: "我听见你又往里走了一点。先不用急着解释全部，试着说说：这件事最刺痛你的地方在哪里？",
      source: "fallback",
      errorCode: "deepseek_request_error"
    };
  }
}
