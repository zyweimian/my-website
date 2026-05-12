(function () {
  const config = window.APP_CONFIG || {};
  const hasSupabaseConfig = Boolean(config.supabaseUrl && config.supabaseAnonKey);
  const functionsBaseUrl = config.functionsBaseUrl || (config.supabaseUrl ? `${config.supabaseUrl}/functions/v1` : "");
  const client = hasSupabaseConfig
    ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: true,
          persistSession: true
        }
      })
    : null;

  const els = {
    today: document.getElementById("today"),
    authToggle: document.getElementById("authToggle"),
    authPanel: document.getElementById("authPanel"),
    authForm: document.getElementById("authForm"),
    authStatus: document.getElementById("authStatus"),
    emailInput: document.getElementById("emailInput"),
    thoughtInput: document.getElementById("thoughtInput"),
    useMemory: document.getElementById("useMemory"),
    sessionState: document.getElementById("sessionState"),
    reflectBtn: document.getElementById("reflectBtn"),
    thinking: document.getElementById("thinking"),
    result: document.getElementById("result"),
    stateText: document.getElementById("stateText"),
    actionText: document.getElementById("actionText"),
    quoteText: document.getElementById("quoteText"),
    artSvg: document.getElementById("artSvg"),
    artNote: document.getElementById("artNote"),
    saveArtBtn: document.getElementById("saveArtBtn"),
    chatForm: document.getElementById("chatForm"),
    chatInput: document.getElementById("chatInput"),
    chatMessages: document.getElementById("chatMessages"),
    archiveList: document.getElementById("archiveList"),
    clearDataBtn: document.getElementById("clearDataBtn")
  };

  const today = new Date();
  let session = null;
  let currentEntryId = null;
  let currentReflection = null;

  els.today.textContent = `${today.getFullYear()} · ${String(today.getMonth() + 1).padStart(2, "0")} · ${String(today.getDate()).padStart(2, "0")}`;
  bindEvents();
  boot();

  function bindEvents() {
    els.authToggle.addEventListener("click", handleAuthToggle);
    els.authForm.addEventListener("submit", handleMagicLink);
    els.reflectBtn.addEventListener("click", handleReflect);
    els.chatForm.addEventListener("submit", handleChat);
    els.saveArtBtn.addEventListener("click", saveArt);
    els.clearDataBtn.addEventListener("click", clearAccountData);
  }

  async function boot() {
    if (!client) {
      setAuthMessage("未配置 Supabase 时会使用本地兜底回应，不会保存档案。");
      renderArchive([]);
      return;
    }

    await consumeAuthCallbackIfNeeded();

    const { data } = await client.auth.getSession();
    session = data.session;
    client.auth.onAuthStateChange((event, nextSession) => {
      session = nextSession;
      updateAuthUi();
      loadEntries();
      if (event === "SIGNED_IN") recordTelemetry("login_completed");
    });

    updateAuthUi();
    recordTelemetry("page_view");
    await loadEntries();
  }

  async function consumeAuthCallbackIfNeeded() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code) return;

    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) {
      setAuthMessage(`登录回调失败：${error.message}`);
      return;
    }

    window.history.replaceState({}, document.title, window.location.pathname);
  }

  async function handleAuthToggle() {
    if (!client) {
      setAuthMessage("请先在 config.js 填入 Supabase URL 和 anon key。");
      els.authPanel.hidden = false;
      return;
    }

    if (session) {
      await client.auth.signOut();
      return;
    }

    els.authPanel.hidden = !els.authPanel.hidden;
  }

  async function handleMagicLink(event) {
    event.preventDefault();
    if (!client) return;

    const email = els.emailInput.value.trim();
    if (!email) return;

    setAuthMessage("正在发送登录链接……");
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error } = await client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo,
        shouldCreateUser: true
      }
    });

    setAuthMessage(error ? `发送失败：${error.message}` : "登录链接已经发送，请查收邮箱。");
  }

  async function handleReflect() {
    const text = els.thoughtInput.value.trim();
    if (!text) {
      els.thoughtInput.focus();
      return;
    }

    setBusy(true);
    clearChat();

    try {
      const reflection = await callFunction("reflect", {
        text,
        useMemory: Boolean(session && els.useMemory.checked)
      });
      currentEntryId = reflection.entryId || null;
      currentReflection = reflection;
      renderReflection(reflection);
      if (reflection.source === "fallback" && reflection.errorCode) {
        setAuthMessage(`已连接动态函数，但本次使用兜底回应：${reflection.errorCode}`);
      }
      await loadEntries();
    } catch (error) {
      const reflection = localReflect(text);
      currentEntryId = null;
      currentReflection = reflection;
      renderReflection(reflection);
      setAuthMessage(`动态服务暂时不可用，已使用本地兜底回应。${error.message ? `（${error.message}）` : ""}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleChat(event) {
    event.preventDefault();
    const message = els.chatInput.value.trim();
    if (!message) return;

    appendMessage("user", message);
    els.chatInput.value = "";

    try {
      const result = await callFunction("chat", {
        entryId: currentEntryId,
        message,
        useMemory: Boolean(session && els.useMemory.checked),
        reflection: currentReflection
      });
      appendMessage("ai", result.reply);
      if (result.source === "fallback" && result.errorCode) {
        setAuthMessage(`继续说使用了兜底回应：${result.errorCode}`);
      }
    } catch (_error) {
      appendMessage("ai", localChatReply(message));
    }
  }

  async function callFunction(name, payload) {
    if (!functionsBaseUrl) {
      throw new Error("缺少 functionsBaseUrl");
    }

    const headers = {
      "Content-Type": "application/json",
      apikey: config.supabaseAnonKey
    };
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

    const response = await fetch(`${functionsBaseUrl}/${name}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    return response.json();
  }

  async function recordTelemetry(eventName, metadata = {}) {
    if (!functionsBaseUrl) return;

    const headers = {
      "Content-Type": "application/json",
      apikey: config.supabaseAnonKey
    };
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

    try {
      await fetch(`${functionsBaseUrl}/telemetry`, {
        method: "POST",
        headers,
        body: JSON.stringify({ eventName, metadata })
      });
    } catch (_error) {
      // Analytics should never block the reflection experience.
    }
  }

  async function loadEntries() {
    if (!session || !functionsBaseUrl) {
      renderArchive([]);
      return;
    }

    const response = await fetch(`${functionsBaseUrl}/entries`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: config.supabaseAnonKey
      }
    });

    if (!response.ok) {
      renderArchive([]);
      return;
    }

    const data = await response.json();
    renderArchive(data.entries || []);
  }

  async function deleteEntry(id) {
    if (!session || !functionsBaseUrl) return;

    await fetch(`${functionsBaseUrl}/entries/${id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: config.supabaseAnonKey
      }
    });
    await loadEntries();
  }

  async function clearAccountData() {
    if (!session || !functionsBaseUrl) return;
    if (!window.confirm("确定清空全部私密档案吗？这个操作不能撤销。")) return;

    await fetch(`${functionsBaseUrl}/account-data`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: config.supabaseAnonKey
      }
    });
    await loadEntries();
  }

  function renderReflection(data) {
    els.stateText.textContent = data.state;
    els.actionText.textContent = data.action;
    els.quoteText.textContent = data.quote;
    drawArt(data.art || fallbackArt());
    els.result.hidden = false;
    els.result.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderArchive(entries) {
    els.clearDataBtn.hidden = !session || entries.length === 0;

    if (!session) {
      els.archiveList.innerHTML = '<p class="empty">登录后，这里会保存你选择留下的照见记录。</p>';
      return;
    }

    if (!entries.length) {
      els.archiveList.innerHTML = '<p class="empty">这里还没有记录。某一天你想留下什么，它会安静地在这里。</p>';
      return;
    }

    els.archiveList.innerHTML = "";
    entries.forEach((entry) => {
      const card = document.createElement("article");
      card.className = "entry-card";
      const created = new Date(entry.created_at).toLocaleDateString("zh-CN");
      card.innerHTML = `
        <p class="entry-date">${created}</p>
        <p class="entry-title">${escapeHtml(entry.state || entry.input_text.slice(0, 56))}</p>
        <div class="entry-actions">
          <button type="button" data-open="${entry.id}">回看</button>
          <button type="button" class="danger" data-delete="${entry.id}">删除</button>
        </div>
      `;
      card.querySelector("[data-open]").addEventListener("click", () => openEntry(entry));
      card.querySelector("[data-delete]").addEventListener("click", () => deleteEntry(entry.id));
      els.archiveList.appendChild(card);
    });
  }

  function openEntry(entry) {
    currentEntryId = entry.id;
    currentReflection = {
      state: entry.state,
      action: entry.action,
      quote: entry.quote,
      art: entry.art
    };
    els.thoughtInput.value = entry.input_text || "";
    clearChat();
    renderReflection(currentReflection);
  }

  function updateAuthUi() {
    if (session) {
      els.authToggle.textContent = "退出";
      els.authPanel.hidden = true;
      els.sessionState.textContent = "已登录。生成后会保存到你的私密档案。";
      return;
    }

    els.authToggle.textContent = "登录保存";
    els.sessionState.textContent = "未登录时仅生成当次回应。";
  }

  function setAuthMessage(message) {
    els.authStatus.textContent = message;
  }

  function setBusy(isBusy) {
    els.reflectBtn.disabled = isBusy;
    els.thinking.hidden = !isBusy;
  }

  function clearChat() {
    els.chatMessages.innerHTML = "";
  }

  function appendMessage(kind, text) {
    const node = document.createElement("div");
    node.className = kind === "user" ? "msg-user" : "msg-ai";
    node.textContent = text;
    els.chatMessages.appendChild(node);
  }

  function drawArt(art) {
    const word = art.word || "知";
    const colors = Array.isArray(art.colors) && art.colors.length >= 3 ? art.colors : fallbackArt().colors;
    const [c1, c2, c3] = colors;
    const W = 560;
    const H = 320;
    const cx = W / 2;
    const cy = H / 2;
    let html = '<rect width="560" height="320" fill="#faf7f2"/>';

    [30, 65, 100, 135, 168, 200].forEach((radius) => {
      html += `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${c3}" stroke-width="0.5" opacity="0.6"/>`;
    });

    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      const x2 = cx + Math.cos(angle) * 260;
      const y2 = cy + Math.sin(angle) * 260;
      html += `<line x1="${cx}" y1="${cy}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${c2}" stroke-width="0.4" opacity="0.18"/>`;
    }

    const safeWord = escapeHtml(String(word).slice(0, 2));
    const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
    html += `<text x="${cx}" y="${cy + 6}" text-anchor="middle" dominant-baseline="middle" font-size="120" fill="${c1}" opacity="0.07" font-family="STSong,SimSun,serif">${safeWord}</text>`;
    html += `<text x="${cx}" y="${cy + 6}" text-anchor="middle" dominant-baseline="middle" font-size="120" fill="${c1}" opacity="0.75" font-family="STSong,SimSun,serif">${safeWord}</text>`;
    html += `<text x="${cx}" y="${H - 28}" text-anchor="middle" font-size="13" fill="${c1}" opacity="0.32" font-family="STSong,SimSun,serif">${dateStr}</text>`;
    els.artSvg.innerHTML = html;
    els.artNote.textContent = `${safeWord} · ${new Date().toLocaleDateString("zh-CN")}`;
  }

  function saveArt() {
    const xml = new XMLSerializer().serializeToString(els.artSvg);
    const blob = new Blob([xml], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `今天_${new Date().toLocaleDateString("zh-CN")}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function localReflect(text) {
    const crisis = /自杀|轻生|不想活|结束生命|伤害自己|活不下去|suicide|kill myself/i.test(text);
    if (crisis) {
      return {
        state: "你写下这些，说明你正在承受很重的东西。此刻最重要的不是独自把它想清楚，而是先让自己不要一个人待在危险里。",
        action: "请现在联系一个可信任的人，或拨打当地紧急电话/危机干预热线。如果你已经有伤害自己的计划，请立刻离开危险物品并寻求现场帮助。",
        quote: "先活过这一刻。下一步，可以等有人陪你一起看。",
        safety: "crisis",
        art: { word: "援", colors: ["#7c5d64", "#b79298", "#ead8d8"] }
      };
    }

    return {
      state: "你愿意停下来写下这些，本身就是一种整理。很多答案不是想出来的，是在诚实看见以后慢慢露出来的。",
      action: "离开屏幕五分钟，喝一点水，然后只给今天留一个最小的完成标准。",
      quote: "认识自己，往往是从承认此刻开始。",
      safety: "normal",
      art: fallbackArt()
    };
  }

  function localChatReply(message) {
    if (/怎么办|怎么做|如何/.test(message)) {
      return "先不要急着把问题解决成一个宏大的答案。你可以从最小的下一步开始：今天什么事做完以后，会让你比现在轻一点？";
    }
    return "我听见你又往里走了一点。试着把这句话补完：真正让我在意的不是这件事本身，而是它让我感觉到……";
  }

  function fallbackArt() {
    return { word: "知", colors: ["#8b6f5e", "#c4a882", "#e8ddd0"] };
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
