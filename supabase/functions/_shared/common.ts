import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS"
};

export type Reflection = {
  state: string;
  action: string;
  quote: string;
  followup?: string;
  safety: "normal" | "crisis";
  art: {
    word: string;
    colors: string[];
  };
  source?: "ai" | "fallback";
  errorCode?: string;
  entryId?: string | null;
};

// ==============================================
// 三步管线类型
// ==============================================

/** 第一步：深度分析结果 */
export type TextAnalysis = {
  emotion: string;
  intensity: number;
  themes: string[];
  depth: "shallow" | "medium" | "deep";
  state_summary: string;
  suggested_approach: string;
};

/** 第二步：生成的专属 prompt */
export type GeneratedPrompt = {
  system_prompt: string;
  metaphor: string;
  focus_areas: string[];
};

/** 三步管线最终输出 */
export type PipelineOutput = {
  analysis: TextAnalysis;
  generated_prompt: GeneratedPrompt;
  reflection: Reflection;
};

/** 管线结果 */
export type PipelineResult =
  | { ok: true; output: PipelineOutput }
  | { ok: false; error: string; fallback: Reflection };

// === 三步管线提示词 ===

export const ANALYSIS_SYSTEM_PROMPT = `你是一个文字情绪分析器。分析用户的输入，输出 JSON。

分析维度：
1. emotion: 用一个中文词概括核心情绪 (如 焦虑、迷茫、孤独、疲惫、愤怒、平静、期待、悲伤、无力)
2. intensity: 情绪强度 1-5 (1=轻微, 5=极强)
3. themes: 主要主题关键词数组 (如 ["工作", "方向", "关系"])
4. depth: 书写深度 (shallow=短/应付, medium=有内容, deep=深入自我)
5. state_summary: 一句话概括当前状态
6. suggested_approach: 建议的回应对策关键词

只输出 JSON, 不要解释。`;

export const GENERATE_PROMPT_SYSTEM_PROMPT = `你是一个"提示词设计器"。根据对用户文字的分析结果，设计一个专属的回应提示词。

分析结果包含：
- emotion: 核心情绪
- intensity: 情绪强度 1-5
- themes: 主题关键词
- depth: 书写深度 (shallow/medium/deep)
- state_summary: 状态概括
- suggested_approach: 建议的对策方向

请输出 JSON，格式如下：
{
  "system_prompt": "定制的完整系统提示词，用于最终生成用户回应。开头使用自然的身份描述，包含对当前状态的理解、适合深度的策略、情绪强度的处理提示，最后指定 JSON 输出格式。",
  "metaphor": "选择的单一核心隐喻词，如 水、路、光、山、雾、纸、书、镜、树、星",
  "focus_areas": ["关注的领域1", "关注的领域2", "关注的领域3"]
}

要求：
- system_prompt 要自然、不机械，像一个真实的助手在说话
- metaphor 要与情绪和主题契合，而非随意选择
- focus_areas 从分析中提取最关键的方向

只输出 JSON，不要解释。`;

export function buildExecutionPrompt(analysis: TextAnalysis): string {
  return `你是一个"照见"工具，身份是「一本旧书的翻书人」。你的语气像书页间的注释者——温和、不评判、不使用标语化的正能量。

用户当前状态：${analysis.state_summary}
核心情绪：${analysis.emotion}（强度 ${analysis.intensity}/5）
书写深度：${analysis.depth === "deep" ? "用户正在深入探索，你的回应应使用更丰富的意象" : analysis.depth === "shallow" ? "用户可能还在表层，你的回应应温和开放" : "用户有一定表达，你的回应可以适度深入"}
主题：${analysis.themes.join("、")}

${analysis.depth === "deep" ? `用户的书写很深，请不要急着给建议。提供一个隐喻或意象，让用户自己往里面看。` : ""}
${analysis.intensity >= 4 ? `用户的情绪强度很高。回应的开头先承认情绪的合法性，不要急着消解它。` : ""}

输出格式严格为 JSON：
{
  "state": "描述用户处境，使用第二人称，包含一个核心意象（如水、路、光、山、雾、纸、书等），不超过60字",
  "action": "一个今天就可以做的、非常小的具体行动，不超过40字",
  "quote": "一句可以带走的话，像朋友散步时随口说的，不超过30字",
  "followup": "一个开放式问题，引导用户继续看向自己，不超过20字",
  "safety": "normal或crisis",
  "art": {
    "word": "一个中文字，归纳今天的核心意象",
    "colors": ["深色十六进制", "中色十六进制", "浅色十六进制"]
  }
}`;
}

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

