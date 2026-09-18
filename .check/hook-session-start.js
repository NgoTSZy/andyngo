#!/usr/bin/env node
'use strict';
/* hook-session-start.js —— SessionStart 探针。
 *
 * 为什么要单独一个：PostToolUse 探针要「先编辑一个被监视的文件」才能测，
 * 而且一旦 `matcher` 与运行环境的 `tool_name` 对不上，它**永远不会响** ——
 * 而「永远不响」和「根本没有 hook」在账面上长得一模一样。
 *
 * `SessionStart` 在任何工具调用**之前**就触发，且不依赖 `tool_name` 匹配。
 * **它是「hook 到底能不能工作」这个问题的最短路径。**
 *
 * ─────────────────────────────────────────────────────────────
 * 【2026-09-16 第四版 · 使命已完成，本文件**不再要求被加载**（DEC-041）】
 *
 * **结论：它从未被宿主加载过 —— 而且不再需要被加载。**
 *  它自述的用途是「验证 hook 到底能不能工作」。那个问题**已经由 `immunity-hook.js` 回答**：
 *  宿主侧实测 **1152** 次真 spawn，全部指向 `.check/`。
 *  所以不再改配置去激活它 —— 三条候选（删掉 / 补说明 / 激活）取第二条，理由见 DEC-041。
 *
 * **它为什么没被加载（2026-09-16 换过一次根因）**：
 *  · 注册它的**不是宿主读的那份配置**。`~/.codebuddy/settings.json`（2026-09-15 14:03）
 *    里**确实**有 `SessionStart` → 本文件；但宿主读的是 `~/.workbuddy-ai/settings.json`，
 *    那一份里**只有** `PostToolUse → immunity-hook.js`，**没有 SessionStart**。
 *  · **反证**（推翻旧根因②）：若「手改 settings.json 不生效 / 有人工审批闸门」成立，
 *    `immunity-hook.js` 不可能从 0 涨到 1152 —— 它正是手改进**宿主读的那份**配置里的。
 *    → 「所有外部修改需在 `/hooks` 面板审核后生效」**不再作为根因**，不要再照它行动。
 *
 * **2026-09-16 实测（宿主侧口径）**：排除各日期目录下的 `sdk/conversations/`（那里记的是
 *  对话全文，会把统计污染成噪声）后扫 410 个日志文件：
 *  · `[HookExecutor] spawn` **1637** 行；
 *  · 含 `.check/` **1195** 行 = **1152** 真 spawn（全部 `immunity-hook.js`）
 *    + **40** 我自己 grep 这些日志的命令行被记下来 + **3** 我写的测试夹具文本
 *    → **真 spawn 只有 `immunity-hook.js` 一个**；
 *  · 含 `hook-session-start` **0** 行 → 本文件从未被加载（本议题的核心事实，成立）；
 *  · `[HookManager] event=SessionStart` **139** 行（事件在发，只是没派给本文件）；
 *    `event=PostToolUse` **0** 行。
 *
 * ★ **判据视野缺口**（**已另立 ISS-114，不在本文件修**）：`acceptance.js` 第 [99] 项数的是
 *  「spawn 行里含 `.check/` 的总数」，**不区分是哪个 hook** → 它**看不见**「某一个登记在册的
 *  hook 没被加载」。一个 hook 在跑，它就绿。且它的 1195 里含上面那 **43** 行自指噪声。
 *
 * ═══ 【留证，不要再当成现状】以下为第二版（2026-09-15）原文，数字**全部过期、不要引用** ═══
 * 第一版结论：「配置写进 settings.json 了」→ 误读成「hook 生效了」。
 *  证伪：那 5 行日志的 payload 恰好等于手喂 JSON 的字节数；真实 Write 之后日志纹丝不动。
 *
 * 第二版结论：「配置对了，只是配置改动需新会话生效，**等下一个新会话看 `src=host`**」。
 *  **这条也是错的。** 两个理由，都是实测：
 *
 *  ① 判据本身是假的：我**亲手**伪造出 4 行 `src=host`
 *     （`payload=67B` 恰好等于只带 `cwd` 的最小 payload；`watched: refs/A-sources.md` 是相对路径，
 *     而宿主下发的 `file_path` 永远是绝对路径）。**一个我自己就能生产出来的证据，不是证据。**
 *     第三版为此加了 `probe=` 与 payload 指纹（见 `hook-trace.js`）。
 *     ← **这一段仍然有效，不要删** —— 它是 `hook-trace.js` 里 `probe=`/指纹判据的存在理由。
 *
 *  ② 更根本的：宿主**从来没加载过**这份配置。读宿主自己的日志（`~/.workbuddy-ai/logs/`）：
 *     · `[HookExecutor] spawn` 共 **226 次**，**0 次**的 cmd 含 `.check/`；   ← 已过期（现为 1637 / 1195）
 *     · `[HookManager] event=SessionStart` 17 次，每次都只匹配到 tencent-docx / agent-browser
 *       两个**插件** hook；`event=PostToolUse` **0 次**；                      ← 已过期（现为 139 / 0）
 *     · 两次宿主进程启动（12:09:47、12:36:08）都在本配置写盘**之后**，都没加载它。
 *     → 「等新会话」等不到任何东西。
 *
 *  原因（官方文档 `cli/hooks.md` 第 17 行原文）：
 *    「支持 CLI `/hooks` 面板进行图形化配置，**所有外部修改需在面板审核后生效**。」
 *    手改 `settings.json` 不会生效 —— 这是一道**人工审批闸门**，设计如此。
 *    ← **2026-09-16 推翻**（反证见本段开头）。留证，不要再照它行动。
 *
 * ⇒ 第二版的表述（**已被第四版取代**）：「脚本可手动跑通」+「宿主从未加载它」。
 *   依赖 hook 的规则**当前只是提示词，不是约束**。
 *   ← **后半句已失效**：`immunity-hook.js` 实测 1152 次真 spawn —— **钩子在跑是真的**。
 *   唯一判据仍在宿主那一侧：`[HookExecutor] spawn` 里出现 `.check/`
 *   （`.check/acceptance.js` 的第 [99] 项就是去读宿主日志，而不是读 hook 自己的自述）。
 *   ← 这两行仍然有效，保留。
 */
