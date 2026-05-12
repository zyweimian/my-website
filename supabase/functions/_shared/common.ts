import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS"
};

/** 回应：一封温暖的信 */
export type Reflection = {
  entry: string;             // AI 的回信正文——温暖、自然、有内容的叙述
  followup?: string;         // 留给用户的开放式问题（可选）
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
  core_need: string;
  listening_tone: string;
  suggested_approach: string;
};

/** 第二步：生成的专属 prompt */
export type GeneratedPrompt = {
  system_prompt: string;
  metaphor: string;
  focus_areas: string[];
  response_identity?: string;
  tone_guide?: string;
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

export const ANALYSIS_SYSTEM_PROMPT = `你是一个深度文字倾听分析器。分析用户的输入，输出 JSON。

分析维度：
1. emotion: 用一个中文词概括核心情绪 (如 焦虑、迷茫、孤独、疲惫、愤怒、平静、期待、悲伤、无力、困惑、不安、释然)
2. intensity: 情绪强度 1-5 (1=轻微, 5=极强)
3. themes: 主要主题关键词数组 (如 ["工作", "方向", "关系", "自我", "意义", "成长"])
4. depth: 书写深度 (shallow=短/应付, medium=有内容, deep=深入自我)
5. state_summary: 一句话概括当前状态（用第二人称，像在描述一幅画面）
6. core_need: 用户此刻最需要什么（如"被倾听和理解"、"找到方向"、"确认自己的感受是正常的"、"具体的行动建议"、"陪伴感"）
7. listening_tone: 回应应该采用的语气（如"温柔而深刻"、"直接而温和"、"诗意而安静"、"朴实而坚定"）
8. suggested_approach: 建议的回应策略关键词（如"先共情再引导"、"提供新视角"、"确认正常化"、"温和提问"）

只输出 JSON, 不要解释。`;

export const GENERATE_PROMPT_SYSTEM_PROMPT = `你是一个"回应设计师"。根据分析结果，设计一个专属的回应方案，让最终回应像 Claude 那样思考。

Claude 的回应的特点：
1. 先确认和接住——"我听见你说……"，让对方感到被理解
2. 用探索性的语言——"我在想是不是……"、"也许可以试试……"
3. 不直接给建议，而是提供视角和意象
4. 自然而丰富的隐喻，不刻意
5. 对话式的语气，像一个有智慧的朋友在聊天
6. 以真诚的开放式问题收尾
7. 尊重对方的自主性和内在智慧

分析结果包含：
- emotion: 核心情绪
- intensity: 情绪强度 1-5
- themes: 主题关键词
- depth: 书写深度
- state_summary: 状态概括
- core_need: 核心需求
- listening_tone: 建议语气

输出 JSON：
{
  "response_identity": "用一句话描述 AI 在这个回应中应成为的角色（如'一个坐在炉火边的老朋友，见过很多种人生'）",
  "system_prompt": "定制的回应提示词。告诉 AI：1）这个人的处境和需要 2）用 Claude 式的语气——先接住、再探索、最后必须留一个温和的开放式问题 3）要写得像在写信，不要用列表或标题 4）回应 3-4 段，最后一段以 ? 结尾",
  "metaphor": "与情绪和主题契合的核心隐喻词",
  "tone_guide": "一句语气指导，如'像 Claude 那样——温暖、清晰、有深度，不急着给答案'",
  "focus_areas": ["回应的核心关注点1", "核心关注点2"]
}

只输出 JSON，不要解释。`;

/** 构建执行 prompt（降级备选方案）—— Claude 风格 */
export function buildExecutionPrompt(analysis: TextAnalysis): string {
  const { state_summary, emotion, intensity, themes, depth, core_need, listening_tone } = analysis;

  return `你是一个温暖、有深度的倾听者，风格像 Claude——不急不缓，不用标语式的正能量。

你在回应一个人，他刚刚向你说了心里话：

他的状态：${state_summary}
他的情绪：${emotion}（程度 ${intensity}/5）
他在思考：${themes.join("、")}
他真正需要的：${core_need}

${depth === "deep"
  ? "他写得很深。不要急着给建议，先在这个深度里陪他待一会儿。"
  : depth === "shallow"
    ? "他可能还在试探。你的回应要温暖开放，让他感到这里是安全的。"
    : "他已经开始表达了。在理解的基础上，温和地引导他看得更深一点。"}

${intensity >= 4 ? "他的情绪很重。先让他感到你听见了，不要急着消解。" : ""}

请这样回应：

先接住他——用自己的话复述他的感受，让他感到被真正理解。
再陪伴他——分享一个视角或意象，帮助他从不同的光线下看自己的处境。不要给"你应该"的建议。
最后留一个温和的开放式问题——这句话非常重要，请务必以一个问题收尾，让对话可以继续下去。

回应的要点：
- 用"你"来称呼，像在写信
- 语言自然、有温度，像 Claude 那样——温暖、清晰、不评判
- 不要用列表、标题、引用格式
- 不要输出 JSON
- 写 3-4 段，最后一段以一个温柔的 ? 问句结束`;
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
      entry: "你写下这些，说明你正在承受很重的东西。此刻最重要的不是独自把它想清楚，而是先让自己不要一个人待在危险里。\n\n请现在联系一个你信任的人，或者拨打当地的心理危机干预热线。如果你已经有伤害自己的计划，请立刻离开危险物品，寻求现场帮助。\n\n先活过这一刻。下一步，可以等有人陪你一起看。",
      safety: "crisis",
      art: { word: "援", colors: ["#7c5d64", "#b79298", "#ead8d8"] }
    };
  }

  const presets = [
    {
      keys: ["工作", "职业", "方向", "迷茫", "毕业", "转行"],
      entry: "你像站在一个还没有完全显影的路口。不是没有能力，而是眼前的信息还不够让你安心地选择。\n\n不知道去哪里的时候，也可以先确认哪里让你更接近自己。如果暂时不考虑结果，你更愿意靠近哪一种生活节奏？今天或许可以花二十分钟写下三件做起来不那么耗损的事，先不判断有没有用。",
      art: { word: "路", colors: ["#7a6050", "#c4a882", "#e8d8c0"] }
    },
    {
      keys: ["焦虑", "压力", "睡不着", "害怕", "紧张", "担心"],
      entry: "焦虑有时不是怯懦，而是身体比语言更早感到了负荷。你不需要马上解决全部，只需要先把声音调低一点。\n\n把一团雾拆成一滴水，事情就开始有边界。今晚可以只写下最担心的一件事，再写下明天能做的最小一步。那份担心里，哪一部分是事实，哪一部分是想象？",
      art: { word: "静", colors: ["#5a7060", "#8aaa90", "#c8e0d0"] }
    },
    {
      keys: ["孤独", "朋友", "不被理解", "一个人", "社交"],
      entry: "你想要的不是热闹，而是一种真正被看见的连接。这种要求并不过分，只是确实稀有。\n\n被理解之前，先允许自己没有那么容易被概括。也许可以给一个让你感觉安全的人发一句很短的话，不解释也可以。你最希望被别人理解的是哪一小部分？",
      art: { word: "见", colors: ["#5a5878", "#8a88b8", "#d0d0e8"] }
    }
  ];

  const matched = presets.find((preset) => preset.keys.some((key) => textValue.includes(key)));
  return {
    entry: matched?.entry ?? "你愿意停下来写下这些，本身就是一种整理。很多答案不是想出来的，是在诚实看见以后慢慢露出来的。\n\n离开屏幕五分钟，喝一点水，然后只给今天留一个最小的完成标准。如果把这件事说得再诚实一点，你会怎么命名它？",
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
  // 尝试解析 JSON
  try {
    const parsed = JSON.parse(raw);
    if (parsed.entry || parsed.state) {
      return {
        entry: String(parsed.entry || parsed.state || ""),
        followup: String(parsed.followup || ""),
        safety: parsed.safety === "crisis" ? "crisis" : "normal",
        art: {
          word: String(parsed.art?.word || "知").slice(0, 2),
          colors: Array.isArray(parsed.art?.colors) && parsed.art.colors.length >= 3
            ? parsed.art.colors.slice(0, 3)
            : ["#8b6f5e", "#c4a882", "#e8ddd0"]
        }
      };
    }
  } catch {
    // 不是 JSON，走纯文本分支
  }

  // 纯文本回应的处理：整段作为 entry
  const trimmed = raw.trim();
  if (trimmed.length > 20) {
    // 尝试分离最后一句问句作为 followup
    const sentences = trimmed.split(/(?<=[。？！\n])/);
    let entry = trimmed;
    let followup = "";

    if (sentences.length >= 2) {
      const last = sentences[sentences.length - 1].trim();
      if (/[？?]$/.test(last) && last.length < 40) {
        followup = last;
        entry = sentences.slice(0, -1).join("");
      }
    }

    return {
      entry: entry.trim(),
      followup: followup || undefined,
      safety: "normal",
      art: { word: "知", colors: ["#8b6f5e", "#c4a882", "#e8ddd0"] }
    };
  }

  return fallbackReflection(textValue);
}
