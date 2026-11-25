/* ===== 昆词 · 排位段位系统（晋升规则参考王者荣耀，段位名换成本命昆虫） ===== */
window.RANK = (() => {
  "use strict";

  // 每个大段位有 3 个小段（III → II → I），星满晋级；总星数用一条连续刻度表示
  const TIERS = [
    { name: "幼虫", icon: "🐛", per: 3, subs: 3, tip: "刚破卵壳，还在啃叶子" },
    { name: "若虫", icon: "🪱", per: 3, subs: 3, tip: "翅芽还没长出来" },
    { name: "蚂蚁", icon: "🐜", per: 3, subs: 3, tip: "开始成群结队干活了" },
    { name: "甲虫", icon: "🪲", per: 4, subs: 3, tip: "鞘翅硬了，撞得动门" },
    { name: "蝴蝶", icon: "🦋", per: 4, subs: 3, tip: "羽化完成，能飞了" },
    { name: "蜜蜂", icon: "🐝", per: 4, subs: 3, tip: "蜂群里的主力采集手" },
    { name: "蟋蟀", icon: "🦗", per: 5, subs: 3, tip: "斗性十足的老玩家" },
  ];
  const KING = { name: "虫王", icon: "👑", per: 0, subs: 1, tip: "整个目里的天花板" };

  const tierCap = (t) => t.per * t.subs;
  const TOTAL = TIERS.reduce((s, t) => s + tierCap(t), 0); // 78 星登顶

  const ROMAN = { 3: "III", 2: "II", 1: "I" };

  /** 星数 -> 段位信息 */
  function decode(stars) {
    let rest = Math.max(0, Math.floor(stars || 0));
    for (let i = 0; i < TIERS.length; i++) {
      const t = TIERS[i];
      const cap = tierCap(t);
      if (rest < cap) {
        const subIndex = Math.floor(rest / t.per); // 0 = 最低小段 III
        const starInSub = rest % t.per;
        return {
          tierIndex: i,
          name: t.name,
          icon: t.icon,
          tip: t.tip,
          sub: t.subs - subIndex,
          subLabel: ROMAN[t.subs - subIndex] || "",
          starInSub,
          per: t.per,
          isKing: false,
          starsToNext: t.per - starInSub,
          label: `${t.name} ${ROMAN[t.subs - subIndex] || ""}`.trim(),
        };
      }
      rest -= cap;
    }
    return {
      tierIndex: TIERS.length,
      name: KING.name,
      icon: KING.icon,
      tip: KING.tip,
      sub: 0,
      subLabel: "",
      starInSub: rest,
      per: 0,
      isKing: true,
      starsToNext: 0,
      label: KING.name,
    };
  }

  /** 成绩 -> 加减星与升降段 */
  function apply(rank, place, playerCount) {
    const before = Math.max(0, Math.floor(rank.stars || 0));
    let delta = 0;
    if (playerCount >= 2) {
      if (place === 1) delta = 1;
      else if (place === playerCount) delta = -1;
    }
    const after = Math.max(0, before + delta);
    const oldD = decode(before);
    const newD = decode(after);

    const next = {
      stars: after,
      games: (rank.games || 0) + 1,
      wins: (rank.wins || 0) + (place === 1 && playerCount >= 2 ? 1 : 0),
      losses: (rank.losses || 0) + (playerCount >= 2 && place === playerCount ? 1 : 0),
      streak: place === 1 && playerCount >= 2 ? (rank.streak || 0) + 1 : 0,
      best: Math.max(rank.best || 0, place === 1 && playerCount >= 2 ? (rank.streak || 0) + 1 : 0),
    };

    return {
      rank: next,
      delta,
      before,
      after,
      from: oldD,
      to: newD,
      promoted: newD.tierIndex > oldD.tierIndex,
      demoted: newD.tierIndex < oldD.tierIndex,
      // 小段是 III → II → I 递增，所以“升”意味着 sub 变小
      upSub: newD.sub < oldD.sub && newD.tierIndex === oldD.tierIndex,
      downSub: newD.sub > oldD.sub && newD.tierIndex === oldD.tierIndex,
    };
  }

  const tierName = (i) => (TIERS[i] ? TIERS[i].name : KING.name);
  const tierIcon = (i) => (TIERS[i] ? TIERS[i].icon : KING.icon);

  /** 段位阶梯，用于首页展示 */
  function ladder() {
    return TIERS.map((t) => ({ name: t.name, icon: t.icon, per: t.per, subs: t.subs, tip: t.tip }));
  }

  return { TIERS, KING, TOTAL, decode, apply, tierName, tierIcon, ladder, ROMAN };
})();
