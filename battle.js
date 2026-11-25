/* ===== 昆词 · 真人排位对战（房间 / 竞速 / 云端加星） ===== */
(function () {
  "use strict";

  const KW = window.KW;
  const RANK = window.RANK;
  const KP = window.KP;
  const WORDS = window.VOCAB.words;

  const K_ID = "kunword.battle";
  /** 选错一次罚 2.5 秒，并短锁 0.26 秒（只做个反馈，不卡手感）。反穷举靠罚时，不靠锁 */
  const PENALTY_MS = 2500;
  const LOCK_MS = 260;
  const RACE_HINT = `选一个中文意思 · 选错 +${PENALTY_MS / 1000}s 罚时，只锁 ${(LOCK_MS / 1000).toFixed(1)}s`;
  /** 选项按键盘 WASD 的物理位置摆放 */
  const WASD = ["w", "a", "s", "d"];

  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, txt) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  };
  const shuffle = (a) => {
    const r = a.slice();
    for (let i = r.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [r[i], r[j]] = [r[j], r[i]];
    }
    return r;
  };
  const readJSON = (k, fb) => {
    try {
      return Object.assign(fb, JSON.parse(localStorage.getItem(k) || "{}"));
    } catch (e) {
      return fb;
    }
  };
  const idStore = {
    get: () => readJSON(K_ID, { pid: "", nick: "" }),
    set: (o) => localStorage.setItem(K_ID, JSON.stringify(o)),
  };

  let B = null;
  const T = { poll: null, clock: null, race: null, fallback: null };

  /* ---------------- 网络 ---------------- */
  async function api(action, payload) {
    const res = await fetch("/api/" + action, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error("服务器没有响应（" + res.status + "）");
    }
    if (!data || data.ok === false) throw new Error((data && data.error) || "请求失败（" + res.status + "）");
    return data;
  }

  const stopTimers = () => {
    ["poll", "clock", "race"].forEach((k) => {
      if (T[k]) clearInterval(T[k]);
      T[k] = null;
    });
    if (T.fallback) {
      clearTimeout(T.fallback);
      T.fallback = null;
    }
  };

  /* ---------------- 云端存档展示 ---------------- */
  function profileOrEmpty() {
    const p = KP.current();
    if (p) return p;
    const d = RANK.decode(0);
    return { stars: 0, games: 0, wins: 0, losses: 0, streak: 0, best: 0, rank: d, rankLabel: d.label, history: [] };
  }

  function renderRank() {
    const p = profileOrEmpty();
    const d = p.rank || RANK.decode(p.stars || 0);

    $("#rankEmblem").textContent = d.icon;
    $("#rankLabel").textContent = d.label;
    $("#rankStarChip").textContent = d.isKing ? d.starInSub + " 星" : d.starInSub + "/" + d.per + " 星";
    $("#rankTip").textContent = d.tip || "";
    $("#rankProgressFill").style.width = d.isKing ? "100%" : Math.round((d.starInSub / d.per) * 100) + "%";
    $("#rankNext").textContent = d.isKing
      ? "已登顶虫王，再赢就是纯粹的排面：" + (p.stars - RANK.TOTAL) + " 星"
      : `再赢 ${d.starsToNext} 星升到 ${nextSubLabel(d)}`;

    const g = $("#rankStats");
    g.innerHTML = "";
    [
      { n: p.games || 0, l: "总场次", cls: "" },
      { n: p.wins || 0, l: "第一", cls: "is-mint" },
      { n: p.losses || 0, l: "垫底", cls: "is-rose" },
      { n: p.best || 0, l: "最长连胜", cls: "is-amber" },
    ].forEach((k) => {
      const box = el("div", "stat " + k.cls);
      box.appendChild(el("b", null, String(k.n)));
      box.appendChild(el("span", null, k.l));
      g.appendChild(box);
    });

    $("#homeEmblem").textContent = d.icon;
    $("#homeRank").textContent =
      d.label + " · " + (d.isKing ? d.starInSub + " 星" : d.starInSub + "/" + d.per + " 星");

    renderLadder(d.tierIndex);
    renderCloud();
    renderHistory(p.history || []);
  }

  function nextSubLabel(d) {
    if (d.isKing) return "虫王";
    if (d.sub > 1) return d.name + " " + RANK.ROMAN[d.sub - 1];
    const next = RANK.TIERS[d.tierIndex + 1];
    return next ? next.name + " " + RANK.ROMAN[next.subs] : "虫王";
  }

  function renderLadder(tierIndex) {
    const lad = $("#rankLadder");
    if (!lad.dataset.done) {
      lad.innerHTML = "";
      RANK.ladder().forEach((t) => {
        const row = el("div", "ladder-row");
        row.appendChild(el("span", "ladder-icon", t.icon));
        row.appendChild(el("b", "ladder-name", t.name));
        row.appendChild(el("span", "ladder-meta", `${t.per} 星 × ${t.subs} 小段`));
        lad.appendChild(row);
      });
      const king = el("div", "ladder-row is-king");
      king.appendChild(el("span", "ladder-icon", RANK.KING.icon));
      king.appendChild(el("b", "ladder-name", RANK.KING.name));
      king.appendChild(el("span", "ladder-meta", "78 星之后无上限"));
      lad.appendChild(king);
      lad.dataset.done = "1";
    }
    lad.querySelectorAll(".ladder-row").forEach((row, i) => {
      row.classList.toggle("is-now", i === tierIndex);
    });
  }

  function renderCloud() {
    const st = KP.status();
    const dot = $("#cloudDot");
    const text = $("#cloudText");
    if (!dot || !text) return;
    if (BACKEND === false) {
      dot.className = "cloud-dot";
      text.textContent = "静态托管版：段位与战绩不存云端（换成带后端的部署才有）";
      return;
    }
    if (st.syncing) {
      dot.className = "cloud-dot sync";
      text.textContent = "正在同步云端存档…";
    } else if (KP.error) {
      dot.className = "cloud-dot bad";
      text.textContent = "云端暂时连不上：" + KP.error + "（显示的是上次缓存）";
    } else if (KP.current()) {
      dot.className = "cloud-dot ok";
      const p = KP.current();
      text.textContent = "已存在云端 · " + (p.games || 0) + " 场战绩已备份，换设备也不会丢";
    } else {
      dot.className = "cloud-dot";
      text.textContent = "正在准备云端存档…";
    }
  }

  function renderHistory(list) {
    const box = $("#rankHistory");
    if (!box) return;
    box.innerHTML = "";
    if (!list.length) {
      box.appendChild(el("div", "book-empty", "还没有对战记录，去开一局吧。"));
      return;
    }
    list.slice(0, 8).forEach((h) => {
      const row = el("div", "hist-row");
      const medal = h.place === 1 ? "🥇" : h.place === h.total ? "🔚" : "#" + h.place;
      row.appendChild(el("span", "hist-place", medal));
      row.appendChild(el("b", "hist-rank", h.rank));
      row.appendChild(el("span", "hist-meta", `${h.total} 人 · ${(h.ms / 1000).toFixed(1)}s`));
      const d = el("span", "hist-delta " + (h.delta > 0 ? "up" : h.delta < 0 ? "down" : "flat"),
        h.delta > 0 ? `+${h.delta}★` : h.delta < 0 ? `−${Math.abs(h.delta)}★` : "±0");
      row.appendChild(d);
      const t = new Date(h.at);
      row.appendChild(el("span", "hist-time", `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`));
      box.appendChild(row);
    });
  }

  function setMsg(text) {
    const n = $("#rankMsg");
    if (n) n.textContent = text || "";
  }

  function mePayload() {
    const p = profileOrEmpty();
    const d = p.rank || RANK.decode(p.stars || 0);
    return { uid: KP.identity().uid, rankLabel: d.label, rankIcon: d.icon };
  }

  function ensureNick() {
    const input = $("#nickInput");
    const nick = (input.value || KP.nickname() || "").trim().slice(0, 10);
    if (!nick) {
      input.focus();
      setMsg("先给自己起个虫名吧");
      return "";
    }
    KP.setLocalNick(nick);
    idStore.set(Object.assign(idStore.get(), { nick }));
    if (KP.current() && KP.current().nick !== nick) {
      KP.rename(nick).then(() => renderRank()).catch(() => {});
    }
    return nick;
  }

  /* ---------------- 建房 / 加入 ---------------- */
  async function createRoom() {
    if (BACKEND === false) return setMsg("这个版本没有对战后端");
    const nick = ensureNick();
    if (!nick) return;
    setMsg("正在建房…");
    try {
      const d = await api("create", Object.assign({ nick }, mePayload()));
      idStore.set({ pid: d.pid, nick: d.nick });
      setMsg("");
      enterRoom(d.code, d.pid, d.nick, true);
    } catch (e) {
      setMsg(e.message);
    }
  }

  async function joinRoom(codeArg) {
    if (BACKEND === false) return setMsg("这个版本没有对战后端");
    const nick = ensureNick();
    if (!nick) return;
    const code = String(codeArg || $("#joinCode").value || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .trim();
    if (code.length !== 6) return setMsg("房间码是 6 位字母或数字");
    setMsg("正在加入…");
    try {
      const saved = idStore.get();
      const d = await api("join", Object.assign({ code, nick, pid: saved.pid }, mePayload()));
      idStore.set({ pid: d.pid, nick: d.nick });
      setMsg("");
      enterRoom(d.code, d.pid, d.nick);
    } catch (e) {
      setMsg(e.message);
    }
  }

  function enterRoom(code, pid, nick, asHost) {
    stopTimers();
    B = { code, pid, nick, state: null, offset: 0, race: null, raceStartAt: 0, myFinishMs: 0, rankApplied: false, fails: 0, asHost: !!asHost };

    const u = new URL(location.href);
    u.searchParams.set("room", code);
    history.replaceState(null, "", u.toString());

    $("#roomCode").textContent = code;
    $("#inviteLink").value = location.origin + "/?room=" + code;

    KW.show("room");
    renderRoom();
    poll();
    T.poll = setInterval(poll, 1600);
  }

  async function poll() {
    if (!B) return;
    try {
      const st = await api("state", { code: B.code, pid: B.pid });
      B.fails = 0;
      B.offset = st.serverNow - Date.now();
      B.state = st;
      routeState();
    } catch (e) {
      B.fails = (B.fails || 0) + 1;
      if (B.fails >= 3) {
        stopTimers();
        KW.toast(e.message);
        leaveToRank(true);
      }
    }
  }

  function routeState() {
    const st = B.state;
    if (!st) return;
    if (st.status === "waiting") {
      if (B.race || B.rankApplied) {
        B.race = null;
        B.rankApplied = false;
      }
      KW.show("room");
      renderRoom();
      return;
    }
    if (st.status === "playing") {
      if (!B.race && !B.rankApplied) startRace(st);
      else if (B.race && B.race.finished) renderWaiting();
      else if (B.race) renderTrack();
      return;
    }
    if (st.status === "done") showResults(st);
  }

  /* ---------------- 房间 ---------------- */
  function renderRoom() {
    const st = B.state;
    const players = (st && st.players) || [];
    // 刚建好房还没拿到第一次状态时，房主也能立刻看到按钮
    const isHost = st ? st.hostPid === B.pid : !!B.asHost;

    $("#roomStatus").textContent =
      players.length < 2 ? "等队友加入 —— 把邀请链接发给同学" : `已有 ${players.length} 人，可以开打了`;

    const grid = $("#roomPlayers");
    grid.innerHTML = "";
    players.forEach((p) => {
      const card = el("div", "pc" + (p.pid === B.pid ? " is-me" : ""));
      card.appendChild(el("div", "pc-av", (p.nick || "?").slice(0, 1)));
      const info = el("div", "pc-info");
      info.appendChild(el("b", null, p.nick));
      const meta = el("div", "pc-meta");
      meta.appendChild(el("span", null, [p.rankIcon, p.rankLabel || "幼虫 III"].filter(Boolean).join(" ")));
      if (p.pid === st.hostPid) meta.appendChild(el("span", "pc-host", "房主"));
      else if (p.pid === B.pid) meta.appendChild(el("span", "pc-host me", "你"));
      info.appendChild(meta);
      card.appendChild(info);
      grid.appendChild(card);
    });

    const start = $("#btnStartBattle");
    if (isHost) {
      start.hidden = false;
      start.disabled = players.length < 2;
      start.textContent = players.length < 2 ? "至少 2 人才能开打" : "开始对战";
      $("#roomHint").textContent = "开战后 3 秒倒计时同时开始，谁先答完 10 题谁拿星；星星会记到云端。";
    } else {
      start.hidden = true;
      $("#roomHint").textContent = "等房主点「开始对战」…";
    }
  }

  /* ---------------- 竞速 ---------------- */
  function buildQuiz() {
    const picks = shuffle(WORDS).slice(0, 10);
    return picks.map((w) => {
      const same = shuffle(WORDS.filter((x) => x.id !== w.id && x.cat === w.cat && x.zh !== w.zh));
      const other = shuffle(WORDS.filter((x) => x.id !== w.id && x.zh !== w.zh));
      const opts = [];
      const used = new Set([w.zh]);
      for (const src of [same, other]) {
        for (const x of src) {
          if (opts.length >= 3) break;
          if (used.has(x.zh)) continue;
          used.add(x.zh);
          opts.push(x.zh);
        }
      }
      return { en: w.en, cat: w.cat, answer: w.zh, options: shuffle([w.zh, ...opts]) };
    });
  }

  async function startBattle() {
    if (!B || !B.state || B.state.hostPid !== B.pid) return;
    $("#btnStartBattle").disabled = true;
    try {
      await api("start", { code: B.code, pid: B.pid, quiz: buildQuiz() });
      await poll();
    } catch (e) {
      KW.toast(e.message);
      $("#btnStartBattle").disabled = false;
    }
  }

  function startRace(st) {
    B.race = { quiz: st.quiz || [], i: 0, wrong: 0, finished: false, penaltyMs: 0, locked: false };
    B.raceStartAt = 0;
    B.myFinishMs = 0;
    KW.show("race");
    $("#raceOptions").innerHTML = "";
    $("#raceWord").textContent = "准备…";
    $("#raceHint").textContent = "看题，别抢跑";
    $("#raceProgress").textContent = "0 / 10";
    $("#raceNote").textContent = "";
    updatePenalty();
    renderTrack();

    const startedAt = st.startedAt || Date.now();
    if (T.clock) clearInterval(T.clock);
    T.clock = setInterval(() => {
      if (!B || !B.race || B.race.finished) return;
      const left = startedAt - (Date.now() + B.offset);
      if (left > 0) {
        $("#raceTimer").textContent = String(Math.ceil(left / 1000));
        $("#raceWord").textContent = "准备…";
        $("#raceNote").textContent = "3 秒后同时开始";
        return;
      }
      if (!B.raceStartAt) {
        B.raceStartAt = startedAt - (B.offset || 0);
        $("#raceNote").textContent = "";
        renderQuestion();
        if (!T.race) T.race = setInterval(tickTimer, 100);
      }
    }, 100);
  }

  function tickTimer() {
    if (!B || !B.raceStartAt || !B.race || B.race.finished) return;
    $("#raceTimer").textContent = ((Date.now() - B.raceStartAt) / 1000).toFixed(1) + "s";
  }

  function renderTrack() {
    const st = B.state;
    const box = $("#raceTrack");
    if (!st) return;
    box.innerHTML = "";
    st.players.forEach((p) => {
      const row = el("div", "tr" + (p.pid === B.pid ? " is-me" : ""));
      row.appendChild(el("span", "tr-name", p.nick));
      const dots = el("span", "tr-dots");
      const done = p.finishMs > 0 ? 10 : p.answered || 0;
      for (let i = 0; i < 10; i++) dots.appendChild(el("i", i < done ? "on" : ""));
      row.appendChild(dots);
      row.appendChild(el("span", "tr-time", p.finishMs > 0 ? (p.finishMs / 1000).toFixed(1) + "s" : ""));
      box.appendChild(row);
    });
  }

  function renderQuestion() {
    const r = B.race;
    const q = r.quiz[r.i];
    if (!q) return;
    $("#raceWord").textContent = q.en;
    $("#raceCat").textContent = q.cat || "术语";
    $("#raceProgress").textContent = r.i + 1 + " / 10";
    $("#raceHint").textContent = RACE_HINT;
    $("#raceCard").classList.remove("is-miss", "is-known");
    r.locked = false;
    updatePenalty();

    const box = $("#raceOptions");
    box.innerHTML = "";
    box.classList.add("wasd");
    q.options.forEach((text, i) => {
      const key = WASD[i];
      const b = el("button", "option opt-" + key, text);
      b.dataset.key = key;
      b.dataset.zh = text;
      b.appendChild(el("span", "opt-key", key.toUpperCase()));
      b.onclick = () => pickOption(b, text);
      box.appendChild(b);
    });
  }

  function pickOption(btn, text) {
    const r = B.race;
    if (!r || r.finished || r.locked) return;
    const q = r.quiz[r.i];
    if (text === q.answer) {
      btn.classList.add("is-right");
      Array.from($("#raceOptions").children).forEach((b) => (b.disabled = true));
      $("#raceCard").classList.add("is-known");
      r.i++;
      if (r.i >= 10) finishMine();
      else {
        post("progress", { code: B.code, pid: B.pid, answered: r.i, wrong: r.wrong });
        setTimeout(() => {
          if (B && B.race && !B.race.finished) renderQuestion();
        }, 180);
      }
    } else {
      // 选错不再“排除错误项”，而是罚时 + 短暂锁定，穷举变得毫无意义
      r.wrong++;
      r.penaltyMs += PENALTY_MS;
      r.locked = true;
      btn.classList.add("is-wrong");
      const opts = Array.from($("#raceOptions").children);
      opts.forEach((b) => (b.disabled = true));
      $("#raceCard").classList.add("is-miss");
      updatePenalty();
      post("progress", { code: B.code, pid: B.pid, answered: r.i, wrong: r.wrong });

      setTimeout(() => {
        if (!B || !B.race || B.race.finished) return;
        $("#raceCard").classList.remove("is-miss");
        // 四个选项全部恢复可点（包括刚才点错的那个），不能再靠排除法
        opts.forEach((b) => {
          b.disabled = false;
          b.classList.remove("is-wrong");
        });
        r.locked = false;
      }, LOCK_MS);
    }
  }

  function updatePenalty() {
    const r = B.race;
    if (!r) return;
    const n = $("#racePenalty");
    if (!n) return;
    if (r.wrong > 0) {
      n.hidden = false;
      n.textContent = `错 ${r.wrong} 次 · 罚时 +${(r.penaltyMs / 1000).toFixed(1)}s`;
    } else {
      n.hidden = true;
    }
  }

  async function post(action, payload) {
    try {
      const st = await api(action, payload);
      if (st && st.players) {
        B.state = st;
        B.offset = st.serverNow - Date.now();
        if (st.status === "playing") renderTrack();
        if (st.status === "done") showResults(st);
      }
      return st;
    } catch (e) {
      return null;
    }
  }

  async function finishMine() {
    const r = B.race;
    r.finished = true;
    const pure = Math.max(1, Date.now() - B.raceStartAt);
    const ms = pure + r.penaltyMs; // 结算用的是“净用时 + 罚时”
    B.myFinishMs = ms;
    if (T.clock) clearInterval(T.clock), (T.clock = null);
    if (T.race) clearInterval(T.race), (T.race = null);
    $("#raceOptions").innerHTML = "";
    $("#raceWord").textContent = "完成！";
    $("#raceHint").textContent = "等其他人答完…";
    $("#raceNote").textContent =
      r.wrong > 0 ? `净用时 ${(pure / 1000).toFixed(1)}s + 罚时 ${(r.penaltyMs / 1000).toFixed(1)}s` : `你的成绩 ${(pure / 1000).toFixed(1)}s`;

    const st = await post("finish", { code: B.code, pid: B.pid, ms, wrong: r.wrong, answered: 10 });
    if (st && st.status === "done") return showResults(st);
    renderWaiting();

    // 兜底：30 秒后还没全员完成，让服务器按当前成绩结算
    T.fallback = setTimeout(async () => {
      if (!B || B.rankApplied) return;
      const s2 = await post("settle", { code: B.code, pid: B.pid });
      if (s2 && s2.status === "done") showResults(s2);
    }, 31000);
  }

  function renderWaiting() {
    const st = B.state;
    if (!st) return;
    const rows = st.players
      .slice()
      .sort((a, b) => (a.finishMs || Infinity) - (b.finishMs || Infinity) || b.answered - a.answered);
    const box = $("#raceTrack");
    box.innerHTML = "";
    const list = el("div", "wait-board");
    rows.forEach((p, i) => {
      const row = el("div", "wait-row" + (p.pid === B.pid ? " is-me" : ""));
      row.appendChild(el("span", "wait-place", "#" + (i + 1)));
      row.appendChild(el("span", "wait-nick", p.nick));
      row.appendChild(
        el("span", "wait-state", p.finishMs > 0 ? (p.finishMs / 1000).toFixed(1) + "s" : `答到 ${p.answered}/10`)
      );
      list.appendChild(row);
    });
    box.appendChild(list);
  }

  /* ---------------- 结算（数据来自服务器） ---------------- */
  function showResults(st) {
    if (!B || B.rankApplied) return;
    B.rankApplied = true;
    stopTimers();
    B.state = st;

    const results = st.results || [];
    const mine = results.find((r) => r.pid === B.pid);
    const place = mine ? mine.place : 1;
    const total = mine ? mine.total : results.length || 1;

    $("#bresultPlace").textContent = "#" + place;
    const pct = total > 1 ? ((total - place) / (total - 1)) * 100 : 100;
    $("#bresultRing").style.setProperty("--pct", Math.round(pct) + "%");
    $("#bresultTitle").textContent = !mine
      ? "这局没记到你的成绩"
      : mine.delta > 0
      ? `第 ${place} 名！+${mine.delta} 星`
      : mine.delta < 0
      ? `第 ${place} 名，${mine.delta} 星`
      : "星星不变";
    $("#bresultSub").textContent = mine
      ? `净用时 ${((mine.ms - (mine.wrong || 0) * PENALTY_MS) / 1000).toFixed(1)}s` +
        (mine.wrong ? ` + 罚时 ${(((mine.wrong || 0) * PENALTY_MS) / 1000).toFixed(1)}s` : "") +
        ` · ${total} 人同场 · 云端段位 ${mine.rank}`
      : "成绩已同步到云端";

    const board = $("#bresultBoard");
    board.innerHTML = "";
    results.forEach((p, i) => {
      const row = el("div", "board-row" + (p.pid === B.pid ? " is-me" : ""));
      row.appendChild(el("span", "board-place", ["🥇", "🥈", "🥉"][i] || "#" + (i + 1)));
      row.appendChild(el("span", "board-nick", p.nick + (p.pid === B.pid ? "（你）" : "")));
      row.appendChild(
        el("span", "board-time", p.ms > 0 ? (p.ms / 1000).toFixed(1) + "s" + (p.wrong ? ` · 错 ${p.wrong}` : "") : "未完成")
      );
      if (i === 0) row.classList.add("is-win");
      board.appendChild(row);
    });

    const wrap = $("#starChange");
    wrap.innerHTML = "";
    if (mine) {
      const delta = el("div", "delta " + (mine.delta > 0 ? "up" : mine.delta < 0 ? "down" : "flat"));
      delta.appendChild(
        el("b", null, mine.delta > 0 ? `+${mine.delta} ★` : mine.delta < 0 ? `−${Math.abs(mine.delta)} ★` : "±0 ★")
      );
      delta.appendChild(el("span", null, `云端已更新`));
      wrap.appendChild(delta);

      const line = el("div", "rank-line-now");
      line.appendChild(el("span", "ri", mine.rankIcon || "🐛"));
      line.appendChild(el("b", null, mine.rank));
      line.appendChild(
        el("span", "muted", mine.isKing ? mine.starInSub + " 星" : `${mine.starInSub}/${mine.per} 星`)
      );
      wrap.appendChild(line);

      if (mine.promoted) wrap.appendChild(el("p", "banner up", `晋级！${mine.fromLabel} → ${mine.rank}`));
      else if (mine.demoted) wrap.appendChild(el("p", "banner down", `掉段了：${mine.fromLabel} → ${mine.rank}`));
      if (mine.promoted) KW.toast("晋级成功：" + mine.rank);
    }

    KW.show("bresult");
    // 拉一次最新存档：把星星、战绩、历史都刷新掉
    KP.refresh().then(() => renderRank());
  }

  /* ---------------- 再来一局 / 离开 ---------------- */
  async function rematch() {
    if (!B) return leaveToRank();
    const st = B.state;
    if (st && st.hostPid === B.pid) {
      try {
        await api("reset", { code: B.code, pid: B.pid });
      } catch (e) {
        KW.toast(e.message);
      }
    } else {
      KW.toast("等房主开下一局…");
    }
    B.race = null;
    B.rankApplied = false;
    B.myFinishMs = 0;
    stopTimers();
    KW.show("room");
    renderRoom();
    poll();
    T.poll = setInterval(poll, 1600);
  }

  async function leaveRoom() {
    if (B) {
      try {
        await api("leave", { code: B.code, pid: B.pid });
      } catch (e) {}
    }
    leaveToRank();
  }

  function leaveToRank(silent) {
    stopTimers();
    B = null;
    try {
      const u = new URL(location.href);
      u.searchParams.delete("room");
      history.replaceState(null, "", u.toString());
    } catch (e) {}
    renderRank();
    KW.show("rank");
    if (!silent) setMsg("");
  }

  /* ---------------- 换设备 ---------------- */
  async function doHandoff() {
    const box = $("#handoffOut");
    box.textContent = "生成中…";
    try {
      const d = await KP.makeHandoff();
      if (!d.ok) throw new Error(d.error || "生成失败");
      box.innerHTML = "";
      box.appendChild(el("span", "muted", "10 分钟内有效，只能使用一次："));
      const code = el("b", "handoff-code", d.code);
      box.appendChild(code);
      const btn = el("button", "mini-btn", "复制");
      btn.onclick = () => {
        navigator.clipboard.writeText(d.code).then(
          () => KW.toast("换机码已复制"),
          () => KW.toast("复制失败，请手动记下：" + d.code)
        );
      };
      box.appendChild(btn);
    } catch (e) {
      box.textContent = e.message;
    }
  }

  async function doRedeem() {
    const input = $("#redeemCode");
    const code = input.value.trim().toUpperCase();
    if (code.length < 4) return KW.toast("换机码不对");
    const out = $("#handoffOut");
    out.textContent = "正在接管存档…";
    try {
      const d = await KP.redeem(code);
      if (!d.ok) throw new Error(d.error || "换机失败");
      input.value = "";
      out.textContent = "已接管存档：" + d.profile.rank.label + " · " + d.profile.games + " 场战绩";
      renderRank();
      KW.toast("存档已迁移到这台设备");
    } catch (e) {
      out.textContent = e.message;
    }
  }

  /* ---------------- 后端探测 ---------------- */
  let BACKEND = null; // null 未知 / true 可用 / false 纯静态托管

  async function probeBackend() {
    try {
      const r = await fetch("/api/state?code=PROBE0", { headers: { accept: "application/json" } });
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("json")) return false;
      const d = await r.json().catch(() => null);
      return !!(d && typeof d === "object" && ("ok" in d || "error" in d));
    } catch (e) {
      return false;
    }
  }

  function offlineMode() {
    BACKEND = false;
    const note = $("#backendNote");
    if (note) {
      note.hidden = false;
      note.innerHTML =
        "<b>当前是纯静态托管版本</b> · 背单词、错词本、联想记忆、主题全部可用；" +
        "排位对战和云端存档需要服务器后端，这个版本没有。<span class='notice-sub'>" +
        "要开对战请用带 Netlify 函数的那个部署（kun-ci.netlify.app）。</span>";
    }
    ["#btnCreateRoom", "#btnJoinRoom", "#btnHandoff", "#btnRedeem", "#btnStartBattle"].forEach((s) => {
      const b = $(s);
      if (b) {
        b.disabled = true;
        b.dataset.static = "1";
      }
    });
    const cloud = $("#cloudText");
    if (cloud) cloud.textContent = "静态托管版：段位与战绩不存云端";
    const code = new URLSearchParams(location.search).get("room");
    if (code) setMsg("这个版本没有对战后端，房间进不去");
  }
  /* ---------------- 绑定 ---------------- */
  function init() {
    $("#nickInput").value = KP.nickname() || "";

    KP.on(() => {
      renderRank();
      if (ui().view === "rank" || ui().view === "room") renderRoom();
      const n = $("#nickInput");
      if (n && !n.value && KP.nickname()) n.value = KP.nickname();
    });
    renderRank();

    // 先探一下有没有后端：纯静态托管时把对战相关按钮关掉
    probeBackend().then((ok) => {
      BACKEND = ok;
      if (!ok) {
        offlineMode();
        return;
      }
      KP.refresh();
    });

    $("#btnOpenBattle").onclick = () => {
      renderRank();
      KW.show("rank");
      if (BACKEND !== false) KP.refresh();
    };
    const backHome = () => {
      stopTimers();
      B = null;
      try {
        const u = new URL(location.href);
        u.searchParams.delete("room");
        history.replaceState(null, "", u.toString());
      } catch (e) {}
      KW.show("home");
      KW.refreshHome();
    };
    $("#btnRankBack").onclick = backHome;
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const v = ui().view;
      if (v === "rank") backHome();
      else if (v === "bresult") backHome();
    });

    // 对战里也用 W A S D 抢答
    document.addEventListener("keydown", (e) => {
      if (ui().view !== "race" || !B || !B.race || B.race.finished) return;
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "select" || tag === "textarea") return;
      const k = String(e.key || "").toLowerCase();
      if (!WASD.includes(k)) return;
      const btn = document.querySelector('#raceOptions [data-key="' + k + '"]');
      if (btn && !btn.disabled) {
        e.preventDefault();
        btn.click();
      }
    });
    $("#btnCreateRoom").onclick = createRoom;
    $("#btnJoinRoom").onclick = () => joinRoom();
    $("#joinCode").addEventListener("keydown", (e) => {
      if (e.key === "Enter") joinRoom();
    });
    $("#nickInput").addEventListener("change", (e) => {
      const v = e.target.value.trim().slice(0, 10);
      KP.setLocalNick(v);
      idStore.set(Object.assign(idStore.get(), { nick: v }));
      if (KP.current()) KP.rename(v).then(() => renderRank()).catch(() => {});
    });

    $("#btnStartBattle").onclick = startBattle;
    $("#btnLeaveRoom").onclick = () => leaveRoom();
    $("#btnCopyInvite").onclick = async () => {
      const v = $("#inviteLink").value;
      try {
        await navigator.clipboard.writeText(v);
        KW.toast("邀请链接已复制，发给同学即可");
      } catch (e) {
        $("#inviteLink").select();
        document.execCommand && document.execCommand("copy");
        KW.toast("已选中链接，按 Ctrl+C 复制");
      }
    };

    $("#btnRematch").onclick = rematch;
    $("#btnBackRank").onclick = () => leaveRoom();
    $("#btnHandoff").onclick = doHandoff;
    $("#btnRedeem").onclick = doRedeem;
    $("#redeemCode").addEventListener("keydown", (e) => {
      if (e.key === "Enter") doRedeem();
    });

    $("#raceSpeak").onclick = () => {
      if (!B || !B.race) return;
      const q = B.race.quiz[B.race.i];
      if (!q) return;
      try {
        const u = new SpeechSynthesisUtterance(q.en.replace(/\(.*?\)/g, " ").replace(/,.*$/, "").trim());
        u.lang = "en-US";
        u.rate = 0.92;
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
      } catch (e) {}
    };

    const code = new URLSearchParams(location.search).get("room");
    if (code) {
      const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      $("#joinCode").value = c;
      KW.show("rank");
      if (KP.nickname()) joinRoom(c);
      else {
        setMsg("输入虫名后点「加入房间」进入房间 " + c);
        $("#nickInput").focus();
      }
    }
  }

  function ui() {
    const active = document.querySelector(".view.is-active");
    return { view: active ? active.id.replace("view-", "") : "home" };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();