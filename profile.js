/* ===== 昆词 · 云端存档（段位 / 战绩跨设备同步） ===== */
window.KP = (function () {
  "use strict";

  const K_ID = "kunword.identity"; // { uid, token, nick }
  const K_CACHE = "kunword.profile.cache"; // 最近一次云端存档，用于瞬间渲染

  const state = { me: null, syncing: false, lastError: "", loaded: false };
  const listeners = [];

  const read = (k, fb) => {
    try {
      return Object.assign(fb, JSON.parse(localStorage.getItem(k) || "{}"));
    } catch (e) {
      return fb;
    }
  };

  const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const rnd = (n, abc = ALPHA) => {
    const b = new Uint8Array(n);
    (crypto || window.crypto).getRandomValues(b);
    return Array.from(b, (x) => abc[x % abc.length]).join("");
  };

  const HEX = "0123456789abcdef";
  const token32 = () => rnd(32, HEX);

  function identity() {
    const id = read(K_ID, { uid: "", token: "", nick: "" });
    if (!id.uid || !id.token) {
      id.uid = rnd(12);
      id.token = token32();
      id.nick = id.nick || "";
      localStorage.setItem(K_ID, JSON.stringify(id));
    }
    return id;
  }

  function setIdentity(patch) {
    const id = Object.assign(identity(), patch);
    localStorage.setItem(K_ID, JSON.stringify(id));
    return id;
  }

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
    return { status: res.status, data: data || {} };
  }

  function cache(p) {
    try {
      localStorage.setItem(K_CACHE, JSON.stringify(p));
    } catch (e) {}
  }

  function cached() {
    const c = read(K_CACHE, {});
    return c && c.uid ? c : null;
  }

  function emit() {
    listeners.forEach((fn) => {
      try {
        fn(state.me);
      } catch (e) {}
    });
  }

  /** 注册 / 同步：拿回服务器上的段位与战绩 */
  async function refresh() {
    if (state.syncing) return state.me;
    state.syncing = true;
    state.lastError = "";
    try {
      const id = identity();
      const { status, data } = await api("register", { uid: id.uid, token: id.token, nick: id.nick });
      if (data.ok && data.profile) {
        state.me = data.profile;
        state.loaded = true;
        cache(data.profile);
        // 只在本地没名字时才采用云端的名字，避免凭空覆盖用户输入
        if (data.profile.nick && !id.nick) setIdentity({ nick: data.profile.nick });
      } else {
        state.loaded = true;
        state.lastError = data.error || "同步失败（" + status + "）";
      }
    } catch (e) {
      state.lastError = e.message || "网络不通";
      if (!state.me) state.me = cached();
    } finally {
      state.syncing = false;
      emit();
    }
    return state.me;
  }

  function current() {
    return state.me || cached();
  }

  async function rename(nick) {
    const id = identity();
    const clean = String(nick || "").trim().slice(0, 10);
    if (!clean) return { ok: false, error: "昵称不能为空" };
    setIdentity({ nick: clean });
    const { data } = await api("rename", { uid: id.uid, token: id.token, nick: clean });
    if (data.ok && data.profile) {
      state.me = data.profile;
      cache(data.profile);
      emit();
    }
    return data;
  }

  /** 旧设备：生成一次性换机码 */
  async function makeHandoff() {
    const id = identity();
    const { data } = await api("handoff", { uid: id.uid, token: id.token });
    return data;
  }

  /** 新设备：用换机码接管存档 */
  async function redeem(code) {
    const { data } = await api("redeem", { code });
    if (!data.ok) return data;
    setIdentity({ uid: data.uid, token: data.token, nick: data.profile ? data.profile.nick : "" });
    state.me = data.profile;
    state.loaded = true;
    if (data.profile) cache(data.profile);
    emit();
    return data;
  }

  function on(fn) {
    listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  function nickname() {
    const id = read(K_ID, {});
    const me = current();
    return (me && me.nick) || id.nick || "";
  }

  return {
    identity,
    setIdentity,
    refresh,
    current,
    rename,
    makeHandoff,
    redeem,
    on,
    nickname,
    setLocalNick: (n) => setIdentity({ nick: String(n || "").trim().slice(0, 10) }),
    get error() {
      return state.lastError;
    },
    get loaded() {
      return state.loaded;
    },
    status: () => state,
  };
})();