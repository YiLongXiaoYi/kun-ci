/* ===== 昆词 · 真人排位对战（WebRTC 点对点，无后端） =====
 *
 * 房主（建房的人）是权威端：出题、计时、收进度、算名次、广播结果。
 * 队友通过 PeerJS 公共信令服务器互相找到，之后数据走 WebRTC 数据通道直连。
 *
 * 房间码 = peer id 的后缀，格式 kunci-XXXXXX
 */
(function () {
  "use strict";

  const KW = window.KW;
  const RANK = window.RANK;
  const WORDS = window.VOCAB.words;

  const K_ID = "kunword.battle";
  const K_RANK = "kunword.rank";
  const PREFIX = "kunci-";
  const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const MAX_PLAYERS = 4;
  const PENALTY_MS = 2500;
  const LOCK_MS = 260;
  const WASD = ["w", "a", "s", "d"];
  const RACE_HINT = `选一个中文意思 · 选错 +${PENALTY_MS / 1000}s 罚时，只锁 ${(LOCK_MS / 1000).toFixed(1)}s`;

  /* 智能陪练：1v1 的离线对手。名字里直接写「陪练」，
     页面文案也写明是 AI —— 不冒充同学，也不预先写好输赢。 */
  const SPAR_NAMES = ["陪练·金龟子", "陪练·蟋蟀", "陪练·豆娘", "陪练·步行虫", "陪练·蚜虫", "陪练·蜉蝣"];
  const SPAR_TIERS = {
    easy: { key: "easy", label: "入门", icon: "🍃", mul: 1.35, acc: 0.58 },
    normal: { key: "normal", label: "常规", icon: "⚔", mul: 1.0, acc: 0.76 },
    hard: { key: "hard", label: "加练", icon: "🔥", mul: 0.82, acc: 0.88 },
  };
  const SPAR_COMEBACK = 3; // 连输这么多局，下一局降成「回温局」
  const SPAR_SIZES = [2, 3, 4]; // 随机 2 / 3 / 4 人局
  const SPAR_SPREAD = { 1: [1], 2: [0.95, 1.05], 3: [0.92, 1.0, 1.08] }; // 同局几位陪练之间的快慢差异

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
  const rnd = (n) => {
    const b = new Uint8Array(n);
    (window.crypto || crypto).getRandomValues(b);
    return Array.from(b, (x) => CODE_CHARS[x % CODE_CHARS.length]).join("");
  };

  const idStore = {
    get: () => readJSON(K_ID, { nick: "" }),
    set: (o) => localStorage.setItem(K_ID, JSON.stringify(o)),
  };
  const rankStore = {
    get: () =>
      readJSON(K_RANK, { stars: 0, games: 0, wins: 0, losses: 0, streak: 0, best: 0, history: [] }),
    set: (r) => localStorage.setItem(K_RANK, JSON.stringify(r)),
  };

  /* ---------------- 运行时状态 ---------------- */
  let R = null; // { code, pid, nick, isHost, peer, conns: Map<pid, conn>, players: Map<pid,{pid,nick,stars,label,icon,answered,wrong,finishMs}>, status, quiz, startedAt, race, applied }
  const T = { clock: null, race: null, fallback: null, spar: [] };

  const stopTimers = () => {
    ["clock", "race"].forEach((k) => {
      if (T[k]) clearInterval(T[k]);
      T[k] = null;
    });
    if (T.fallback) {
      clearTimeout(T.fallback);
      T.fallback = null;
    }
    T.spar.forEach((id) => clearTimeout(id));
    T.spar = [];
  };

  /* ---------------- 段位（纯本地） ---------------- */
  function renderRank() {
    const r = rankStore.get();
    const d = RANK.decode(r.stars || 0);

    $("#rankEmblem").textContent = d.icon;
    $("#rankLabel").textContent = d.label;
    $("#rankStarChip").textContent = d.isKing ? d.starInSub + " 星" : d.starInSub + "/" + d.per + " 星";
    $("#rankTip").textContent = d.tip || "";
    $("#rankProgressFill").style.width = d.isKing ? "100%" : Math.round((d.starInSub / d.per) * 100) + "%";
    $("#rankNext").textContent = d.isKing
      ? "已登顶虫王，再赢就是纯粹的排面：" + (r.stars - RANK.TOTAL) + " 星"
      : `再赢 ${d.starsToNext} 星升到 ${nextSubLabel(d)}`;

    const g = $("#rankStats");
    g.innerHTML = "";
    [
      { n: r.games || 0, l: "总场次", cls: "" },
      { n: r.wins || 0, l: "第一", cls: "is-mint" },
      { n: r.losses || 0, l: "垫底", cls: "is-rose" },
      { n: r.best || 0, l: "最长连胜", cls: "is-amber" },
    ].forEach((k) => {
      const box = el("div", "stat " + k.cls);
      box.appendChild(el("b", null, String(k.n)));
      box.appendChild(el("span", null, k.l));
      g.appendChild(box);
    });

    $("#homeEmblem").textContent = d.icon;
    $("#homeRank").textContent =
      d.label + " · " + (d.isKing ? d.starInSub + " 星" : d.starInSub + "/" + d.per + " 星");

    renderSparInfo();
    renderLadder(d.tierIndex);
    renderHistory(r.history || []);
  }

  /** 排位页那行「当前陪练」小字：难度 + 每题大致用时，全部来自真实计算 */
  function renderSparInfo() {
    const n = $("#sparInfo");
    if (!n) return;
    const p = sparProfile();
    const tier = SPAR_TIERS[p.tier];
    const bits = [`当前陪练：${tier.label} · 约 ${p.perQ.toFixed(1)} 秒/题 · 2–4 人随机`];
    if (p.comeback) bits.push(`连输 ${p.lossStreak} 局 → 这一局是回温局`);
    else if (p.winStreak >= SPAR_COMEBACK) bits.push(`连胜 ${p.winStreak} 局 → 陪练提速到加练`);
    n.textContent = bits.join(" · ");
  }

  function nextSubLabel(d) {
    if (d.isKing) return "虫王";
    if (d.sub > 1) return d.name + " " + RANK.ROMAN[d.sub - 1];
    const next = RANK.TIERS[d.tierIndex + 1];
    return next ? next.name + " " + RANK.ROMAN[next.subs] : "虫王";
  }

  function renderLadder(tierIndex) {
    const lad = $("#rankLadder");
    if (!lad) return;
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

  function renderHistory(list) {
    const box = $("#rankHistory");
    if (!box) return;
    box.innerHTML = "";
    if (!list.length) {
      box.appendChild(el("div", "book-empty", "还没有对战记录，去开一局吧。"));
      return;
    }
    list
      .slice(-8)
      .reverse()
      .forEach((h) => {
      const row = el("div", "hist-row");
      row.appendChild(el("span", "hist-place", h.place === 1 ? "🥇" : "#" + h.place));
      row.appendChild(el("b", "hist-rank", h.rank));
      row.appendChild(el("span", "hist-meta", `${h.spar ? "人机" : h.total + " 人"} · ${(h.ms / 1000).toFixed(1)}s`));
      row.appendChild(
        el(
          "span",
          "hist-delta " + (h.delta > 0 ? "up" : h.delta < 0 ? "down" : "flat"),
          h.delta > 0 ? `+${h.delta}★` : h.delta < 0 ? `−${Math.abs(h.delta)}★` : "±0"
        )
      );
      const t = new Date(h.at);
      row.appendChild(
        el(
          "span",
          "hist-time",
          `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`
        )
      );
      box.appendChild(row);
    });
  }

  function setMsg(text) {
    const n = $("#rankMsg");
    if (n) n.textContent = text || "";
  }

  function meMeta() {
    const r = rankStore.get();
    const d = RANK.decode(r.stars || 0);
    return { stars: r.stars || 0, label: d.label, icon: d.icon };
  }

  function ensureNick() {
    const input = $("#nickInput");
    const nick = (input.value || idStore.get().nick || "").trim().slice(0, 10);
    if (!nick) {
      input.focus();
      setMsg("先给自己起个虫名吧");
      return "";
    }
    idStore.set({ nick });
    return nick;
  }

  /* ---------------- PeerJS ---------------- */
  const ICE = {
    iceServers: [
      { urls: "stun:stun.miwifi.com" },
      { urls: "stun:stun.chat.bilibili.com" },
      { urls: "stun:stun.l.google.com:19302" },
    ],
  };

  function makePeer(id) {
    if (!window.Peer) throw new Error("PeerJS 没加载成功");
    return id ? new window.Peer(id, { config: ICE, debug: 0 }) : new window.Peer({ config: ICE, debug: 0 });
  }

  /* ---------------- 建房 ---------------- */
  function createRoom() {
    const nick = ensureNick();
    if (!nick) return;
    setMsg("正在建房…");
    const code = rnd(6);
    const pid = "h" + rnd(6);
    let peer;
    try {
      peer = makePeer(PREFIX + code);
    } catch (e) {
      return setMsg(e.message);
    }

    peer.on("open", () => {
      setMsg("");
      R = {
        code,
        pid,
        nick,
        isHost: true,
        peer,
        conns: new Map(),
        players: new Map(),
        status: "waiting",
        quiz: null,
        startedAt: 0,
        race: null,
        applied: false,
      };
      addPlayer(pid, nick, meMeta());
      enterRoom(code);
    });

    peer.on("error", (err) => {
      if (err && err.type === "unavailable-id") {
        setMsg("房间码撞车了，再点一次创建房间");
        try {
          peer.destroy();
        } catch (e) {}
      } else {
        setMsg("信令服务器连不上：" + (err && err.type ? err.type : "unknown") + "，再试一次");
      }
      R = null;
    });

    peer.on("connection", (conn) => {
      if (!R) return;
      if (R.status !== "waiting") {
        conn.on("open", () => {
          conn.send({ t: "reject", reason: "这一局已经开打了，等下一局吧" });
          setTimeout(() => conn.close(), 400);
        });
        return;
      }
      if (R.players.size >= MAX_PLAYERS) {
        conn.on("open", () => {
          conn.send({ t: "reject", reason: "房间满了（最多 4 人）" });
          setTimeout(() => conn.close(), 400);
        });
        return;
      }
      conn.on("open", () => {
        conn.on("data", (msg) => onHostMessage(conn, msg));
      });
      conn.on("close", () => hostDropConn(conn));
      conn.on("error", () => hostDropConn(conn));
    });
  }

  /* ---------------- 加入 ---------------- */
  function joinRoom(codeArg) {
    const nick = ensureNick();
    if (!nick) return;
    const code = String(codeArg || $("#joinCode").value || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
    if (code.length !== 6) return setMsg("房间码是 6 位字母或数字");

    setMsg("正在连接…");
    const pid = "g" + rnd(6);
    let peer;
    try {
      peer = makePeer(null);
    } catch (e) {
      return setMsg(e.message);
    }

    const failTimer = setTimeout(() => {
      if (!R) {
        setMsg("连不上房主，确认房间码、确认对方还开着页面，再试一次");
        try {
          peer.destroy();
        } catch (e) {}
      }
    }, 12000);

    peer.on("open", () => {
      const conn = peer.connect(PREFIX + code, { reliable: true });
      const setup = () => {
        clearTimeout(failTimer);
        R = {
          code,
          pid,
          nick,
          isHost: false,
          peer,
          conns: new Map(),
          players: new Map(),
          status: "waiting",
          quiz: null,
          startedAt: 0,
          race: null,
          applied: false,
        };
        // 队友这边也要把连接存起来，否则没法上报进度/成绩
        R.conns.set("host", conn);
        R.conn = conn;
        conn.on("data", onGuestMessage);
        conn.on("close", () => {
          if (R) {
            KW.toast("房主断开了");
            leaveToRank(true);
          }
        });
        conn.send({ t: "hello", pid, nick, meta: meMeta() });
        setMsg("");
        enterRoom(code);
      };
      if (conn.open) setup();
      else conn.on("open", setup);
    });

    peer.on("error", (err) => {
      clearTimeout(failTimer);
      const type = err && err.type;
      if (type === "peer-unavailable") setMsg("房间不存在，或者房主已经关掉了页面");
      else setMsg("连接失败：" + (type || "network"));
    });
  }

  /* ---------------- 房间页 ---------------- */
  function enterRoom(code) {
    const u = new URL(location.href);
    u.searchParams.set("room", code);
    history.replaceState(null, "", u.toString());

    $("#roomCode").textContent = code;
    $("#inviteLink").value = location.origin + location.pathname + "?room=" + code;
    KW.show("room");
    renderRoom();
  }

  function addPlayer(pid, nick, meta) {
    R.players.set(pid, {
      pid,
      nick,
      stars: meta.stars || 0,
      label: meta.label || "",
      icon: meta.icon || "",
      answered: 0,
      wrong: 0,
      finishMs: 0,
    });
  }

  function rosterPayload() {
    return {
      t: "roster",
      players: Array.from(R.players.values()).map((p) => ({ ...p })),
      status: R.status,
      hostPid: R.isHost ? R.pid : R.hostPid,
    };
  }

  function broadcast(payload, exceptPid) {
    R.conns.forEach((conn, pid) => {
      if (pid === exceptPid) return;
      if (conn && conn.open) {
        try {
          conn.send(payload);
        } catch (e) {}
      }
    });
  }

  function renderRoom() {
    if (!R) return;
    const players = Array.from(R.players.values());
    const isHost = R.isHost;

    $("#roomStatus").textContent =
      players.length < 2 ? "等队友加入 —— 把邀请链接或房间码发给同学" : `已有 ${players.length} 人，可以开打了`;

    const grid = $("#roomPlayers");
    grid.innerHTML = "";
    players.forEach((p) => {
      const card = el("div", "pc" + (p.pid === R.pid ? " is-me" : ""));
      card.appendChild(el("div", "pc-av", (p.nick || "?").slice(0, 1)));
      const info = el("div", "pc-info");
      info.appendChild(el("b", null, p.nick));
      const meta = el("div", "pc-meta");
      meta.appendChild(el("span", null, [p.icon, p.label || "幼虫 III"].filter(Boolean).join(" ")));
      if (p.pid === R.hostPid || (isHost && p.pid === R.pid)) meta.appendChild(el("span", "pc-host", "房主"));
      else if (p.pid === R.pid) meta.appendChild(el("span", "pc-host me", "你"));
      info.appendChild(meta);
      card.appendChild(info);
      grid.appendChild(card);
    });

    const start = $("#btnStartBattle");
    if (isHost) {
      start.hidden = false;
      start.disabled = players.length < 2;
      start.textContent = players.length < 2 ? "至少 2 人才能开打" : "开始对战";
      $("#roomHint").textContent = "开战后 3 秒倒计时同时开始，谁先答完 10 题谁拿星。";
    } else {
      start.hidden = true;
      $("#roomHint").textContent = "等房主点「开始对战」…（房间码 " + R.code + "）";
    }
  }

  /* ---------------- 出题 ---------------- */
  function buildQuiz(list) {
    const picks = shuffle(list && list.length ? list : WORDS).slice(0, 10);
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

  function startBattle() {
    if (!R || !R.isHost) return;
    if (R.players.size < 2) return;
    R.quiz = buildQuiz();
    R.status = "playing";
    R.startedAt = Date.now();
    R.applied = false;
    R.players.forEach((p) => {
      p.answered = 0;
      p.wrong = 0;
      p.finishMs = 0;
    });
    broadcast({ t: "start", quiz: R.quiz, inMs: 3000 });
    broadcast(rosterPayload());
    beginRace(R.quiz, 3000);
    // 兜底：有人一直不答题就不会有后续事件，45 秒后主动查一次结算
    if (T.fallback) clearTimeout(T.fallback);
    T.fallback = setTimeout(() => {
      if (R && R.isHost && R.status === "playing") maybeSettle();
    }, 47000);
  }

  /* ---------------- 快速匹配：离线智能陪练 ----------------
   *
   * 随机 2 / 3 / 4 人局（1–3 位 AI 对手），本机跑，不开房、不联网。速度不写死：按
   * 「你的掌握程度 + 你最近的实际用时」算出每题基准时间，再乘难度系数和各自的小幅差异，
   * 所以练得越好它们读得越快，同局里也会有一快一慢。出题优先从你正在复习的词里挑。
   * 连输 3 局自动降成「回温局」，页面里会明说；名次仍由用时决定，不是预先定好的。
   */

  /** 最近的连续垫底/连胜局数（history 是「早 → 晚」追加的，所以从末尾往回数） */
  function spinStreak(list, lose) {
    let n = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const h = list[i];
      if (!h || !(h.total > 1)) break;
      const hit = lose ? h.place === h.total : h.place === 1;
      if (hit) n++;
      else break;
    }
    return n;
  }

  /** 算这一局陪练的水平：掌握度决定它读得多快，连输/连胜决定难度系数 */
  function sparProfile() {
    const rank = rankStore.get();
    const hist = (rank.history || []).filter((h) => h && h.ms > 0);
    const times = hist.slice(0, 6).map((h) => h.ms / 1000).sort((a, b) => a - b);
    const median = times.length ? times[Math.floor(times.length / 2)] : 0;

    const m = KW.mastery ? KW.mastery() : { mastered: 0, total: 1 };
    const ratio = m.total ? m.mastered / m.total : 0;
    // 掌握度 0 → 6.2 秒/题，掌握度 100% → 4.0 秒/题
    const byMastery = Math.max(34, Math.min(64, 62 - 22 * ratio));
    // 一半看掌握度、一半看你最近的实测用时，手感差别不至于太大
    const base10 = median > 0 ? 0.45 * byMastery + 0.55 * Math.max(25, Math.min(150, median)) : byMastery;

    const lossStreak = spinStreak(rank.history || [], true);
    const winStreak = spinStreak(rank.history || [], false);
    let tier = "normal";
    let comeback = false;
    if (lossStreak >= SPAR_COMEBACK) {
      tier = "easy";
      comeback = true;
    } else if (winStreak >= SPAR_COMEBACK) {
      tier = "hard";
    }
    const t = SPAR_TIERS[tier];
    return {
      tier,
      comeback,
      lossStreak,
      winStreak,
      ratio,
      base10,
      perQ: (base10 * t.mul) / 10,
      secondsPerQ: (base10 * t.mul) / 10,
      acc: t.acc,
      mul: t.mul,
      label: t.label,
      icon: t.icon,
    };
  }

  /** 出题池：把你正在复习的词排在前面（错过 > 到期 > 学习中 > 没练过 > 已掌握） */
  function reviewWords() {
    const now = Date.now();
    const bucket = { wrong: [], due: [], learning: [], fresh: [], mastered: [] };
    WORDS.forEach((w) => {
      const p = KW.progressOf ? KW.progressOf(w.id) : { stage: 0, wrong: 0, due: 0 };
      const stage = p.stage | 0;
      if (stage >= 6) return bucket.mastered.push(w);
      if (p.wrong > 0) bucket.wrong.push(w);
      if (stage >= 1) (p.due <= now ? bucket.due : bucket.learning).push(w);
      else bucket.fresh.push(w);
    });
    const out = [];
    const seen = new Set();
    const push = (w) => {
      if (seen.has(w.id) || out.length >= 10) return;
      seen.add(w.id);
      out.push(w);
    };
    // 正在复习的三类先装满，剩下的位置才轮到没练过 / 已掌握
    ["wrong", "due", "learning", "fresh", "mastered"].forEach((k) =>
      shuffle(bucket[k]).forEach(push)
    );
    return out;
  }

  function startSpar() {
    const nick = ensureNick();
    if (!nick) return;
    stopTimers();

    const prof = sparProfile();
    const total = SPAR_SIZES[Math.floor(Math.random() * SPAR_SIZES.length)];
    const botCount = total - 1;
    const quiz = buildQuiz(reviewWords());
    const pid = "s" + rnd(6);
    const rels = shuffle(SPAR_SPREAD[botCount] || [1]);

    R = {
      mode: "spar",
      code: "",
      pid,
      nick,
      isHost: true,
      peer: null,
      conns: new Map(),
      players: new Map(),
      status: "playing",
      quiz,
      startedAt: Date.now(),
      race: null,
      applied: false,
      spar: Object.assign({}, prof, { total, bots: [] }),
    };
    addPlayer(pid, nick, meMeta());

    // 1–3 位陪练，名字不重复，速度各有 ±8% 的差异
    shuffle(SPAR_NAMES)
      .slice(0, botCount)
      .forEach((nm, i) => {
        const bpid = "b" + rnd(6);
        addPlayer(bpid, nm, { stars: 0, label: "陪练", icon: prof.icon });
        R.players.get(bpid).isBot = true;
        R.spar.bots.push({ pid: bpid, rel: rels[i] || 1, idx: 0, elapsed: 0, plan: [] });
      });

    beginRace(quiz, 3000);
    R.spar.bots.forEach((b) => planBot(b, prof));
  }

  /** 把一位陪练这一局的 10 次答题排成时间表，再按表推进 */
  function planBot(bot, prof) {
    if (!R || !R.spar) return;
    const base = prof.perQ * (bot.rel || 1); // 每题秒数基准（perQ 已经是「秒/题」）
    let cum = 0;
    let wrong = 0;
    for (let i = 0; i < 10; i++) {
      let dt = base * (0.7 + Math.random() * 0.6);
      if (Math.random() > prof.acc) {
        // 陪练也会点错：罚时 + 重新点的时间
        wrong++;
        dt += PENALTY_MS / 1000 + 0.3 + Math.random() * 0.9;
      }
      cum += dt;
      bot.plan.push({ ms: Math.round(cum * 1000), wrong });
    }
    runBot(bot);
  }

  function runBot(bot) {
    if (!R || !R.spar || !bot) return;
    const plan = bot.plan;
    if (bot.idx >= plan.length) return;
    const step = plan[bot.idx];
    const at = bot.idx;
    // 你已经答完并且等了一会儿，就让剩下的进度快点走完
    const delay = bot.accel ? 320 : Math.max(120, step.ms - bot.elapsed);
    const id = setTimeout(() => {
      if (!R || R.mode !== "spar" || !R.spar) return;
      const p = R.players.get(bot.pid);
      if (!p) return;
      bot.elapsed = step.ms;
      p.answered = at + 1;
      p.wrong = step.wrong;
      if (at === plan.length - 1) {
        p.finishMs = step.ms;
        if (allBotsDone()) watchIdleUser();
      }
      if (R.race && R.race.finished) renderWaiting();
      else renderTrack();
      maybeSettle();
      bot.idx = at + 1;
      runBot(bot);
    }, delay);
    T.spar.push(id);
  }

  function allBotsDone() {
    if (!R || !R.spar) return false;
    return R.spar.bots.every((b) => {
      const p = R.players.get(b.pid);
      return p && p.finishMs > 0;
    });
  }

  /** 陪练都答完、你还在磨：真的放弃（15 秒没动手）才按未完成结算，别硬截断 */
  function watchIdleUser() {
    if (!R || !R.spar || R.spar.watching) return;
    R.spar.watching = true;
    const id = setTimeout(() => {
      if (!R || R.mode !== "spar" || R.status !== "playing") return;
      const me = R.players.get(R.pid);
      if (me && me.finishMs > 0) return;
      const lastAct = (R.race && R.race.lastAct) || R.raceStartAt || R.startedAt;
      if (Date.now() - lastAct > 15000) {
        settleAsHost();
        return;
      }
      watchIdleUser();
    }, 2000);
    T.spar.push(id);
  }

  /** 你答完等太久了：把还在跑的陪练压缩到几秒内走完（记录用时仍按原计划，不改结果） */
  function accelerateBot() {
    if (!R || !R.spar || R.spar.accelerated) return;
    R.spar.accelerated = true;
    T.spar.forEach((id) => clearTimeout(id));
    T.spar = [];
    R.spar.bots.forEach((b) => {
      if (!b.accel) b.accel = true;
      const p = R.players.get(b.pid);
      if (p && !p.finishMs) runBot(b);
    });
  }

  /** 比赛页顶部的「智能陪练 · 常规 · 3 人」小标签 */
  function updateSparBadge() {
    const n = $("#raceMode");
    if (!n) return;
    if (!R || R.mode !== "spar" || !R.spar) {
      n.hidden = true;
      n.textContent = "";
      return;
    }
    const p = R.spar;
    n.hidden = false;
    n.textContent = `智能陪练 · ${p.label} · ${p.total} 人` + (p.comeback ? " · 回温局" : "");
    n.title = `${p.total - 1} 位离线 AI 对手 · 约 ${p.perQ.toFixed(1)} 秒/题`;
  }

  /* ---------------- 消息处理：房主端 ---------------- */
  function onHostMessage(conn, msg) {
    if (!R || !msg || !msg.t) return;
    if (msg.t === "hello") {
      const pid = String(msg.pid || "").slice(0, 16) || "g" + rnd(6);
      R.conns.set(pid, conn);
      addPlayer(pid, String(msg.nick || "玩家").slice(0, 10), msg.meta || {});
      conn.send({ t: "welcome", pid: R.pid, hostPid: R.pid, code: R.code, status: R.status, players: Array.from(R.players.values()) });
      broadcast(rosterPayload());
      renderRoom();
      return;
    }
    const pid = findPidByConn(conn);
    if (!pid) return;
    const p = R.players.get(pid);
    if (!p) return;

    if (msg.t === "progress") {
      p.answered = Math.max(p.answered, Math.min(10, Number(msg.answered) || 0));
      p.wrong = Math.max(p.wrong, Number(msg.wrong) || 0);
      broadcast(rosterPayload());
      renderTrack();
    } else if (msg.t === "finish") {
      if (!p.finishMs) p.finishMs = Math.max(1, Math.round(Number(msg.ms) || 0));
      p.answered = 10;
      p.wrong = Math.max(p.wrong, Number(msg.wrong) || 0);
      broadcast(rosterPayload());
      if (R.race && R.race.finished) renderWaiting();
      else renderTrack();
      maybeSettle();
    } else if (msg.t === "leave") {
      hostDropConn(conn, pid);
    }
  }

  function findPidByConn(conn) {
    for (const [pid, c] of R.conns.entries()) if (c === conn) return pid;
    return null;
  }

  function hostDropConn(conn, knownPid) {
    if (!R) return;
    const pid = knownPid || findPidByConn(conn);
    if (!pid) return;
    R.conns.delete(pid);
    R.players.delete(pid);
    if (R.isHost) {
      broadcast(rosterPayload());
      renderRoom();
      if (R.status === "playing") maybeSettle();
    }
  }

  function maybeSettle() {
    if (!R || !R.isHost || R.status !== "playing") return;
    const list = Array.from(R.players.values());
    if (!list.length) return;
    const allDone = list.every((p) => p.finishMs > 0);
    // 陪练局不按 45 秒硬截断：AI 的计划时间可能本来就长
    const timedOut = R.mode !== "spar" && Date.now() - R.startedAt > 45000;
    if (allDone || timedOut) settleAsHost();
  }

  function settleAsHost() {
    const list = Array.from(R.players.values()).slice().sort((a, b) => {
      const fa = a.finishMs || Infinity;
      const fb = b.finishMs || Infinity;
      if (fa !== fb) return fa - fb;
      return (b.answered || 0) - (a.answered || 0);
    });
    const total = list.length;
    const results = list.map((p, i) => ({
      pid: p.pid,
      nick: p.nick,
      place: i + 1,
      total,
      ms: p.finishMs || 0,
      wrong: p.wrong || 0,
    }));
    R.status = "done";
    R.results = results;
    broadcast({ t: "result", results });
    showResults(results);
  }

  /* ---------------- 消息处理：队友端 ---------------- */
  function onGuestMessage(msg) {
    if (!R || !msg || !msg.t) return;
    if (msg.t === "reject") {
      setMsg(msg.reason || "进不去这个房间");
      leaveToRank(true);
      return;
    }
    if (msg.t === "welcome") {
      R.hostPid = msg.hostPid;
      return;
    }
    if (msg.t === "roster") {
      if (msg.hostPid) R.hostPid = msg.hostPid;
      R.players = new Map(msg.players.map((p) => [p.pid, p]));
      if (msg.status === "waiting") {
        // 房主开了下一局：清掉上一局的本地状态，回到房间页
        const wasPlaying = R.status !== "waiting";
        R.status = "waiting";
        R.race = null;
        R.applied = false;
        stopTimers();
        if (wasPlaying) KW.show("room");
        renderRoom();
        return;
      }
      if (msg.status === "playing") {
        if (R.race && R.race.finished) renderWaiting();
        else renderTrack();
      }
      return;
    }
    if (msg.t === "start") {
      R.quiz = msg.quiz;
      R.status = "playing";
      R.startedAt = Date.now();
      R.applied = false;
      beginRace(msg.quiz, msg.inMs || 3000);
      return;
    }
    if (msg.t === "result") {
      R.status = "done";
      showResults(msg.results);
    }
  }

  /* ---------------- 竞速 ---------------- */
  function beginRace(quiz, inMs) {
    stopTimers();
    R.race = { quiz, i: 0, wrong: 0, finished: false, penaltyMs: 0, locked: false, lastAct: Date.now() };
    R.raceStartAt = 0;
    KW.show("race");
    updateSparBadge();
    $("#raceOptions").innerHTML = "";
    $("#raceWord").textContent = "准备…";
    $("#raceHint").textContent = RACE_HINT;
    $("#raceProgress").textContent = "0 / 10";
    $("#raceNote").textContent = "";
    updatePenalty();
    renderTrack();

    const dueAt = Date.now() + inMs;
    if (T.clock) clearInterval(T.clock);
    T.clock = setInterval(() => {
      if (!R || !R.race || R.race.finished) return;
      const left = dueAt - Date.now();
      if (left > 0) {
        $("#raceTimer").textContent = String(Math.ceil(left / 1000));
        $("#raceWord").textContent = "准备…";
        $("#raceNote").textContent = "3 秒后同时开始";
        return;
      }
      if (!R.raceStartAt) {
        R.raceStartAt = dueAt;
        $("#raceNote").textContent = "";
        renderQuestion();
        if (!T.race) T.race = setInterval(tickTimer, 100);
      }
    }, 100);
  }

  function tickTimer() {
    if (!R || !R.raceStartAt || !R.race || R.race.finished) return;
    $("#raceTimer").textContent = ((Date.now() - R.raceStartAt) / 1000).toFixed(1) + "s";
  }

  function renderTrack() {
    const box = $("#raceTrack");
    if (!R || !box) return;
    const list = Array.from(R.players.values());
    box.innerHTML = "";
    list.forEach((p) => {
      const row = el("div", "tr" + (p.pid === R.pid ? " is-me" : ""));
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
    const r = R.race;
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
    const r = R.race;
    if (!r || r.finished || r.locked) return;
    r.lastAct = Date.now();
    const q = r.quiz[r.i];
    if (text === q.answer) {
      btn.classList.add("is-right");
      Array.from($("#raceOptions").children).forEach((b) => (b.disabled = true));
      $("#raceCard").classList.add("is-known");
      r.i++;
      sendProgress();
      if (r.i >= 10) finishMine();
      else
        setTimeout(() => {
          if (R && R.race && !R.race.finished) renderQuestion();
        }, 180);
    } else {
      r.wrong++;
      r.penaltyMs += PENALTY_MS;
      r.locked = true;
      btn.classList.add("is-wrong");
      const opts = Array.from($("#raceOptions").children);
      opts.forEach((b) => (b.disabled = true));
      $("#raceCard").classList.add("is-miss");
      updatePenalty();
      sendProgress();
      setTimeout(() => {
        if (!R || !R.race || R.race.finished) return;
        $("#raceCard").classList.remove("is-miss");
        opts.forEach((b) => {
          b.disabled = false;
          b.classList.remove("is-wrong");
        });
        r.locked = false;
      }, LOCK_MS);
    }
  }

  function updatePenalty() {
    const r = R && R.race;
    const n = $("#racePenalty");
    if (!n) return;
    if (!r || r.wrong === 0) {
      n.hidden = true;
      return;
    }
    n.hidden = false;
    n.textContent = `错 ${r.wrong} 次 · 罚时 +${(r.penaltyMs / 1000).toFixed(1)}s`;
  }

  function sendProgress() {
    if (!R) return;
    const r = R.race;
    const me = R.players.get(R.pid);
    if (me) {
      me.answered = r.i;
      me.wrong = r.wrong;
    }
    if (R.isHost) {
      broadcast(rosterPayload());
      renderTrack();
    } else {
      const conn = R.conns.get("host");
      if (conn && conn.open) conn.send({ t: "progress", answered: r.i, wrong: r.wrong });
    }
  }

  function finishMine() {
    const r = R.race;
    r.finished = true;
    const pure = Math.max(1, Date.now() - R.raceStartAt);
    const ms = pure + r.penaltyMs;
    if (T.clock) clearInterval(T.clock), (T.clock = null);
    if (T.race) clearInterval(T.race), (T.race = null);
    $("#raceOptions").innerHTML = "";
    $("#raceWord").textContent = "完成！";
    $("#raceHint").textContent = "等其他人答完…";
    $("#raceNote").textContent =
      r.wrong > 0
        ? `净用时 ${(pure / 1000).toFixed(1)}s + 罚时 ${(r.penaltyMs / 1000).toFixed(1)}s`
        : `你的成绩 ${(pure / 1000).toFixed(1)}s`;

    const me = R.players.get(R.pid);
    if (me) {
      me.answered = 10;
      me.wrong = r.wrong;
      me.finishMs = ms;
    }

    if (R.isHost) {
      broadcast(rosterPayload());
      renderTrack();
      maybeSettle();
    } else {
      const conn = R.conns.get("host");
      if (conn && conn.open) conn.send({ t: "finish", ms, wrong: r.wrong });
      T.fallback = setTimeout(() => {
        if (R && !R.applied && R.status !== "done") {
          // 房主没回应，按自己看到的列表兜底排序
          $("#raceNote").textContent = "房主迟迟没结算，先按当前进度显示";
        }
      }, 30000);
    }
    if (R.mode === "spar") {
      const anyLeft = R.players && Array.from(R.players.values()).some((p) => p.isBot && !p.finishMs);
      if (anyLeft) T.spar.push(setTimeout(accelerateBot, 9000));
    }
    renderWaiting();
  }

  function renderWaiting() {
    if (!R) return;
    const rows = Array.from(R.players.values())
      .slice()
      .sort((a, b) => (a.finishMs || Infinity) - (b.finishMs || Infinity) || (b.answered || 0) - (a.answered || 0));
    const box = $("#raceTrack");
    box.innerHTML = "";
    const list = el("div", "wait-board");
    rows.forEach((p, i) => {
      const row = el("div", "wait-row" + (p.pid === R.pid ? " is-me" : ""));
      row.appendChild(el("span", "wait-place", "#" + (i + 1)));
      row.appendChild(el("span", "wait-nick", p.nick));
      row.appendChild(
        el("span", "wait-state", p.finishMs > 0 ? (p.finishMs / 1000).toFixed(1) + "s" : `答到 ${p.answered || 0}/10`)
      );
      list.appendChild(row);
    });
    box.appendChild(list);
  }

  /* ---------------- 结算 ---------------- */
  function showResults(results) {
    if (!R || R.applied) return;
    R.applied = true;
    stopTimers();

    const mine = results.find((x) => x.pid === R.pid);
    const place = mine ? mine.place : results.length;
    const total = mine ? mine.total : results.length;

    $("#bresultPlace").textContent = "#" + place;
    const pct = total > 1 ? ((total - place) / (total - 1)) * 100 : 100;
    $("#bresultRing").style.setProperty("--pct", Math.round(pct) + "%");

    if (!mine) {
      $("#bresultTitle").textContent = "这局没记到你的成绩";
      $("#bresultSub").textContent = "可能中途掉线了";
    } else {
      const res = RANK.apply(rankStore.get(), place, total);
      const next = Object.assign({}, res.rank, {
        history: (rankStore.get().history || []).concat([
          { at: Date.now(), place, total, ms: mine.ms, delta: res.delta, rank: res.to.label, stars: res.after, spar: R.mode === "spar" ? 1 : 0 },
        ]).slice(-20),
      });
      rankStore.set(next);
      renderRank();

      $("#bresultTitle").textContent =
        res.delta > 0 ? `第 ${place} 名！+${res.delta} 星` : res.delta < 0 ? `第 ${place} 名，${res.delta} 星` : "星星不变";
      $("#bresultSub").textContent =
        (mine.ms > 0 ? `用时 ${(mine.ms / 1000).toFixed(1)}s` : "未完成（超时）") +
        " · " +
        (R.mode === "spar" ? `${total} 人 · 智能陪练` : `${total} 人同场`) +
        ` · 本地段位 ${res.to.label}`;

      const wrap = $("#starChange");
      wrap.innerHTML = "";
      const delta = el("div", "delta " + (res.delta > 0 ? "up" : res.delta < 0 ? "down" : "flat"));
      delta.appendChild(
        el("b", null, res.delta > 0 ? `+${res.delta} ★` : res.delta < 0 ? `−${Math.abs(res.delta)} ★` : "±0 ★")
      );
      delta.appendChild(el("span", null, `${res.before} → ${res.after} 星`));
      wrap.appendChild(delta);

      const line = el("div", "rank-line-now");
      line.appendChild(el("span", "ri", res.to.icon));
      line.appendChild(el("b", null, res.to.label));
      line.appendChild(el("span", "muted", res.to.isKing ? res.to.starInSub + " 星" : `${res.to.starInSub}/${res.to.per} 星`));
      wrap.appendChild(line);

      if (res.promoted) {
        wrap.appendChild(el("p", "banner up", `晋级！${res.from.label} → ${res.to.label}`));
        KW.toast("晋级成功：" + res.to.label);
      } else if (res.demoted) wrap.appendChild(el("p", "banner down", `掉段了：${res.from.label} → ${res.to.label}`));
      else if (res.upSub) wrap.appendChild(el("p", "banner up", `小段提升：→ ${res.to.label}`));
      else if (res.downSub) wrap.appendChild(el("p", "banner down", `小段下滑：→ ${res.to.label}`));
      if (res.rank.streak >= 3) wrap.appendChild(el("p", "banner up", `🔥 ${res.rank.streak} 连胜`));
    }

    // 陪练局在结算里说清楚：对手是谁、什么难度、这局是不是回温局
    const sparNote = $("#bresultSpar");
    if (sparNote) {
      if (R.mode === "spar" && R.spar) {
        const opps = results.filter((x) => x.pid !== R.pid).map((x) => x.nick);
        const t = SPAR_TIERS[R.spar.tier];
        sparNote.hidden = false;
        sparNote.textContent =
          `对手：${opps.join("、") || "陪练"}（${total} 人局 · 离线 AI · ${t.label} · 约 ${R.spar.perQ.toFixed(1)} 秒/题）` +
          (R.spar.comeback ? ` · 回温局：连输 ${R.spar.lossStreak} 局后难度下调` : "");
      } else {
        sparNote.hidden = true;
        sparNote.textContent = "";
      }
    }

    const board = $("#bresultBoard");
    board.innerHTML = "";
    results.forEach((p, i) => {
      const row = el("div", "board-row" + (p.pid === R.pid ? " is-me" : ""));
      row.appendChild(el("span", "board-place", ["🥇", "🥈", "🥉"][i] || "#" + (i + 1)));
      row.appendChild(el("span", "board-nick", p.nick + (p.pid === R.pid ? "（你）" : "")));
      row.appendChild(
        el("span", "board-time", p.ms > 0 ? (p.ms / 1000).toFixed(1) + "s" + (p.wrong ? ` · 错 ${p.wrong}` : "") : "未完成")
      );
      if (i === 0) row.classList.add("is-win");
      board.appendChild(row);
    });

    KW.show("bresult");
  }

  /* ---------------- 再来一局 / 离开 ---------------- */
  function rematch() {
    if (!R) return leaveToRank();
    if (R.mode === "spar") return startSpar(); // 陪练局：直接再配一位（难度按新的连胜/连输重算）
    if (R.isHost) {
      R.status = "waiting";
      R.quiz = null;
      R.results = null;
      R.applied = false;
      R.race = null;
      R.players.forEach((p) => {
        p.answered = 0;
        p.wrong = 0;
        p.finishMs = 0;
      });
      broadcast(rosterPayload());
      stopTimers();
      KW.show("room");
      renderRoom();
    } else {
      KW.toast("等房主开下一局…");
      R.applied = false;
      R.race = null;
      R.status = "waiting";
      stopTimers();
      KW.show("room");
      renderRoom();
    }
  }

  function leaveToRank(silent) {
    if (R) {
      try {
        if (R.isHost) {
          if (R.peer) R.peer.destroy();
        } else {
          const conn = R.conns.get("host");
          if (conn && conn.open) conn.send({ t: "leave" });
          if (R.peer) R.peer.destroy();
        }
      } catch (e) {}
    }
    stopTimers();
    R = null;
    updateSparBadge();
    const u = new URL(location.href);
    u.searchParams.delete("room");
    history.replaceState(null, "", u.toString());
    renderRank();
    KW.show("rank");
    if (!silent) setMsg("");
  }

  /* ---------------- 绑定 ---------------- */
  function init() {
    $("#nickInput").value = idStore.get().nick || "";
    renderRank();

    $("#btnOpenBattle").onclick = () => {
      renderRank();
      KW.show("rank");
    };
    const backHome = () => {
      leaveToRank(true);
      KW.show("home");
      KW.refreshHome();
    };
    $("#btnRankBack").onclick = backHome;
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const v = ui().view;
      if (v === "race" && R && R.mode === "spar") {
        KW.toast("已退出陪练，本局不记输赢");
        leaveToRank();
        return;
      }
      if (v === "rank" || v === "bresult") backHome();
    });

    // 快速匹配：起一位离线陪练（先给个「正在匹配」的等待感，不联网）
    const sparBtn = $("#btnSpar");
    if (sparBtn) {
      sparBtn.onclick = () => {
        if (sparBtn.dataset.busy === "1") return;
        if (!ensureNick()) return;
        sparBtn.dataset.busy = "1";
        const label = sparBtn.textContent;
        sparBtn.textContent = "正在匹配陪练…";
        setTimeout(() => {
          sparBtn.textContent = label;
          sparBtn.dataset.busy = "";
          startSpar();
        }, 900);
      };
    }

    $("#btnCreateRoom").onclick = createRoom;
    $("#btnJoinRoom").onclick = () => joinRoom();
    $("#joinCode").addEventListener("keydown", (e) => {
      if (e.key === "Enter") joinRoom();
    });
    $("#nickInput").addEventListener("change", (e) => {
      idStore.set({ nick: e.target.value.trim().slice(0, 10) });
    });

    $("#btnStartBattle").onclick = startBattle;
    $("#btnLeaveRoom").onclick = () => leaveToRank();
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
    $("#btnBackRank").onclick = () => leaveToRank();

    $("#raceSpeak").onclick = () => {
      if (!R || !R.race) return;
      const q = R.race.quiz[R.race.i];
      if (!q) return;
      try {
        const u = new SpeechSynthesisUtterance(q.en.replace(/\(.*?\)/g, " ").replace(/,.*$/, "").trim());
        u.lang = "en-US";
        u.rate = 0.92;
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
      } catch (e) {}
    };

    // 对战里也用 W A S D
    document.addEventListener("keydown", (e) => {
      if (ui().view !== "race" || !R || !R.race || R.race.finished) return;
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

    // 邀请链接进入
    const code = new URLSearchParams(location.search).get("room");
    if (code) {
      const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      $("#joinCode").value = c;
      KW.show("rank");
      if (idStore.get().nick) joinRoom(c);
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