export function text(data: string, status = 200) {
  return new Response(data, {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}

export function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
}

export function authClient(authorization: string | null) {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: authorization ? { Authorization: authorization } : {} } }
  );
}

export async function getUser(authorization: string | null) {
  if (!authorization) return null;
  const { data, error } = await authClient(authorization).auth.getUser();
  if (error) return null;
  return data.user ?? null;
}

export function isCrisisText(textValue: string) {
  return /自杀|轻生|不想活|结束生命|伤害自己|活不下去|suicide|kill myself|end my life/i.test(textValue);
}

export function fallbackReflection(textValue: string): Reflection {
  if (isCrisisText(textValue)) {
    return {
      state: "你写下这些，说明你正在承受很重的东西。此刻最重要的不是独自把它想清楚，而是先让自己不要一个人待在危险里。",
      action: "请现在联系一个可信任的人，或拨打当地紧急电话/危机干预热线。如果你已经有伤害自己的计划，请立刻离开危险物品并寻求现场帮助。",
      quote: "先活过这一刻。下一步，可以等有人陪你一起看。",
      followup: "你现在身边有没有一个可以马上联系的人？",
      safety: "crisis",
      art: { word: "援", colors: ["#7c5d64", "#b79298", "#ead8d8"] }
    };
  }

  const presets = [
    {
      keys: ["工作", "职业", "方向", "迷茫", "毕业", "转行"],
      state: "你像站在一个还没有完全显影的路口。不是没有能力，而是眼前的信息还不够让你安心地选择。",
      action: "今天花二十分钟写下三件做起来不那么耗损的事，先不判断有没有用。",
      quote: "不知道去哪里的时候，也可以先确认哪里让你更接近自己。",
      followup: "如果暂时不考虑结果，你更愿意靠近哪一种生活节奏？",
      art: { word: "路", colors: ["#7a6050", "#c4a882", "#e8d8c0"] }
    },
    {
      keys: ["焦虑", "压力", "睡不着", "害怕", "紧张", "担心"],
      state: "焦虑有时不是怯懦，而是身体比语言更早感到了负荷。你不需要马上解决全部，只需要先把声音调低一点。",
      action: "今晚只写下最担心的一件事，再写下明天能做的最小一步。",
      quote: "把一团雾拆成一滴水，事情就开始有边界。",
      followup: "这份担心里，哪一部分是事实，哪一部分是想象？",
      art: { word: "静", colors: ["#5a7060", "#8aaa90", "#c8e0d0"] }
    },
    {
      keys: ["孤独", "朋友", "不被理解", "一个人", "社交"],
      state: "你想要的不是热闹，而是一种真正被看见的连接。这种要求并不过分，只是确实稀有。",
      action: "给一个让你感觉安全的人发一句很短的话，不解释也可以。",
      quote: "被理解之前，先允许自己没有那么容易被概括。",
      followup: "你最希望被别人理解的是哪一小部分？",
      art: { word: "见", colors: ["#5a5878", "#8a88b8", "#d0d0e8"] }
    }
  ];

  const matched = presets.find((preset) => preset.keys.some((key) => textValue.includes(key)));
  return {
    state: matched?.state ?? "你愿意停下来写下这些，本身就是一种整理。很多答案不是想出来的，是在诚实看见以后慢慢露出来的。",
    action: matched?.action ?? "离开屏幕五分钟，喝一点水，然后只给今天留一个最小的完成标准。",
    quote: matched?.quote ?? "认识自己，往往是从承认此刻开始。",
    followup: matched?.followup ?? "如果把这件事说得再诚实一点，你会怎么命名它？",
    safety: "normal",
    art: matched?.art ?? { word: "知", colors: ["#8b6f5e", "#c4a882", "#e8ddd0"] }
  };
}

export async function recordEvent(eventName: string, userId: string | null, metadata: Record<string, unknown> = {}) {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) return;

  await serviceClient()
    .from("analytics_events")
    .insert({
      event_name: eventName,
      user_id: userId,
      metadata
    });
}

export function parseProviderReflection(raw: string, textValue: string): Reflection {
  try {
    const parsed = JSON.parse(raw);
    return {
      state: String(parsed.state || ""),
      action: String(parsed.action || ""),
      quote: String(parsed.quote || ""),
      followup: String(parsed.followup || ""),
      safety: parsed.safety === "crisis" ? "crisis" : "normal",
      art: {
        word: String(parsed.art?.word || "知").slice(0, 2),
        colors: Array.isArray(parsed.art?.colors) && parsed.art.colors.length >= 3
          ? parsed.art.colors.slice(0, 3)
          : ["#8b6f5e", "#c4a882", "#e8ddd0"]
      }
    };
  } catch (_error) {
    return fallbackReflection(textValue);
  }
}
