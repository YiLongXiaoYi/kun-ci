/* ===== 昆词 · 新手教程 ===== */
(function () {
  "use strict";

  const STEPS = [
    {
      id: "start",
      nav: "① 30 秒上手",
      title: "30 秒上手",
      html: `
        <p class="tut-lead">一句话：<b>看英文，选「认识」或「不认识」</b>。不认识的会自动进错词本，下次优先考你。</p>
        <ol class="tut-list">
          <li>首页点<b>「开始学习」</b>（右上角会显示今日已练和连续打卡）。</li>
          <li>卡片正面是英文，先自己想中文。</li>
          <li>点<b>「认识」</b>或<b>「不认识」</b>，答案立刻出现，还有词根和同族词。</li>
          <li>答完自动跳到下一词（按钮上有 2.5 秒倒计时，按空格可以立刻跳）。</li>
          <li>一轮 20 个词结束后看成绩，错词自动进<b>错词本</b>。</li>
        </ol>
        <div class="tut-tip">
          <b>连对 6 次才算「掌握」</b>：每个词有 0–6 级连对阶段，答对升级、答错降级，
          间隔从 5 分钟拉长到 7 天。所以同一个词会被你在不同日子反复见到，直到真的记住。
        </div>
        <div class="tut-keys">
          <span class="tut-k"><kbd>空格</kbd> 认识 / 下一张</span>
          <span class="tut-k"><kbd>1</kbd> 不认识</span>
          <span class="tut-k"><kbd>Esc</kbd> 退出本轮</span>
        </div>`,
    },
    {
      id: "desktop",
      nav: "② 电脑端",
      title: "电脑端：键盘位按物理位置摆",
      html: `
        <p class="tut-lead">四选一模式下，四个选项按键盘的<b>物理位置</b>摆放，眼睛不用离开屏幕就能按。</p>
        <div class="tut-board">
          <div class="tk-row"><span class="tk act q">Q<em>认识</em></span><span class="tk opt w">W</span><span class="tk act e">E<em>不认识</em></span></div>
          <div class="tk-row"><span class="tk opt a">A</span><span class="tk opt s">S</span><span class="tk opt d">D</span></div>
        </div>
        <p class="tut-note">Q 和 E 不是选项，是<b>自评键</b>：不想答题也可以直接判定。</p>
        <table class="tut-table">
          <tr><th>按键</th><th>作用</th><th>在哪个模式</th></tr>
          <tr><td><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></td><td>选四个选项</td><td>四选一 / 对战抢答</td></tr>
          <tr><td><kbd>Q</kbd></td><td>直接算「认识」，跳过这题</td><td>四选一</td></tr>
          <tr><td><kbd>E</kbd></td><td>直接算「不认识」；<b>答完还能按 E 改判</b>（把蒙对的改成不认识）</td><td>四选一</td></tr>
          <tr><td><kbd>空格</kbd></td><td>认识；已经答过就是「下一张」</td><td>卡片 / 四选一</td></tr>
          <tr><td><kbd>1</kbd> 或 <kbd>←</kbd></td><td>不认识</td><td>卡片</td></tr>
          <tr><td><kbd>2</kbd> 或 <kbd>→</kbd></td><td>认识</td><td>卡片</td></tr>
          <tr><td><kbd>Backspace</kbd></td><td>回看上一题（选项、你选了什么、正确答案）</td><td>全部模式</td></tr>
          <tr><td><kbd>Esc</kbd></td><td>退出本轮 / 关闭弹窗 / 从回看返回</td><td>全部模式</td></tr>
        </table>
        <div class="tut-tip">拼写模式下先打字，<kbd>Enter</kbd> 提交；这时 Q/E 会被当成字母输进去，不会触发快捷键。</div>`,
    },
    {
      id: "mobile",
      nav: "③ 手机端",
      title: "手机端：竖排，直接点",
      html: `
        <p class="tut-lead">窄屏（≤640px）会自动改成竖排，<b>不需要键盘</b>，手指点就行。</p>
        <ul class="tut-list">
          <li>四选一时顺序是 <b>W → A → S → D</b> 四个选项在前，<b>Q 认识 / E 不认识</b>两个自评键排在最后。</li>
          <li>卡片模式底部就是大大的「不认识 / 认识」两个按钮。</li>
          <li>「下一张」在卡片下面，答完 2.5 秒也会自动跳，等不及可以直接点。</li>
          <li>左上角 <b>✕</b> 退出本轮；<b>↶</b> 回看上一题。</li>
          <li>右上角三个按钮：<b>?</b> 教程、<b>☀/🌙</b> 切深浅色、<b>⚙</b> 设置。</li>
        </ul>
        <div class="tut-tip">
          想更像 App：浏览器菜单里选「<b>添加到主屏幕</b>」（Safari：分享 → 添加到主屏幕；Chrome：⋮ → 添加到主屏幕），
          之后就能全屏打开。注意这是快捷方式，<b>首次打开仍需联网</b>。
        </div>
        <p class="tut-note">手机上背单词建议先关掉「答完自动下一张」，不然看完词根来不及。</p>`,
    },
    {
      id: "settings",
      nav: "④ 设置能调什么",
      title: "设置里能调什么",
      html: `
        <p class="tut-lead">右上角 <b>⚙</b> 打开设置，六项都能即时生效、自动记住。</p>
        <table class="tut-table">
          <tr><th>设置项</th><th>选项</th><th>说明</th></tr>
          <tr>
            <td>每轮题量</td>
            <td>10 / 20 / 30 / 全部</td>
            <td>一轮练多少个词。赶时间选 10，系统复习选全部。</td>
          </tr>
          <tr>
            <td>答题方式</td>
            <td>自评卡片 / 四选一考核 / 中译英拼写</td>
            <td>卡片=自评；四选一=看英文选中文，自动判分；拼写=看中文写英文。</td>
          </tr>
          <tr>
            <td>配色</td>
            <td>跟随系统 / 深夜 / 白昼 / 浅蓝 / 浅粉 / 薄荷 / 米黄</td>
            <td>全部按 WCAG AA 对比度校准过，字都能看清。</td>
          </tr>
          <tr>
            <td>联想记忆</td>
            <td>开 / 关</td>
            <td>答完是否显示「词根 + 同族词」。嫌啰嗦可以关。</td>
          </tr>
          <tr>
            <td>自动下一张</td>
            <td>开 / 关</td>
            <td>答完 2.5 秒自动跳。关掉就自己按空格。</td>
          </tr>
          <tr>
            <td>数据</td>
            <td>导出备份 / 导入备份 / 清空进度</td>
            <td>进度存在这台设备的浏览器里，换设备用导出的 JSON 迁移。</td>
          </tr>
        </table>
        <p class="tut-note">首页还有两个开关：<b>只练没见过的词</b>、<b>打乱顺序</b>；以及范围筛选（全部 / 五个分类 / 错词本）。</p>`,
    },
    {
      id: "more",
      nav: "⑤ 进阶玩法",
      title: "进阶玩法",
      html: `
        <div class="tut-block">
          <h4>联想记忆</h4>
          <p>答完题，答案下面会给出<b>词根钩子</b>和<b>同族词对照</b>。比如 <code>mandible</code> 上颚
          会告诉你 <code>mand-</code> 是「嚼」，并列出上唇 / 上颚 / 下颚 / 下唇 / 舌五件套，当前词高亮。</p>
        </div>
        <div class="tut-block">
          <h4>词库 / 查词</h4>
          <p>首页「查词 / 词库 →」：257 个词可按分类和状态筛选，<b>中英文都能搜</b>。
          点开任一词能看到词根、同族词、练过几次、下次复习时间，还能直接朗读或标记掌握。</p>
        </div>
        <div class="tut-block">
          <h4>错词本</h4>
          <p>点「不认识」就会进错词本，可按错误次数 / 到期时间排序，也能手动「标记掌握」或「移出」。
          连对 6 次会自动移出。</p>
        </div>
        <div class="tut-block">
          <h4>排位对战（真人）</h4>
          <p>首页「排位对战」→ 填虫名 → <b>创建房间</b> → 把邀请链接或 6 位房间码发给同学 → 对方打开就进房 →
          房主点「开始对战」。同一套 10 题、3 秒倒计时、<b>谁先答完谁拿星</b>，选错 +2.5 秒罚时。</p>
          <p class="tut-note">段位：幼虫 → 若虫 → 蚂蚁 → 甲虫 → 蝴蝶 → 蜜蜂 → 蟋蟀 → 虫王，每个大段 3 个小段，共 78 星登顶。
          两人浏览器直接连，数据不经过服务器。</p>
        </div>`,
    },
  ];

  let cur = 0;

  function renderNav() {
    const nav = document.querySelector("#tutNav");
    nav.innerHTML = "";
    STEPS.forEach((s, i) => {
      const b = document.createElement("button");
      b.className = "tut-nav-item" + (i === cur ? " is-on" : "");
      b.textContent = s.nav;
      b.onclick = () => {
        cur = i;
        render();
      };
      nav.appendChild(b);
    });
  }

  function renderPanel() {
    const s = STEPS[cur];
    const box = document.querySelector("#tutPanels");
    box.innerHTML = `
      <h3 class="tut-title">${s.title}</h3>
      <div class="tut-content">${s.html}</div>`;
    box.scrollTop = 0;
    const step = document.querySelector("#tutStep");
    if (step) step.textContent = cur + 1 + " / " + STEPS.length;
    const prev = document.querySelector("#btnTutPrev");
    const next = document.querySelector("#btnTutNext");
    if (prev) prev.disabled = cur === 0;
    if (next) next.textContent = cur === STEPS.length - 1 ? "开始背单词" : "下一步 →";
  }

  function render() {
    renderNav();
    renderPanel();
  }

  function open() {
    const box = document.querySelector("#tutorial");
    if (!box) return;
    box.hidden = false;
    render();
    document.body.style.overflow = "hidden";
  }

  function close() {
    const box = document.querySelector("#tutorial");
    if (!box) return;
    box.hidden = true;
    document.body.style.overflow = "";
  }

  function init() {
    const btn = document.querySelector("#btnTut");
    if (btn) btn.onclick = open;

    const box = document.querySelector("#tutorial");
    if (!box) return;

    document.querySelector("#btnCloseTut").onclick = close;
    box.addEventListener("click", (e) => {
      if (e.target === box) close();
    });

    document.querySelector("#btnTutPrev").onclick = () => {
      if (cur > 0) {
        cur--;
        render();
      }
    };
    document.querySelector("#btnTutNext").onclick = () => {
      if (cur < STEPS.length - 1) {
        cur++;
        render();
      } else {
        close();
        const start = document.querySelector("#btnStart");
        if (start && !start.disabled) start.click();
      }
    };

    document.addEventListener("keydown", (e) => {
      if (box.hidden) return;
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (cur < STEPS.length - 1) {
          cur++;
          render();
        }
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (cur > 0) {
          cur--;
          render();
        }
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();