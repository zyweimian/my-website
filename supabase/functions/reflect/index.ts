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
        state: reflection.state,
        action: reflection.action,
        quote: reflection.quote,
        followup: reflection.followup,
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
    .select("state, action, quote, created_at")
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
    "你是一个中文私密自我照见工具，不是心理医生。",
    "语气温柔、安静、克制，不诊断，不承诺治疗，不制造依赖。",
    "如果文本涉及自伤、自杀、危险计划或强烈危机，输出 safety=crisis，并建议联系可信任的人、当地紧急服务或专业资源。",
    "只输出 JSON，不要 markdown。",
    "JSON 字段必须是：state, action, quote, followup, safety, art。",
    "art 必须包含 word（1 个中文字符）和 colors（3 个十六进制颜色）。",
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
        temperature: 0.7,
        max_tokens: 900,
        response_format: { type: "json_object" },
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
