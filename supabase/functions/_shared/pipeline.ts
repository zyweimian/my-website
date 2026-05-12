import {
  type TextAnalysis,
  type GeneratedPrompt,
  type PipelineOutput,
  type PipelineResult,
  type Reflection,
  fallbackReflection,
  parseProviderReflection,
  isCrisisText,
  ANALYSIS_SYSTEM_PROMPT,
  GENERATE_PROMPT_SYSTEM_PROMPT,
  buildExecutionPrompt,
} from "./common.ts";

// ==============================================
// 三步管线核心编排
// ==============================================

const DEEPSEEK_CONFIG = {
  baseUrl: (Deno.env.get("DEEPSEEK_BASE_URL") || "https://api.deepseek.com").replace(/\/$/, ""),
  model: Deno.env.get("DEEPSEEK_MODEL") || "deepseek-v4-flash",
  apiKey: Deno.env.get("DEEPSEEK_API_KEY") || "",
};

type CallOptions = {
  system: string;
  userContent: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "json_object" | "text";
};

async function callDeepSeek(options: CallOptions): Promise<string | null> {
  if (!DEEPSEEK_CONFIG.apiKey) return null;

  const body: Record<string, unknown> = {
    model: DEEPSEEK_CONFIG.model,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 1000,
    messages: [
      { role: "system", content: options.system },
      { role: "user", content: options.userContent },
    ],
  };

  if (options.responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
  }

  try {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 15000);

    const response = await fetch(`${DEEPSEEK_CONFIG.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DEEPSEEK_CONFIG.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: abortController.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error("DeepSeek call failed", response.status, await response.text());
      return null;
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? null;
  } catch (error) {
    console.error("DeepSeek call errored", error);
    return null;
  }
}

/** 步骤一：深度分析用户输入 */
export async function analyzeText(text: string): Promise<TextAnalysis | null> {
  const content = await callDeepSeek({
    system: ANALYSIS_SYSTEM_PROMPT,
    userContent: text,
    temperature: 0.4,
    maxTokens: 400,
    responseFormat: "json_object",
  });

  if (!content) return null;

  try {
    const parsed = JSON.parse(content);
    return {
      emotion: String(parsed.emotion || "未知").slice(0, 4),
      intensity: Math.min(5, Math.max(1, Number(parsed.intensity) || 3)),
      themes: Array.isArray(parsed.themes) ? parsed.themes.slice(0, 5).map(String) : [],
      depth: ["shallow", "medium", "deep"].includes(parsed.depth)
        ? parsed.depth as "shallow" | "medium" | "deep"
        : "medium",
      state_summary: String(parsed.state_summary || "").slice(0, 120),
      core_need: String(parsed.core_need || "被倾听和理解").slice(0, 60),
      listening_tone: String(parsed.listening_tone || "温柔而深刻").slice(0, 30),
      suggested_approach: String(parsed.suggested_approach || "").slice(0, 100),
    };
  } catch {
    return null;
  }
}

/** 步骤二：根据分析结果生成专属 prompt（AI 辅助生成，失败时降级到模板） */
export async function generatePromptAI(analysis: TextAnalysis): Promise<GeneratedPrompt | null> {
  const content = await callDeepSeek({
    system: GENERATE_PROMPT_SYSTEM_PROMPT,
    userContent: JSON.stringify(analysis),
    temperature: 0.6,
    maxTokens: 600,
    responseFormat: "json_object",
  });

  if (!content) return null;

  try {
    const parsed = JSON.parse(content);
    return {
      system_prompt: String(parsed.system_prompt || buildExecutionPrompt(analysis)),
      metaphor: String(parsed.metaphor || "镜").slice(0, 4),
      focus_areas: Array.isArray(parsed.focus_areas)
        ? parsed.focus_areas.slice(0, 3).map(String)
        : [`情绪: ${analysis.emotion} (强度 ${analysis.intensity})`, `主题: ${analysis.themes.join(", ")}`],
      response_identity: String(parsed.response_identity || "").slice(0, 100) || undefined,
      tone_guide: String(parsed.tone_guide || "").slice(0, 80) || undefined,
    };
  } catch {
    return null;
  }
}

/** 步骤二（降级）：模板方式生成 prompt */
export function generatePrompt(analysis: TextAnalysis): GeneratedPrompt {
  return {
    system_prompt: buildExecutionPrompt(analysis),
    metaphor: analysis.depth === "deep" ? "水 / 深度意象" : "路 / 方向意象",
    focus_areas: [
      `情绪: ${analysis.emotion} (强度 ${analysis.intensity})`,
      `主题: ${analysis.themes.join(", ")}`,
      `深度: ${analysis.depth}`,
    ],
  };
}

/** 步骤三：执行 prompt 生成最终回应 */
export async function executeReflection(
  inputText: string,
  generatedPrompt: GeneratedPrompt,
): Promise<Reflection | null> {
  // 构建 enriched system prompt
  const parts: string[] = [];

  if (generatedPrompt.response_identity) {
    parts.push(`你的身份：${generatedPrompt.response_identity}`);
  }
  if (generatedPrompt.tone_guide) {
    parts.push(`语气：${generatedPrompt.tone_guide}`);
  }

  parts.push(generatedPrompt.system_prompt);
  const systemPrompt = parts.join("\n\n");

  const content = await callDeepSeek({
    system: systemPrompt,
    userContent: inputText,
    temperature: 0.75,
    maxTokens: 1200,
    responseFormat: "text",
  });

  if (!content) return null;

  return parseProviderReflection(content, inputText);
}

/** 完整管线编排：分析 → 生成 prompt → 执行 */
export async function runPipeline(inputText: string): Promise<PipelineResult> {
  // 危机文本绕过管线，直接走安全兜底
  if (isCrisisText(inputText)) {
    return {
      ok: false,
      error: "crisis_safety_override",
      fallback: fallbackReflection(inputText),
    };
  }

  // 检查 API key
  if (!DEEPSEEK_CONFIG.apiKey) {
    return {
      ok: false,
      error: "missing_deepseek_api_key",
      fallback: fallbackReflection(inputText),
    };
  }

  // Step 1: 分析
  const analysis = await analyzeText(inputText);
  if (!analysis) {
    return {
      ok: false,
      error: "analysis_failed",
      fallback: fallbackReflection(inputText),
    };
  }

  // Step 2: 生成专属 prompt（AI 优先，失败降级到模板）
  const generatedPrompt = (await generatePromptAI(analysis)) ?? generatePrompt(analysis);

  // Step 3: 执行
  const reflection = await executeReflection(inputText, generatedPrompt);
  if (!reflection) {
    return {
      ok: false,
      error: "execution_failed",
      fallback: fallbackReflection(inputText),
    };
  }

  console.log(
    JSON.stringify({
      pipeline: "completed",
      emotion: analysis.emotion,
      intensity: analysis.intensity,
      themes: analysis.themes,
      depth: analysis.depth,
      core_need: analysis.core_need,
      metaphor: generatedPrompt.metaphor,
    }),
  );

  return {
    ok: true,
    output: {
      analysis,
      generated_prompt: generatedPrompt,
      reflection,
    },
  };
}