const fs = require('fs');
const path = require('path');
const { trace, classify, readStdin } = require('./hook-trace.js');

const HOME_AI = path.resolve(__dirname, '..');
const VERIFIED = path.join(HOME_AI, '.check', 'hook-verified');

/* 读掉 stdin（hook 协议会往里写 JSON）。不读的话父进程可能拿到 EPIPE。
 * **必须在 trace 之前读** —— 来源标记（host / manual）与 payload 指纹只能从 payload 判。 */
const payload = readStdin();
const src = classify(payload);
trace(src, 'session-start', payload);

/* 探针只在**未确认**时注入一行。
 * 确认之后（创建空文件 `.check/hook-verified`）就只写日志、不再占用常驻上下文 ——
 * 一个永远在提示的探针，和一条永远在响的警报一样，会被忽略。 */
if (!fs.existsSync(VERIFIED)) {
  process.stdout.write(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext:
        'hook 探针：SessionStart 触发了。**但别急着下结论 —— 这一行本身说明不了 hook 生效。**\n' +
        '· 判据不在 hook 自己的日志里，在**宿主**的日志里：\n' +
        '  `grep -h "\\[HookExecutor\\] spawn" ~/.workbuddy-ai/logs/*/*.log | grep -c "\\.check/"`\n' +
        '  返回 ≥1 → 宿主真的加载并调用了某个 `.check/` hook。返回 0 → 一个都没加载。\n' +
        '  **注意：这一条不区分是哪个 hook**（ISS-114）—— ≥1 不代表**本** hook 被加载。\n' +
        '· `.check/hook.log` 里的 `src=host` **不算证据** —— 2026-09-15 亲手伪造过 4 行。\n' +
        '  只看 `probe=0` 且指纹自洽（`abs=1`、`pl` 不是最小 payload 长度）的行。\n' +
        '· 若**本** hook 没被加载：先看注册它的配置文件是不是**宿主读的那一份** ——\n' +
        '  宿主读 `~/.workbuddy-ai/settings.json`；写在 `~/.codebuddy/settings.json` 里的不会被加载。\n' +
        '跑 `.check/acceptance.js` 看第 [99] 项；确认后创建空文件 `.check/hook-verified` 让本提示停止。',
    },
  }));
}
process.exit(0);
