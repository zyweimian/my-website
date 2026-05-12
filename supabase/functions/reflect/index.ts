import {
  authClient,
  corsHeaders,
  fallbackReflection,
  getUser,
  isCrisisText,
  json,
  parseProviderReflection,
  recordEvent,
  text,
} from "../_shared/common.ts";
import { runPipeline } from "../_shared/pipeline.ts";

type ProviderResult = {
  reflection: ReturnType<typeof fallbackReflection>;
  source: "ai" | "fallback";
  errorCode: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return text("Method not allowed", 405);

  const authorization = req.headers.get("Authorization");
  const user = await getUser(authorization);
  const body = await req.json().catch(() => ({}));
  const inputText = String(body.text || "").trim();
  const useMemory = Boolean(body.useMemory);

  if (!inputText) return text("Missing text", 400);
  if (inputText.length > 4000) return text("Text is too long", 400);

  const history = user && useMemory ? await loadHistory(authorization) : [];

  // 尝试三步管线，失败时降级到传统单次调用
  let reflection;
  let source: "ai" | "fallback" = "fallback";
  let errorCode: string | null = null;

  const pipelineResult = await runPipeline(inputText);

  if (pipelineResult.ok) {
    reflection = pipelineResult.output.reflection;
    source = "ai";
    errorCode = null;

    console.log("pipeline_analysis", JSON.stringify({
      emotion: pipelineResult.output.analysis.emotion,
      intensity: pipelineResult.output.analysis.intensity,
      themes: pipelineResult.output.analysis.themes,
      depth: pipelineResult.output.analysis.depth,
      core_need: pipelineResult.output.analysis.core_need,
    }));
  } else {
    const tradResult = await generateTraditional(inputText, history);
    reflection = tradResult.reflection;
    source = tradResult.source;
    errorCode = pipelineResult.error || tradResult.errorCode;
  }

  if (isCrisisText(inputText)) {
    reflection = fallbackReflection(inputText);
    source = "fallback";
    errorCode = "crisis_safety_override";
  }

  let entryId: string | null = null;
  if (user && authorization) {
    const { data, error } = await authClient(authorization)
      .from("reflection_entries")
      .insert({
        user_id: user.id,
        input_text: inputText,
        entry: reflection.entry,
        safety: reflection.safety,
        art: reflection.art,
      })
      .select("id")
      .single();

    if (!error) entryId = data.id;
  }

  await recordEvent("reflect_created", user?.id ?? null, {
    signed_in: Boolean(user),
    use_memory: useMemory,
    safety: reflection.safety,
    source,
    error_code: errorCode,
    input_length_bucket: bucketLength(inputText.length),
  });

  return json({ ...reflection, source, errorCode, entryId });
});

async function loadHistory(authorization: string | null) {
  const { data } = await authClient(authorization)
    .from("reflection_entries")
    .select("entry, created_at")
    .order("created_at", { ascending: false })
    .limit(5);

  return data ?? [];
}

async function generateTraditional(
  inputText: string,
  history: Array<Record<string, string>>,
): Promise<ProviderResult> {
  const apiKey = Deno.env.get("DEEPSEEK_API_KEY");
  const model = Deno.env.get("DEEPSEEK_MODEL") || "deepseek-v4-flash";
  const baseUrl = Deno.env.get("DEEPSEEK_BASE_URL") || "https://api.deepseek.com";

  if (!apiKey) {
    return {
      reflection: fallbackReflection(inputText),
      source: "fallback",
      errorCode: "missing_deepseek_api_key",
    };
  }

  const system = [
    "你是一个温柔的日志守护者和倾听者。有一个人刚刚向你敞开了心里话。",
    "请写一段温暖的回应：",
    "第一段——接住他。告诉他你听到了什么，让他感到被理解。",
    "第二段——陪伴他。分享一个视角或意象，帮助他从不同光线下看看自己的处境。",
    "第三段——留白。用一个温柔的开放式问题收尾。",
    "用'你'来称呼，像在写信。语言自然、有温度。不要用列表或标题。不用输出 JSON。",
  ].join("\n");

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.75,
        max_tokens: 1200,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: JSON.stringify({
              current_text: inputText,
              optional_history: history,
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error("DeepSeek reflection request failed", response.status, await response.text());
      return {
        reflection: fallbackReflection(inputText),
        source: "fallback",
        errorCode: `deepseek_http_${response.status}`,
      };
    }

    const data = await response.json();
    return {
      reflection: parseProviderReflection(data.choices?.[0]?.message?.content ?? "", inputText),
      source: "ai",
      errorCode: null,
    };
  } catch (error) {
    console.error("DeepSeek reflection request errored", error);
    return {
      reflection: fallbackReflection(inputText),
      source: "fallback",
      errorCode: "deepseek_request_error",
    };
  }
}

function bucketLength(length: number) {
  if (length < 80) return "short";
  if (length < 400) return "medium";
  return "long";
}
