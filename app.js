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

  window.zhaojianSupabase = client;

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
    runtimeStatus: document.getElementById("runtimeStatus"),
    thinking: document.getElementById("thinking"),
    result: document.getElementById("result"),
    entryText: document.getElementById("entryText"),
    followupBox: document.getElementById("followupBox"),
    followupText: document.getElementById("followupText"),
    artSvg: document.getElementById("artSvg"),
    artNote: document.getElementById("artNote"),
    saveArtBtn: document.getElementById("saveArtBtn"),
    chatForm: document.getElementById("chatForm"),
    chatInput: document.getElementById("chatInput"),
    chatMessages: document.getElementById("chatMessages"),
    archiveList: document.getElementById("archiveList"),
    clearDataBtn: document.getElementById("clearDataBtn")
  };

  // ==============================================
  // 翻页状态机
  // ==============================================
  const PAGE_STATE = {
    INPUT: 'input',
    REFLECTING: 'reflecting',
    RESULT: 'result',
  };

  let pageState = PAGE_STATE.INPUT;
  let touchStartX = 0;
  let touchStartY = 0;
  let isSwiping = false;

  const bookEl = document.querySelector('.book');

  function setPageState(newState) {
    pageState = newState;
    bookEl.className = 'book';

    switch (newState) {
      case PAGE_STATE.INPUT:
        bookEl.classList.add('showing-input');
        break;
      case PAGE_STATE.REFLECTING:
        bookEl.classList.add('curling');
        break;
      case PAGE_STATE.RESULT:
        bookEl.classList.add('flipping');
        break;
    }
  }

  function flipToResult() {
    setPageState(PAGE_STATE.REFLECTING);

    setTimeout(() => {
      setPageState(PAGE_STATE.RESULT);
      document.getElementById('pageRight').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 700);
  }

  function flipBackToInput() {
    setPageState(PAGE_STATE.INPUT);
  }

  const today = new Date();
  let session = null;
  let currentEntryId = null;
  let currentReflection = null;

  els.today.textContent = `${today.getFullYear()} · ${String(today.getMonth() + 1).padStart(2, "0")} · ${String(today.getDate()).padStart(2, "0")}`;
  bindEvents();
  setPageState(PAGE_STATE.INPUT);
  boot();

  function bindEvents() {
    els.authToggle.addEventListener("click", handleAuthToggle);
    els.authForm.addEventListener("submit", handleMagicLink);
    els.reflectBtn.addEventListener("click", handleReflect);
    els.chatForm.addEventListener("submit", handleChat);
    els.saveArtBtn.addEventListener("click", saveArt);
    els.clearDataBtn.addEventListener("click", clearAccountData);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && pageState === PAGE_STATE.RESULT) {
        flipBackToInput();
      }
    });
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
    exposeDebugState();
    recordTelemetry("page_view");
    await loadEntries();
  }

  async function consumeAuthCallbackIfNeeded() {
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const authError = params.get("error_description") || hashParams.get("error_description");
    if (authError) {
      setAuthMessage(`登录失败：${authError}`);
      return;
    }

    const code = params.get("code");
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");

    if (accessToken && refreshToken) {
      const { error } = await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });
      if (error) {
        setAuthMessage(`登录回调失败：${error.message}`);
        return;
      }

      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

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
    setRuntimeStatus("");
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
        setRuntimeStatus(`本次使用兜底回应：${reflection.errorCode}`);
      }
      await loadEntries();
      flipToResult();
    } catch (error) {
      const reflection = localReflect(text);
      currentEntryId = null;
      currentReflection = reflection;
      renderReflection(reflection);
      setRuntimeStatus(`动态服务暂时不可用，已使用本地兜底回应。`);

      flipToResult();
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
        setRuntimeStatus(`继续说使用了兜底回应：${result.errorCode}`);
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
    } catch (_error) { /* Analytics should never block */ }
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

  /** 渲染回信 */
  function renderReflection(data) {
    // 正文：书信体
    els.entryText.textContent = data.entry || "";

    // 追问（如果有）
    if (data.followup) {
      els.followupText.textContent = data.followup;
      els.followupBox.hidden = false;
    } else {
      els.followupBox.hidden = true;
    }

    drawArt(data.art || fallbackArt());
    els.result.hidden = false;
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
      const preview = (entry.entry || entry.input_text || "").slice(0, 80);
      card.innerHTML = `
        <p class="entry-date">${created}</p>
        <p class="entry-title">${escapeHtml(preview)}</p>
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
      entry: entry.entry,
      art: entry.art
    };
    els.thoughtInput.value = entry.input_text || "";
    clearChat();
    renderReflection(currentReflection);
    flipToResult();
  }

  function updateAuthUi() {
    if (session) {
      els.authToggle.textContent = "退出";
      els.authPanel.hidden = true;
      els.sessionState.textContent = "已登录。生成后会保存到你的私密档案。";
      exposeDebugState();
      return;
    }

    els.authToggle.textContent = "登录保存";
    els.sessionState.textContent = "未登录时仅生成当次回应。";
    exposeDebugState();
  }

  function exposeDebugState() {
    window.zhaojianSession = session;
    window.zhaojianDebug = async function () {
      const { data, error } = await client.auth.getSession();
      return {
        hasClient: Boolean(client),
        hasSession: Boolean(data?.session),
        userEmail: data?.session?.user?.email || null,
        error: error?.message || null,
        location: window.location.href
      };
    };
  }

  function setAuthMessage(message) {
    els.authStatus.textContent = message;
  }

  function setRuntimeStatus(message) {
    els.runtimeStatus.textContent = message;
    els.runtimeStatus.hidden = !message;
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
    let html = '<rect width="560" height="320" fill="#fdfaf6"/>';

    [30, 65, 100, 135, 168, 200].forEach((radius) => {
      html += `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${c3}" stroke-width="0.5" opacity="0.5"/>`;
    });

    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      const x2 = cx + Math.cos(angle) * 260;
      const y2 = cy + Math.sin(angle) * 260;
      html += `<line x1="${cx}" y1="${cy}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${c2}" stroke-width="0.4" opacity="0.15"/>`;
    }

    const safeWord = escapeHtml(String(word).slice(0, 2));
    const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
    html += `<text x="${cx}" y="${cy + 6}" text-anchor="middle" dominant-baseline="middle" font-size="120" fill="${c1}" opacity="0.06" font-family="STSong,SimSun,serif">${safeWord}</text>`;
    html += `<text x="${cx}" y="${cy + 6}" text-anchor="middle" dominant-baseline="middle" font-size="120" fill="${c1}" opacity="0.7" font-family="STSong,SimSun,serif">${safeWord}</text>`;
    html += `<text x="${cx}" y="${H - 28}" text-anchor="middle" font-size="13" fill="${c1}" opacity="0.3" font-family="Lora,serif">${dateStr}</text>`;
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
        entry: "你写下这些，说明你正在承受很重的东西。此刻最重要的不是独自把它想清楚，而是先让自己不要一个人待在危险里。\n\n请现在联系一个你信任的人，或者拨打当地的心理危机干预热线。如果你已经有伤害自己的计划，请立刻离开危险物品，寻求现场帮助。\n\n先活过这一刻。下一步，可以等有人陪你一起看。",
        safety: "crisis",
        art: { word: "援", colors: ["#7c5d64", "#b79298", "#ead8d8"] }
      };
    }

    return {
      entry: "你愿意停下来写下这些，本身就是一种整理。很多答案不是想出来的，是在诚实看见以后慢慢露出来的。\n\n离开屏幕五分钟，喝一点水，然后只给今天留一个最小的完成标准。",
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
