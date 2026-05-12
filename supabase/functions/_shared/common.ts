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
