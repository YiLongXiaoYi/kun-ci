/* ===== 昆词 · 应用逻辑 ===== */
(function () {
  "use strict";

  const VOCAB = window.VOCAB;
  const WORDS = VOCAB.words;
  const CATS = VOCAB.categories;
  const byId = new Map(WORDS.map((w) => [w.id, w]));

  const KEY = "kunword.v1";
  const MASTER = 6; // 连对阶段达到 6 即视为掌握，移出错词本
  const INTERVALS = [0, 5 * 60e3, 30 * 60e3, 6 * 3600e3, 24 * 3600e3, 3 * 86400e3, 7 * 86400e3];
  const DAY = 86400e3;

  /* ---------------- 状态 ---------------- */
  const state = {
    progress: {},
    days: {},
    prefs: { size: 20, mode: "card", onlyNew: false, shuffle: true, scope: "all", mnemonic: true, theme: "auto", autoNext: true },
  };
  const ui = { scope: "all", view: "home" };
  let session = null;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d && typeof d === "object") {
        if (d.progress) state.progress = d.progress;
        if (d.days) state.days = d.days;
        if (d.prefs) Object.assign(state.prefs, d.prefs);
      }
    } catch (e) {
      console.warn("读取本地进度失败", e);
    }
    ui.scope = state.prefs.scope || "all";
  }
  function save() {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({ v: 1, progress: state.progress, days: state.days, prefs: { ...state.prefs, scope: ui.scope } })
      );
    } catch (e) {
      console.warn("保存失败", e);
    }
  }

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, txt) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  };

  /* ---------------- 主题 ---------------- */
  const THEME_COLOR = {
    dark: "#080c11",
    light: "#f2f5f4",
    blue: "#e8f1fb",
    pink: "#fdeff4",
    mint: "#e9f6ef",
    sand: "#f7f1e5",
  };
  const mqLight = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;

  function resolveTheme(pref) {
    if (pref && pref !== "auto") return pref;
    return mqLight && mqLight.matches ? "light" : "dark";
  }

  function applyTheme() {
    const pref = state.prefs.theme || "auto";
    const resolved = resolveTheme(pref);
    const root = document.documentElement;
    root.setAttribute("data-theme", resolved);
    root.setAttribute("data-theme-choice", pref);

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", THEME_COLOR[resolved] || "#080c11");

    const btn = $("#btnTheme");
    if (btn) {
      const dark = resolved === "dark";
      btn.textContent = dark ? "☀" : "🌙";
      btn.title = dark ? "切到亮色" : "切到暗色";
    }
    const anBox = $("#autoNext");
    if (anBox) {
      anBox.onchange = (e) => {
        state.prefs.autoNext = e.target.checked;
        save();
        if (e.target.checked) {
          if (session && !session.review && !$("#nextRow").hidden) startAutoNext();
        } else {
          stopAutoNext();
        }
      };
    }
    const mnArea = $("#cardMnemonic");
    if (mnArea) mnArea.addEventListener("pointerdown", () => stopAutoNext());

    document.querySelectorAll("#themeGrid button").forEach((b) => {
      b.classList.toggle("is-on", b.dataset.theme === pref);
    });
  }

  function setTheme(pref) {
    state.prefs.theme = pref;
    save();
    applyTheme();
  }

  function prog(id) {
    const p = state.progress[id];
    if (!p) return { stage: 0, right: 0, wrong: 0, due: 0, last: 0 };
    return {
      stage: p.stage | 0,
      right: p.right | 0,
      wrong: p.wrong | 0,
      due: p.due || 0,
      last: p.last || 0,
    };
  }
  function setProg(id, p) {
    state.progress[id] = p;
  }

  /* ---------------- 日期 / 统计 ---------------- */
  const dayKey = (d = new Date()) => {
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 10);
  };
  const todayCount = () => state.days[dayKey()] || 0;

  function streakDays() {
    let s = 0;
    const d = new Date();
    if (!state.days[dayKey(d)]) d.setDate(d.getDate() - 1); // 今天还没学，则从昨天开始算
    while (state.days[dayKey(d)]) {
      s++;
      d.setDate(d.getDate() - 1);
      if (s > 3650) break;
    }
    return s;
  }

  function counts() {
    let mastered = 0, learning = 0, fresh = 0, due = 0, book = 0;
    const now = Date.now();
    for (const w of WORDS) {
      const p = prog(w.id);
      if (p.stage >= MASTER) mastered++;
      else if (p.stage >= 1) {
        learning++;
        if (p.due <= now) due++;
        if (p.wrong > 0) book++;
      } else fresh++;
    }
    return { mastered, learning, fresh, due, book, total: WORDS.length };
  }

  /* ---------------- 视图切换 ---------------- */
  function show(view) {
    ui.view = view;
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("is-active"));
    const node = $("#view-" + view);
    if (node) node.classList.add("is-active");
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2100);
  }

  /* ---------------- 首页 ---------------- */
  function scopeWords(scope) {
    if (scope === "all") return WORDS;
    if (scope === "book")
      return WORDS.filter((w) => {
        const p = prog(w.id);
        return p.wrong > 0 && p.stage < MASTER && p.stage >= 1;
      });
    return WORDS.filter((w) => w.cat === scope);
  }

  function updatePills() {
    $("#pillToday").textContent = "今日 " + todayCount();
    $("#pillStreak").textContent = "🔥 " + streakDays() + " 天";
  }

  function renderHome() {
    const c = counts();
    updatePills();
    $("#totalWords").textContent = c.total;

    // 数据卡
    const cards = [
      { n: c.mastered, l: "已掌握 / " + c.total, cls: "is-mint" },
      { n: c.learning, l: "学习中", cls: "" },
      { n: c.book, l: "错词待考", cls: "is-rose" },
      { n: c.fresh, l: "没练过", cls: "" },
      { n: todayCount(), l: "今日练习", cls: "is-amber" },
    ];
    const grid = $("#statsGrid");
    grid.innerHTML = "";
    cards.forEach((k) => {
      const box = el("div", "stat " + k.cls);
      box.appendChild(el("b", null, String(k.n)));
      box.appendChild(el("span", null, k.l));
      grid.appendChild(box);
    });

    // 范围 chips
    const chips = $("#scopeChips");
    chips.innerHTML = "";
    const make = (id, label, count) => {
      const b = el("button", "chip" + (ui.scope === id ? " is-on" : ""), label);
      if (count != null) b.appendChild(el("em", null, String(count)));
      b.onclick = () => {
        ui.scope = id;
        state.prefs.scope = id;
        save();
        renderHome();
      };
      return b;
    };
    chips.appendChild(make("all", "全部", WORDS.length));
    CATS.forEach((cat) => chips.appendChild(make(cat, cat, WORDS.filter((w) => w.cat === cat).length)));
    chips.appendChild(make("book", "错词本", c.book));

    const pool = scopeWords(ui.scope);
    $("#scopeCount").textContent = pool.length + " 个词";

    // 开始 / 复习按钮
    const btn = $("#btnStart");
    btn.disabled = pool.length === 0;
    btn.querySelector("span").textContent = ui.scope === "book" ? "开始考核错词" : "开始学习";

    const rev = $("#btnReview");
    rev.hidden = c.book === 0;
    $("#reviewBadge").textContent = String(c.book);

    // 分类进度
    const bars = $("#masteryBars");
    bars.innerHTML = "";
    CATS.forEach((cat) => {
      const list = WORDS.filter((w) => w.cat === cat);
      const ok = list.filter((w) => prog(w.id).stage >= MASTER).length;
      const row = el("div", "bar-row");
      row.appendChild(el("div", "bar-name", cat));
      const track = el("div", "bar-track");
      const fill = el("i");
      fill.style.width = list.length ? (ok / list.length) * 100 + "%" : "0%";
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el("div", "bar-num", ok + "/" + list.length));
      bars.appendChild(row);
    });
    const pct = c.total ? Math.round((c.mastered / c.total) * 100) : 0;
    $("#masterySummary").textContent = "总掌握 " + pct + "%";
  }

  /* ---------------- 出题 ---------------- */
  function shuffle(a) {
    const r = a.slice();
    for (let i = r.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [r[i], r[j]] = [r[j], r[i]];
    }
    return r;
  }

  function buildQueue(scope) {
    const now = Date.now();
    const pool = scopeWords(scope);
    const bucket = { due: [], learning: [], fresh: [], mastered: [] };
    for (const w of pool) {
      const p = prog(w.id);
      if (p.stage >= MASTER) bucket.mastered.push({ w, p });
      else if (p.stage >= 1) (p.due <= now ? bucket.due : bucket.learning).push({ w, p });
      else bucket.fresh.push({ w, p });
    }
    // 待考 > 学习中 > 没练过 > 已掌握（只做保持）
    let ordered = [...bucket.due, ...bucket.learning, ...bucket.fresh, ...bucket.mastered];
    if (scope === "book") ordered = ordered.filter((x) => x.p.stage >= 1 && x.p.stage < MASTER);
    if (state.prefs.onlyNew) ordered = ordered.filter((x) => x.p.stage === 0);

    const size = state.prefs.size > 0 ? state.prefs.size : ordered.length;
    let picked = ordered.slice(0, size);
    if (state.prefs.shuffle) picked = shuffle(picked);
    return picked.map((x) => x.w.id);
  }

  /* ---------------- 答完自动下一张 ---------------- */
  const AUTO_NEXT_MS = 2500;
  let autoTimer = null;

  function stopAutoNext() {
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
    const n = $("#autoCount");
    if (n) n.hidden = true;
  }

  function startAutoNext() {
    stopAutoNext();
    if (!session || session.review) return;
    if (state.prefs.autoNext === false) return;
    if ($("#nextRow").hidden) return;

    session.autoDeadline = Date.now() + AUTO_NEXT_MS;
    const n = $("#autoCount");
    const tick = () => {
      const left = session.autoDeadline - Date.now();
      if (!session || session.review) return stopAutoNext();
      if (left <= 0) {
        stopAutoNext();
        nextCard();
        return;
      }
      if (n) {
        n.hidden = false;
        n.textContent = (left / 1000).toFixed(1) + "s";
      }
    };
    tick();
    autoTimer = setInterval(tick, 100);
  }

  function startSession(scope) {
    stopAutoNext();
    const queue = buildQueue(scope);
    if (!queue.length) {
      toast("这个范围暂时没有可练的词");
      return;
    }
    session = {
      queue,
      p: 0,
      right: 0,
      wrong: 0,
      missed: [],
      reinsert: {},
      mode: state.prefs.mode,
      scope,
      t0: Date.now(),
      answered: 0,
      history: [],
      cur: null,
      review: null,
    };
    $("#modeTag").textContent =
      session.mode === "quiz" ? "四选一" : session.mode === "spell" ? "中译英" : "卡片";
    show("study");
    renderCard();
  }

  function stageDots(stage) {
    const box = $("#cardStage");
    box.innerHTML = "";
    for (let i = 0; i < MASTER; i++) box.appendChild(el("i", stage > i ? "on" : ""));
  }

  function syncPrevBtn() {
    const btn = $("#btnPrev");
    if (!btn) return;
    const can = !!(session && session.history && session.history.length);
    btn.disabled = !can;
    btn.title = can ? "回看上一题（Backspace）" : "还没有上一题";
  }

  function renderCard() {
    stopAutoNext();
    session.review = null;
    const id = session.queue[session.p];
    const w = byId.get(id);
    const p = prog(id);
    session.cur = { id, answered: false, verdict: null, chosenZh: null, active: false, options: [] };
    session.active = false;

    const card = $("#card");
    card.classList.remove("is-known", "is-miss");

    // 拼写模式考的是「中 → 英」，卡面显示中文
    const spell = session.mode === "spell";
    $("#cardWord").textContent = spell ? w.zh : w.en;
    $("#cardWord").classList.remove("is-small");
    $("#cardWord").classList.toggle("is-cn", spell);
    $("#cardCat").textContent = w.cat;
    stageDots(p.stage);

    $("#cardReveal").hidden = true;
    $("#nextRow").hidden = true;
    $("#reviewRow").hidden = true;
    $("#cardOptions").hidden = true;
    $("#cardOptions").innerHTML = "";
    $("#spellFeedback").hidden = true;
    $("#spellFeedback").textContent = "";
    $("#cardHint").hidden = false;
    syncPrevBtn();

    $("#studyCounter").textContent = session.answered + " / " + session.queue.length;
    const pct = (session.p / Math.max(session.queue.length, 1)) * 100;
    $("#studyBarFill").style.width = Math.min(100, pct) + "%";

    if (session.mode === "quiz") {
      $("#spellBox").hidden = true;
      $("#answerRow").hidden = true;
      renderOptions(w);
      return;
    }

    if (spell) {
      $("#spellBox").hidden = false;
      $("#answerRow").hidden = true;
      const input = $("#spellInput");
      input.value = "";
      input.disabled = false;
      $("#btnSpellSubmit").disabled = false;
      $("#cardHint").textContent = "看中文，写出英文 · 只写主词也算对 · Enter 提交";
      session.active = true;
      setTimeout(() => input.focus(), 30);
      return;
    }

    $("#spellBox").hidden = true;
    $("#answerRow").hidden = false;
    $("#btnKnown").disabled = false;
    $("#btnUnknown").disabled = false;
    $("#cardHint").textContent = "空格 认识 · 1 不认识 · Q 认识 · E 不认识";
    session.active = true;
  }

  /** 造一个选项按钮；Q/E 是自评键，WASD 是四个选项 */
  function makeBtn(cls, key, label, kind) {
    const b = el("button", "option " + cls + (kind ? " is-act" : ""), label);
    b.dataset.key = key;
    b.appendChild(el("span", "opt-key", key.toUpperCase()));
    return b;
  }

  function renderOptions(w) {
    const pool = shuffle(WORDS.filter((x) => x.id !== w.id && x.zh !== w.zh));
    const sameCat = pool.filter((x) => x.cat === w.cat);
    const picks = [];
    const used = new Set([w.zh]);
    for (const src of [sameCat, pool]) {
      for (const x of src) {
        if (picks.length >= 3) break;
        if (used.has(x.zh)) continue;
        used.add(x.zh);
        picks.push(x);
      }
    }
    const opts = shuffle([w, ...picks]);
    session.cur.options = opts.map((o) => o.id);

    const box = $("#cardOptions");
    box.innerHTML = "";
    box.hidden = false;
    box.classList.add("wasd");
    $("#cardHint").hidden = false;
    $("#cardHint").textContent = "W A S D 选答案 · Q 直接算认识 · E 直接算不认识";

    // Q 在 W 左边，E 在 W 右边，和键盘位置一致
    const q = makeBtn("opt-q", "q", "认识", true);
    q.dataset.action = "known";
    q.onclick = () => assess("known");
    box.appendChild(q);

    const keys = WASD;
    opts.forEach((o, i) => {
      const key = keys[i];
      const b = makeBtn("opt-" + key, key, o.zh, false);
      b.dataset.zh = o.zh;
      b.dataset.id = String(o.id);
      b.onclick = () => answerQuiz(o.id === w.id, b, w, box);
      box.appendChild(b);
    });

    const e = makeBtn("opt-e", "e", "不认识", true);
    e.dataset.action = "unknown";
    e.onclick = () => assess("unknown");
    box.appendChild(e);

    session.active = true;
  }

  /** 键盘 WASD 键位：与页面上的物理排布一一对应 */
  const WASD = ["w", "a", "s", "d"];
  const box_visible = () => {
    const b = $("#cardOptions");
    return !!(b && !b.hidden);
  };

  /** 四个选项与正确答案：标色 + 补上每个中文对应的英文 */
  function decorateOptions(w, chosenZh, withEn) {
    const box = $("#cardOptions");
    Array.from(box.children).forEach((b) => {
      if (b.dataset.action) return; // Q / E
      b.disabled = true;
      const optId = Number(b.dataset.id);
      const word = byId.get(optId);
      if (b.dataset.zh === w.zh) b.classList.add("is-right");
      if (chosenZh && b.dataset.zh === chosenZh) b.classList.add("is-chosen");
      if (withEn && word && !b.querySelector(".opt-en")) {
        b.appendChild(el("span", "opt-en", word.en));
      }
    });
  }

  function answerQuiz(correct, btn, w, box) {
    if (!session.active || session.review) return;
    const cur = session.cur;
    if (!cur || cur.answered) return;

    cur.answered = true;
    cur.verdict = correct ? "known" : "unknown";
    cur.chosenZh = btn.dataset.zh;

    decorateOptions(w, cur.chosenZh, true);
    if (!correct) btn.classList.add("is-wrong");
    $("#cardWord").classList.add("is-small");
    record(w.id, correct, true);
    pushHistory(cur);
    revealAnswer(w, correct, true);
  }

  /** Q / E：作答前直接定性，作答后还能改判 */
  function assess(kind) {
    if (!session || session.review) return;
    const cur = session.cur;
    if (!cur) return;
    const w = byId.get(cur.id);
    const want = kind === "known";

    if (!cur.answered) {
      cur.answered = true;
      cur.verdict = want ? "known" : "unknown";
      cur.chosenZh = null;
      cur.viaAssess = true;
      if (session.mode === "quiz") decorateOptions(w, null, true);
      record(w.id, want, false);
      pushHistory(cur);
      if (session.mode === "spell") {
        $("#spellInput").disabled = true;
        $("#btnSpellSubmit").disabled = true;
        revealSpell(w, { ok: want, close: false }, cur.typed || "", true);
        return;
      }
      revealAnswer(w, want, session.mode === "quiz", true);
      return;
    }

    if (cur.verdict === (want ? "known" : "unknown")) {
      toast(want ? "这一题已经算「认识」了" : "这一题已经算「不认识」了");
      return;
    }
    revise(cur, want);
  }

  /** 改正已判定的结果（主要是「刚才是蒙对的」） */
  function revise(cur, toKnown) {
    const id = cur.id;
    const p = prog(id);
    if (toKnown) {
      p.wrong = Math.max(0, p.wrong - 1);
      p.right++;
      p.stage = Math.min(MASTER + 1, p.stage + 2);
      session.wrong = Math.max(0, session.wrong - 1);
      session.right++;
      const i = session.missed.indexOf(id);
      if (i >= 0) session.missed.splice(i, 1);
    } else {
      p.right = Math.max(0, p.right - 1);
      p.wrong++;
      p.stage = Math.max(1, p.stage - 2);
      session.right = Math.max(0, session.right - 1);
      session.wrong++;
      if (!session.missed.includes(id)) session.missed.push(id);
    }
    p.stage = Math.max(1, Math.min(MASTER + 1, p.stage));
    p.last = Date.now();
    p.due = Date.now() + INTERVALS[Math.min(p.stage, INTERVALS.length - 1)];
    setProg(id, p);

    cur.verdict = toKnown ? "known" : "unknown";
    const h = session.history[session.history.length - 1];
    if (h && h.id === id) h.known = toKnown;

    save();
    updatePills();
    const w = byId.get(id);
    if (session.mode === "spell") {
      revealSpell(w, { ok: toKnown, close: false }, cur.typed || "", true);
    } else {
      revealAnswer(w, toKnown, session.mode === "quiz", true);
      if (!toKnown) {
        const right = $("#cardOptions .option.is-right");
        if (right) right.classList.add("is-guessed");
      }
    }
    toast(toKnown ? "已改记「认识」" : "已改记「不认识」，本词会重点复习");
  }

  function pushHistory(cur) {
    const h = {
      id: cur.id,
      known: cur.verdict === "known",
      chosenZh: cur.chosenZh || null,
      viaAssess: !!cur.viaAssess,
      options: cur.options.slice(),
      typed: cur.typed || null,
      mode: session.mode,
      at: Date.now(),
    };
    session.history.push(h);
    syncPrevBtn();
    return h;
  }

  function revealAnswer(w, known, quiz, assessed) {
    const id = w.id;
    const p = prog(id);
    const rev = $("#cardReveal");
    rev.hidden = false;
    $("#cardAnswer").hidden = !!quiz;
    $("#cardAnswer").textContent = w.zh;
    const bits = [];
    if (quiz && !assessed) bits.push(known ? "✓ 答对了" : "✗ 答错了");
    else if (known) bits.push("✓ 认识");
    else bits.push("✗ 不认识");
    bits.push("练过 " + (p.right + p.wrong) + " 次");
    if (p.wrong > 0) bits.push("错 " + p.wrong + " 次");
    bits.push(p.stage >= MASTER ? "已掌握" : "连对阶段 " + p.stage + "/" + MASTER);
    if (known && p.stage > 1) bits.push("下次 " + dueLabel(p.due));
    $("#cardNote").textContent = bits.join(" · ");
    stageDots(Math.min(p.stage, MASTER));
    renderMnemonic(w);

    $("#answerRow").hidden = true;
    $("#nextRow").hidden = false;
    $("#reviewRow").hidden = true;
    $("#cardHint").hidden = true;
    $("#card").classList.add(known ? "is-known" : "is-miss");
    session.active = false;
    syncPrevBtn();
    startAutoNext();
  }

  function dueLabel(ts) {
    const diff = ts - Date.now();
    if (diff <= 0) return "随时复习";
    if (diff < 3600e3) return Math.max(1, Math.round(diff / 60e3)) + " 分钟后";
    if (diff < DAY) return Math.round(diff / 3600e3) + " 小时后";
    return Math.round(diff / DAY) + " 天后";
  }

  function record(id, known, fromQuiz) {
    const p = prog(id);
    const before = p.stage;
    if (known) {
      p.right++;
      p.stage = Math.min(MASTER + 1, p.stage + 1);
    } else {
      p.wrong++;
      p.stage = Math.max(1, p.stage - 1);
      if (!session.missed.includes(id)) session.missed.push(id);
      // 本轮稍后再考一次（最多补考 2 次）
      const n = session.reinsert[id] || 0;
      if (n < 2) {
        session.reinsert[id] = n + 1;
        const at = Math.min(
          session.queue.length,
          session.p + 1 + Math.min(5, Math.max(2, Math.floor(session.queue.length / 4)))
        );
        session.queue.splice(at, 0, id);
      }
    }
    p.last = Date.now();
    p.due = Date.now() + INTERVALS[Math.min(p.stage, INTERVALS.length - 1)];
    setProg(id, p);

    session.answered++;
    if (known) session.right++;
    else session.wrong++;

    const k = dayKey();
    state.days[k] = (state.days[k] || 0) + 1;
    save();
    updatePills();

    if (known && before < MASTER && p.stage >= MASTER) toast("🎉 已掌握：" + byId.get(id).en);
    $("#studyCounter").textContent = session.answered + " / " + session.queue.length;
  }

  /* ---------------- 回看上一题 ---------------- */
  function showPrev() {
    if (!session || !session.history.length) return toast("还没有可以回看的题");
    stopAutoNext();
    const entry = session.history[session.history.length - 1];
    const w = byId.get(entry.id);
    session.review = entry;
    session.active = false;

    const card = $("#card");
    card.classList.remove("is-known", "is-miss");
    card.classList.add(entry.known ? "is-known" : "is-miss");

    const spellEntry = entry.mode === "spell";
    $("#cardWord").textContent = spellEntry ? w.zh : w.en;
    $("#cardWord").classList.toggle("is-small", entry.mode === "quiz");
    $("#cardWord").classList.toggle("is-cn", spellEntry);
    $("#cardCat").textContent = w.cat;
    stageDots(Math.min(prog(w.id).stage, MASTER));
    $("#spellBox").hidden = !spellEntry;
    if (spellEntry) {
      $("#spellInput").disabled = true;
      $("#spellInput").value = entry.typed || "";
      $("#btnSpellSubmit").disabled = true;
    }

    const box = $("#cardOptions");
    box.innerHTML = "";
    box.hidden = true;

    if (entry.options && entry.options.length) {
      box.hidden = false;
      box.classList.add("wasd");
      const q = makeBtn("opt-q", "q", "认识", true);
      q.disabled = true;
      box.appendChild(q);
      entry.options.forEach((oid, i) => {
        const ow = byId.get(oid);
        if (!ow) return;
        const key = WASD[i] || "d";
        const b = makeBtn("opt-" + key, key, ow.zh, false);
        b.disabled = true;
        if (ow.id === w.id) b.classList.add("is-right");
        if (entry.chosenZh && ow.zh === entry.chosenZh) b.classList.add("is-chosen");
        b.appendChild(el("span", "opt-en", ow.en));
        box.appendChild(b);
      });
      const e = makeBtn("opt-e", "e", "不认识", true);
      e.disabled = true;
      box.appendChild(e);
    }

    $("#cardReveal").hidden = false;
    $("#cardAnswer").hidden = false;
    $("#cardAnswer").textContent = spellEntry ? w.en : w.zh;
    const bits = ["回看上一题"];
    bits.push(entry.known ? "当时记作「认识」" : "当时记作「不认识」");
    if (spellEntry) bits.push(entry.typed ? "你写的是「" + entry.typed + "」" : "没写");
    else if (entry.viaAssess) bits.push("用 Q/E 直接自评");
    else if (entry.chosenZh && entry.chosenZh !== w.zh) bits.push("点的是「" + entry.chosenZh + "」");
    $("#cardNote").textContent = bits.join(" · ");
    renderMnemonic(w);

    $("#spellFeedback").hidden = true;
    $("#answerRow").hidden = true;
    $("#nextRow").hidden = true;
    $("#reviewRow").hidden = false;
    $("#cardHint").hidden = true;
  }

  function exitReview() {
    if (!session || !session.review) return;
    session.review = null;
    $("#reviewRow").hidden = true;
    const cur = session.cur;
    if (!cur || !cur.answered) {
      renderCard();
      return;
    }
    // 当前题已经答过：把已答状态还原
    const w = byId.get(cur.id);
    const spell = session.mode === "spell";
    $("#cardWord").textContent = spell ? w.zh : w.en;
    $("#cardWord").classList.toggle("is-small", session.mode === "quiz");
    $("#cardWord").classList.toggle("is-cn", spell);
    $("#cardCat").textContent = w.cat;
    if (spell) {
      $("#spellBox").hidden = false;
      $("#spellInput").disabled = true;
      $("#spellInput").value = cur.typed || "";
      $("#btnSpellSubmit").disabled = true;
    }
    const box = $("#cardOptions");
    box.innerHTML = "";
    box.hidden = true;
    if (session.mode === "quiz") {
      box.hidden = false;
      box.classList.add("wasd");
      const q = makeBtn("opt-q", "q", "认识", true);
      q.dataset.action = "known";
      q.onclick = () => assess("known");
      box.appendChild(q);
      cur.options.forEach((oid, i) => {
        const ow = byId.get(oid);
        if (!ow) return;
        const key = WASD[i] || "d";
        const b = makeBtn("opt-" + key, key, ow.zh, false);
        b.dataset.zh = ow.zh;
        b.dataset.id = String(ow.id);
        b.disabled = true;
        if (ow.id === w.id) b.classList.add("is-right");
        if (cur.chosenZh && ow.zh === cur.chosenZh) b.classList.add("is-chosen");
        b.appendChild(el("span", "opt-en", ow.en));
        box.appendChild(b);
      });
      const e = makeBtn("opt-e", "e", "不认识", true);
      e.dataset.action = "unknown";
      e.onclick = () => assess("unknown");
      box.appendChild(e);
    }
    if (spell) {
      revealSpell(w, { ok: cur.verdict === "known", close: false }, cur.typed || "", !!cur.viaAssess);
      stopAutoNext();
      return;
    }
    revealAnswer(w, cur.verdict === "known", session.mode === "quiz", !cur.chosenZh);
    stopAutoNext();
  }

  /* ---------------- 中译英拼写 ---------------- */
  function normalizeSpell(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/\([^)]*\)/g, " ")
      .replace(/[^a-z\s]/g, " ") // 连字符也当空格，ecdysial-line == ecdysial line
      .replace(/\s+/g, " ")
      .trim();
  }

  /** 一个词条可能接受的多种写法：去掉括号说明，逗号/or 分隔的别名都算对 */
  function spellCandidates(w) {
    const raw = String(w.en || "");
    const set = new Set();
    const push = (x) => {
      const n = normalizeSpell(x);
      if (n) set.add(n);
    };
    push(raw.replace(/\([^)]*\)/g, " "));
    raw
      .replace(/\([^)]*\)/g, " ")
      .split(/,|\bor\b/)
      .forEach(push);
    // 括号里的别名也算对：genus (pl. genera) → genera
    (raw.match(/\(([^)]*)\)/g) || []).forEach((g) => {
      g.slice(1, -1)
        .replace(/\bpl\.?\b/gi, " ")
        .split(/,|\bor\b/)
        .forEach(push);
    });
    return Array.from(set);
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  function gradeSpell(w, input) {
    const ans = normalizeSpell(input);
    if (!ans) return { ok: false, close: false };
    const cands = spellCandidates(w);
    for (const c of cands) if (c === ans) return { ok: true, close: false };
    // 长词允许差一两个字母（entomologie 这种常见拼错）
    for (const c of cands) {
      const d = levenshtein(c, ans);
      if (Math.abs(c.length - ans.length) > 3) continue;
      if (c.length >= 10 && d <= 2) return { ok: true, close: true };
      if (c.length >= 6 && d <= 1) return { ok: true, close: true };
    }
    // 多词术语只写第一个词也算对（genus (pl. genera) → genus）
    for (const c of cands) {
      if (c.includes(" ") && ans === c.split(" ")[0]) return { ok: true, close: false };
    }
    // 单复数容错：eye / eyes、sensillum / sensilla 这种
    for (const c of cands) {
      if (ans === c + "s" || ans === c + "es") return { ok: true, close: true };
      if (c === ans + "s" || c === ans + "es") return { ok: true, close: true };
    }
    return { ok: false, close: false };
  }

  function answerSpell() {
    if (!session || session.review || session.mode !== "spell") return;
    const cur = session.cur;
    if (!cur || cur.answered) return;
    const w = byId.get(cur.id);
    const input = $("#spellInput");
    const typed = input.value;
    const g = gradeSpell(w, typed);

    cur.answered = true;
    cur.verdict = g.ok ? "known" : "unknown";
    cur.typed = typed.trim();
    cur.viaAssess = false;
    input.disabled = true;
    input.blur();
    $("#btnSpellSubmit").disabled = true;

    record(w.id, g.ok, true);
    pushHistory(cur);
    revealSpell(w, g, typed);
  }

  function revealSpell(w, g, typed, viaKey) {
    const p = prog(w.id);
    $("#cardReveal").hidden = false;
    $("#cardAnswer").hidden = false;
    $("#cardAnswer").textContent = w.en;

    const bits = [];
    if (viaKey) bits.push(g.ok ? "✓ 认识" : "✗ 不认识");
    else bits.push(g.ok ? (g.close ? "✓ 写对了（差一个字母）" : "✓ 写对了") : "✗ 写错了");
    bits.push("练过 " + (p.right + p.wrong) + " 次");
    if (p.wrong > 0) bits.push("错 " + p.wrong + " 次");
    bits.push(p.stage >= MASTER ? "已掌握" : "连对阶段 " + p.stage + "/" + MASTER);
    $("#cardNote").textContent = bits.join(" · ");
    stageDots(Math.min(p.stage, MASTER));
    renderMnemonic(w);

    const fb = $("#spellFeedback");
    fb.hidden = false;
    fb.className = "spell-feedback " + (g.ok ? "ok" : "bad");
    if (viaKey) fb.textContent = "用 Q / E 直接判定，没写拼写";
    else if (typed && typed.trim()) fb.textContent = "你写的是：" + typed.trim();
    else fb.textContent = "没写就提交了";

    $("#answerRow").hidden = true;
    $("#nextRow").hidden = false;
    $("#reviewRow").hidden = true;
    $("#cardHint").hidden = true;
    $("#card").classList.add(g.ok ? "is-known" : "is-miss");
    session.active = false;
    syncPrevBtn();
    startAutoNext();
  }

  /** 卡片模式的「认识 / 不认识」（Q、E、空格、1、2 都走这里） */
  function answerCard(known) {
    if (!session || session.review) return;
    const cur = session.cur;
    if (!cur) return;
    const w = byId.get(cur.id);
    if (!cur.answered) {
      cur.answered = true;
      cur.verdict = known ? "known" : "unknown";
      cur.viaAssess = true;
      record(cur.id, known, false);
      pushHistory(cur);
      revealAnswer(w, known, false);
      return;
    }
    if (cur.verdict === (known ? "known" : "unknown")) return;
    revise(cur, known);
  }

  function nextCard() {
    stopAutoNext();
    if (session.review) return exitReview();
    session.p++;
    const pct = (session.p / Math.max(session.queue.length, 1)) * 100;
    $("#studyBarFill").style.width = Math.min(100, pct) + "%";
    if (session.p >= session.queue.length) finish();
    else renderCard();
  }

  /* ---------------- 联想记忆 ---------------- */
  const MNEMO = window.MNEMO || null;
  let mnIndex = null;
  const zhOf = new Map(WORDS.map((w) => [w.en, w.zh]));

  function mnemIndex() {
    if (mnIndex || !MNEMO) return mnIndex;
    mnIndex = { fam: new Map() };
    for (const f of MNEMO.families) {
      for (const en of f.words) if (!mnIndex.fam.has(en)) mnIndex.fam.set(en, f);
    }
    return mnIndex;
  }

  /** 造一个「词根钩子 + 同族词」节点；没有数据时返回 null */
  function buildMnemonic(w) {
    if (!MNEMO || state.prefs.mnemonic === false) return null;
    const idx = mnemIndex();
    const fam = idx && idx.fam.get(w.en);
    const hook = MNEMO.hooks[w.en];
    if (!fam && !hook) return null;
    const box = el("div", "mnemonic");

    if (hook) {
      const h = el("p", "mn-hook");
      h.appendChild(el("span", "mn-key", "词根"));
      h.appendChild(document.createTextNode(hook));
      box.appendChild(h);
    }

    if (fam) {
      const head = el("div", "mn-head");
      head.appendChild(el("span", "mn-badge", "同族"));
      head.appendChild(el("b", null, fam.title));
      box.appendChild(head);

      if (fam.tip) box.appendChild(el("p", "mn-tip", fam.tip));

      const chips = el("div", "mn-chips");
      const MAXCHIP = 9;
      let list = fam.words;
      if (list.length > MAXCHIP) {
        const i = list.indexOf(w.en);
        list = [w.en].concat(list.filter((x) => x !== w.en)).slice(0, MAXCHIP);
        if (i < 0) list = fam.words.slice(0, MAXCHIP);
      }
      list.forEach((en) => {
        const chip = el("span", "mn-chip" + (en === w.en ? " is-me" : ""));
        chip.appendChild(el("b", null, en));
        chip.appendChild(el("i", null, zhOf.get(en) || ""));
        chips.appendChild(chip);
      });
      box.appendChild(chips);

      if (fam.words.length > MAXCHIP) {
        const extra =
          fam.id === "ptera"
            ? `这一族共 ${fam.words.length} 个：-ptera = 翅，看前缀推中文`
            : `这一族共 ${fam.words.length} 个，这里先列最常混的 ${MAXCHIP} 个`;
        box.appendChild(el("p", "mn-more", extra));
      }
    }
    return box;
  }

  /** 在答案下面渲染联想记忆 */
  function renderMnemonic(w) {
    const box = $("#cardMnemonic");
    box.innerHTML = "";
    const node = buildMnemonic(w);
    if (!node) {
      box.hidden = true;
      return;
    }
    node.className = "mnemonic plain";
    box.hidden = false;
    box.appendChild(node);
  }

  /* ---------------- 结果页 ---------------- */
  function finish() {
    const answered = session.right + session.wrong;
    const acc = answered ? Math.round((session.right / answered) * 100) : 0;
    const mins = Math.max(1, Math.round((Date.now() - session.t0) / 60000));

    $("#resultPct").textContent = acc + "%";
    $("#resultRing").style.setProperty("--pct", acc + "%");
    $("#resultTitle").textContent = acc >= 90 ? "这轮很稳" : acc >= 60 ? "继续巩固" : "错得有点多，再来一轮";
    $("#resultSub").textContent =
      "共 " + answered + " 张 · 用时约 " + mins + " 分钟 · 错词已自动进入下一轮优先队列";

    const g = $("#resultStats");
    g.innerHTML = "";
    [
      { n: session.right, l: "认识", cls: "is-mint" },
      { n: session.wrong, l: "不认识", cls: "is-rose" },
      { n: session.missed.length, l: "涉及错词", cls: "" },
      { n: counts().mastered, l: "累计掌握", cls: "is-amber" },
    ].forEach((k) => {
      const box = el("div", "stat " + k.cls);
      box.appendChild(el("b", null, String(k.n)));
      box.appendChild(el("span", null, k.l));
      g.appendChild(box);
    });

    const list = $("#missList");
    list.innerHTML = "";
    $("#missPanel").hidden = session.missed.length === 0;
    session.missed.forEach((id) => {
      const w = byId.get(id);
      const row = el("div", "miss-item");
      row.appendChild(el("b", null, w.en));
      row.appendChild(el("span", null, w.zh));
      list.appendChild(row);
    });

    renderHome();
    show("result");
  }

  /* ---------------- 词库 / 查词 ---------------- */
  let wordCat = "all";

  function statusOf(w) {
    const p = prog(w.id);
    if (p.stage >= MASTER) return "mastered";
    if (p.stage >= 1) return "learning";
    return "new";
  }

  function renderWordCats() {
    const box = $("#wordCats");
    box.innerHTML = "";
    const mk = (id, label, n) => {
      const b = el("button", "chip" + (wordCat === id ? " is-on" : ""), label);
      b.appendChild(el("em", null, String(n)));
      b.onclick = () => {
        wordCat = id;
        renderWords();
      };
      return b;
    };
    box.appendChild(mk("all", "全部", WORDS.length));
    CATS.forEach((c) => box.appendChild(mk(c, c, WORDS.filter((w) => w.cat === c).length)));
  }

  function wordsFiltered() {
    const q = ($("#wordSearch").value || "").trim().toLowerCase();
    const st = $("#wordStatus").value;
    return WORDS.filter((w) => {
      if (wordCat !== "all" && w.cat !== wordCat) return false;
      if (st === "wrong") {
        if (!(prog(w.id).wrong > 0)) return false;
      } else if (st !== "all" && statusOf(w) !== st) {
        return false;
      }
      if (q) {
        const hay = (w.en + " " + w.zh).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function renderWords() {
    renderWordCats();
    const list = wordsFiltered();
    $("#wordsSub").textContent = list.length + " / " + WORDS.length + " 个词";
    const box = $("#wordList");
    box.innerHTML = "";
    if (!list.length) {
      box.appendChild(el("div", "book-empty", "没找到匹配的词，换个关键词试试"));
      return;
    }
    list.slice(0, 300).forEach((w) => box.appendChild(wordRow(w)));
    if (list.length > 300) {
      box.appendChild(el("p", "mn-more", `还有 ${list.length - 300} 个，缩小范围或加关键词`));
    }
  }

  function wordRow(w) {
    const p = prog(w.id);
    const row = el("div", "word-item");
    const head = el("button", "wi-head");
    head.onclick = () => {
      const open = row.classList.toggle("is-open");
      const detail = row.querySelector(".wi-detail");
      if (!detail) return;
      detail.hidden = !open;
      if (open && !detail.dataset.built) {
        detail.dataset.built = "1";
        buildWordDetail(w, detail);
      }
    };

    const left = el("div", "wi-left");
    left.appendChild(el("b", "wi-en", w.en));
    left.appendChild(el("span", "wi-zh", w.zh));
    head.appendChild(left);

    const right = el("div", "wi-right");
    const dots = el("span", "dotline");
    for (let i = 0; i < MASTER; i++) dots.appendChild(el("i", p.stage > i ? "on" : ""));
    right.appendChild(dots);
    right.appendChild(el("span", "wi-state", p.stage >= MASTER ? "已掌握" : p.stage > 0 ? "学习中" : "没练过"));
    right.appendChild(el("span", "wi-cat", w.cat));
    head.appendChild(right);

    row.appendChild(head);
    const detail = el("div", "wi-detail");
    detail.hidden = true;
    row.appendChild(detail);
    return row;
  }

  function buildWordDetail(w, box) {
    const p = prog(w.id);
    const mn = buildMnemonic(w);
    if (mn) box.appendChild(mn);
    else box.appendChild(el("p", "mn-more", "这个词暂时没有词根/同族数据"));

    const meta = el("div", "wi-stats");
    const bits = ["练过 " + (p.right + p.wrong) + " 次"];
    if (p.wrong) bits.push("错 " + p.wrong + " 次");
    bits.push(p.stage >= MASTER ? "已掌握" : "连对阶段 " + p.stage + "/" + MASTER);
    if (p.last) bits.push("上次 " + dueLabel(p.last));
    if (p.last) bits.push("下次 " + dueLabel(p.due));
    meta.textContent = bits.join(" · ");
    box.appendChild(meta);

    const acts = el("div", "wi-acts");
    const bSpeak = el("button", "mini-btn", "🔊 朗读");
    bSpeak.onclick = () => speak(w.en);
    const bMaster = el("button", "mini-btn", "标记掌握");
    bMaster.onclick = () => {
      const q = prog(w.id);
      q.stage = MASTER;
      q.due = Date.now() + INTERVALS[6];
      q.last = Date.now();
      setProg(w.id, q);
      save();
      renderWords();
      renderHome();
      toast("已标记掌握：" + w.en);
    };
    const bReset = el("button", "mini-btn", "重置这个词");
    bReset.onclick = () => {
      setProg(w.id, { stage: 0, right: 0, wrong: 0, due: 0, last: 0 });
      save();
      renderWords();
      renderHome();
      toast("已重置：" + w.en);
    };
    acts.appendChild(bSpeak);
    acts.appendChild(bMaster);
    acts.appendChild(bReset);
    box.appendChild(acts);
  }

  /* ---------------- 错词本 ---------------- */
  function renderBook() {
    const q = ($("#bookSearch").value || "").trim().toLowerCase();
    const sort = $("#bookSort").value;
    let list = WORDS.filter((w) => {
      const p = prog(w.id);
      return p.wrong > 0 && p.stage < MASTER && p.stage >= 1;
    });
    if (q) list = list.filter((w) => w.en.toLowerCase().includes(q) || w.zh.includes(q));

    const cmp = {
      due: (a, b) => prog(a.id).due - prog(b.id).due,
      wrong: (a, b) => prog(b.id).wrong - prog(a.id).wrong,
      recent: (a, b) => prog(b.id).last - prog(a.id).last,
      alpha: (a, b) => a.en.localeCompare(b.en, "en"),
    }[sort] || ((a, b) => prog(a.id).due - prog(b.id).due);
    list.sort(cmp);

    const box = $("#bookList");
    box.innerHTML = "";
    $("#bookSub").textContent = list.length + " 个词待攻克 · 连对 " + MASTER + " 次自动移出";

    if (!list.length) {
      box.appendChild(el("div", "book-empty", q ? "没有匹配的词" : "错词本是空的 —— 去学习时点「不认识」就会自动收集。"));
      return;
    }

    list.forEach((w) => {
      const p = prog(w.id);
      const item = el("div", "book-item");
      const left = el("div");
      left.appendChild(el("div", "bi-en", w.en));
      left.appendChild(el("div", "bi-zh", w.zh));
      const meta = el("div", "bi-meta");
      meta.appendChild(el("span", null, w.cat));
      const dots = el("span", "dotline");
      for (let i = 0; i < MASTER; i++) dots.appendChild(el("i", p.stage > i ? "on" : ""));
      meta.appendChild(dots);
      meta.appendChild(el("span", null, "错 " + p.wrong + " 次"));
      meta.appendChild(el("span", null, "下次 " + dueLabel(p.due)));
      left.appendChild(meta);

      const right = el("div");
      right.style.display = "flex";
      right.style.gap = "6px";
      const b1 = el("button", "mini-btn", "标记掌握");
      b1.onclick = () => {
        const q2 = prog(w.id);
        q2.stage = MASTER;
        q2.due = Date.now() + INTERVALS[6];
        setProg(w.id, q2);
        save();
        renderBook();
        renderHome();
      };
      const b2 = el("button", "mini-btn", "移出");
      b2.onclick = () => {
        const q2 = prog(w.id);
        q2.stage = 0;
        q2.wrong = 0;
        q2.right = 0;
        q2.due = 0;
        setProg(w.id, q2);
        save();
        renderBook();
        renderHome();
      };
      right.appendChild(b1);
      right.appendChild(b2);

      item.appendChild(left);
      item.appendChild(right);
      box.appendChild(item);
    });
  }

  /* ---------------- 设置 ---------------- */
  function renderSettings() {
    document.querySelectorAll("#sizeSeg button").forEach((b) => {
      b.classList.toggle("is-on", Number(b.dataset.size) === state.prefs.size);
    });
    document.querySelectorAll("#modeSeg button").forEach((b) => {
      b.classList.toggle("is-on", b.dataset.mode === state.prefs.mode);
    });
    $("#onlyNew").checked = !!state.prefs.onlyNew;
    $("#shuffleAll").checked = !!state.prefs.shuffle;
    const mn = $("#showMnemonic");
    if (mn) mn.checked = state.prefs.mnemonic !== false;
    const an = $("#autoNext");
    if (an) an.checked = state.prefs.autoNext !== false;
    document.querySelectorAll("#themeGrid button").forEach((b) => {
      b.classList.toggle("is-on", b.dataset.theme === (state.prefs.theme || "auto"));
    });
  }

  function openModal(v) {
    $("#modal").hidden = !v;
  }

  function exportData() {
    const blob = new Blob([JSON.stringify({ app: "kunword", v: 1, exportedAt: new Date().toISOString(), progress: state.progress, days: state.days, prefs: state.prefs }, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "kunword-backup-" + dayKey() + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("已导出备份文件");
  }

  function importData(file) {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const d = JSON.parse(String(fr.result));
        if (!d || !d.progress) throw new Error("格式不对");
        state.progress = d.progress;
        if (d.days) state.days = d.days;
        if (d.prefs) Object.assign(state.prefs, d.prefs);
        save();
        renderHome();
        renderBook();
        renderSettings();
        toast("导入成功：" + Object.keys(d.progress).length + " 条记录");
      } catch (e) {
        toast("导入失败：不是本应用的备份文件");
      }
    };
    fr.readAsText(file);
  }

  /* ---------------- 朗读 ---------------- */
  function speak(text) {
    if (!("speechSynthesis" in window)) return toast("当前浏览器不支持朗读");
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(
        text.replace(/\(.*?\)/g, " ").replace(/,.*$/, "").replace(/\s+/g, " ").trim()
      );
      u.lang = "en-US";
      u.rate = 0.92;
      window.speechSynthesis.speak(u);
    } catch (e) {
      /* ignore */
    }
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    $("#btnStart").onclick = () => startSession(ui.scope === "book" ? "book" : ui.scope);
    $("#btnReview").onclick = () => {
      ui.scope = "book";
      startSession("book");
    };

    $("#btnKnown").onclick = () => answerCard(true);
    $("#btnUnknown").onclick = () => answerCard(false);
    $("#btnNext").onclick = nextCard;
    const spellBtn = $("#btnSpellSubmit");
    if (spellBtn) spellBtn.onclick = () => answerSpell();
    const spellInput = $("#spellInput");
    if (spellInput) {
      spellInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          answerSpell();
        }
      });
    }
    $("#btnPrev").onclick = () => (session && session.review ? exitReview() : showPrev());
    $("#btnExitReview").onclick = () => exitReview();

    $("#btnSpeak").onclick = () => {
      const id = session ? session.queue[session.p] : null;
      if (id != null) speak(byId.get(id).en);
    };

    $("#btnQuit").onclick = () => {
      stopAutoNext();
      const done = session ? session.right + session.wrong : 0;
      if (done > 0) {
        finish();
      } else {
        session = null;
        show("home");
        renderHome();
      }
    };

    $("#btnAgain").onclick = () => {
      const scope = session ? session.scope : ui.scope;
      startSession(scope);
    };
    $("#btnHome").onclick = () => {
      session = null;
      show("home");
      renderHome();
    };

    $("#btnSettings").onclick = () => {
      renderSettings();
      applyTheme();
      openModal(true);
    };
    $("#btnCloseModal").onclick = () => openModal(false);
    $("#modal").addEventListener("click", (e) => {
      if (e.target.id === "modal") openModal(false);
    });

    document.querySelectorAll("#sizeSeg button").forEach((b) => {
      b.onclick = () => {
        state.prefs.size = Number(b.dataset.size);
        save();
        renderSettings();
      };
    });
    document.querySelectorAll("#modeSeg button").forEach((b) => {
      b.onclick = () => {
        state.prefs.mode = b.dataset.mode;
        save();
        renderSettings();
        toast(
          b.dataset.mode === "quiz"
            ? "已切换：四选一考核"
            : b.dataset.mode === "spell"
            ? "已切换：中译英拼写"
            : "已切换：自评卡片"
        );
      };
    });

    $("#onlyNew").onchange = (e) => {
      state.prefs.onlyNew = e.target.checked;
      save();
    };
    $("#shuffleAll").onchange = (e) => {
      state.prefs.shuffle = e.target.checked;
      save();
    };
    const mnBox = $("#showMnemonic");
    if (mnBox) {
      mnBox.onchange = (e) => {
        state.prefs.mnemonic = e.target.checked;
        save();
        if (session && !$("#cardReveal").hidden) {
          const id = session.queue[session.p];
          if (id != null) renderMnemonic(byId.get(id));
        }
      };
    }

    document.querySelectorAll("#themeGrid button").forEach((b) => {
      b.onclick = () => setTheme(b.dataset.theme);
    });
    const themeBtn = $("#btnTheme");
    if (themeBtn) {
      themeBtn.onclick = () => {
        const cur = resolveTheme(state.prefs.theme);
        const next = cur === "dark" ? "light" : "dark";
        setTheme(next);
        toast(next === "dark" ? "已切到暗色" : "已切到亮色");
      };
    }
    if (mqLight) {
      const onSys = () => {
        if ((state.prefs.theme || "auto") === "auto") applyTheme();
      };
      if (mqLight.addEventListener) mqLight.addEventListener("change", onSys);
      else if (mqLight.addListener) mqLight.addListener(onSys);
    }

    $("#btnExport").onclick = exportData;
    $("#btnImport").onclick = () => $("#importFile").click();
    $("#importFile").onchange = (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) importData(f);
      e.target.value = "";
    };
    $("#btnReset").onclick = () => {
      if (!confirm("确定清空全部学习进度？此操作不可恢复。")) return;
      localStorage.removeItem(KEY);
      state.progress = {};
      state.days = {};
      renderHome();
      renderBook();
      toast("进度已清空");
    };

    $("#bookSearch").oninput = renderBook;
    $("#bookSort").onchange = renderBook;
    $("#btnOpenBook").onclick = () => {
      renderBook();
      show("book");
    };
    $("#btnBookBack").onclick = () => {
      show("home");
      renderHome();
    };
    $("#btnBookStudy").onclick = () => {
      ui.scope = "book";
      startSession("book");
    };

    const openWords = () => {
      renderWords();
      show("words");
      setTimeout(() => $("#wordSearch").focus(), 60);
    };
    const openBookBtn = $("#btnOpenWords");
    if (openBookBtn) openBookBtn.onclick = openWords;
    $("#btnWordsBack").onclick = () => {
      show("home");
      renderHome();
    };
    $("#wordSearch").oninput = renderWords;
    $("#wordStatus").onchange = renderWords;

    document.addEventListener("keydown", (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "select" || tag === "textarea") return;

      if (ui.view === "home" && e.key === "Enter" && $("#modal").hidden) {
        e.preventDefault();
        $("#btnStart").click();
        return;
      }
      if (e.key === "Escape" && !$("#modal").hidden) {
        openModal(false);
        return;
      }
      if (ui.view !== "study" || !session) return;

      // 回看模式：Esc / Backspace / 空格 都退回当前题
      if (session.review) {
        if (e.key === "Escape" || e.key === "Backspace" || e.key === " " || e.key === "Enter") {
          e.preventDefault();
          exitReview();
        }
        return;
      }

      const key = String(e.key || "").toLowerCase();

      // 上一题
      if (e.key === "Backspace" || key === "[") {
        e.preventDefault();
        showPrev();
        return;
      }

      if (e.key === "Escape") {
        $("#btnQuit").click();
        return;
      }

      // Q = 认识，E = 不认识（作答前后都能按）
      if (key === "q") {
        e.preventDefault();
        assess("known");
        return;
      }
      if (key === "e") {
        e.preventDefault();
        assess("unknown");
        return;
      }

      if (session.mode === "quiz") {
        if (WASD.includes(key)) {
          const btn = $("#cardOptions [data-key='" + key + "']");
          if (btn && !btn.disabled && box_visible()) {
            e.preventDefault();
            btn.click();
          }
          return;
        }
        if ((e.key === " " || e.key === "Enter") && !$("#nextRow").hidden) {
          e.preventDefault();
          nextCard();
        }
        return;
      }
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (!$("#nextRow").hidden) nextCard();
        else if (!$("#answerRow").hidden) answerCard(true);
        return;
      }
      if (e.key === "1" || e.key === "ArrowLeft" || key === "j") {
        e.preventDefault();
        if (!$("#answerRow").hidden) answerCard(false);
        else if (!$("#nextRow").hidden) nextCard();
        return;
      }
      if (e.key === "2" || e.key === "ArrowRight" || key === "k") {
        e.preventDefault();
        if (!$("#answerRow").hidden) answerCard(true);
        else if (!$("#nextRow").hidden) nextCard();
        return;
      }
    });

    // 错词本 / 词库：Esc 返回首页
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "select" || tag === "textarea") return;
      if (ui.view === "book" || ui.view === "words") {
        show("home");
        renderHome();
      }
    });
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    load();
    bind();
    applyTheme();
    renderSettings();
    renderHome();
    renderBook();
    renderWords();
    show("home");
  }

  // 供 battle.js 复用
  window.KW = { show, toast, refreshHome: renderHome, refreshPills: updatePills, words: WORDS, applyTheme, gradeSpell };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
