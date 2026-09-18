'use strict';
/* hook-trace.js —— hook 痕迹的**唯一**实现（`hook-session-start.js` 与 `hook-post-edit.js` 共用）。
 *
 * 为什么单独一个文件：**复制两份就会静默分叉**（与 `.check/fileset.js` 同一条理由）。
 *
 * ─────────────────────────────────────────────────────────────
 * 第一版：只写 `pid=… invoked`。
 *   → 「我手喂 stdin 测出来的」和「宿主真的调了我」在日志上长得一模一样。
 * 第二版：加 `src=host|manual`（判 payload 里有没有会话身份）。
 *   → **我把自己的判据证伪了。** 手工伪造一个带 `session_id`/`cwd` 的 payload，
 *     `classify()` 照样返回 `host`。见下。
 * 第三版（本版）：加 `probe=` 与 payload 指纹。
 *
 * ─────────────────────────────────────────────────────────────
 * 【2026-09-15 第三次修订 · 一条我自己种下的假绿】
 *
 * 第二版写下「唯一判据是 `src=host`」之后，我**亲手**在 `.check/hook.log` 里
 * 留下了 4 行 `src=host` —— 它们是测试伪造的，不是宿主调用的：
 *
 *   · `session-start payload=67B` —— 67 恰好等于
 *     `{"hook_event_name":"SessionStart","source":"startup","cwd":"C:/x"}` 的字节数。
 *     真实宿主 payload 光 `cwd` 就有 50 字符，还要带 `session_id` 与 `transcript_path`，
 *     不可能只有 67 字节。
 *   · `watched: refs/A-sources.md` —— **相对路径**。宿主下发的 `tool_input.file_path`
 *     永远是绝对路径。
 *
 * 于是「看 `src=host`」这条判据一旦落到未来某个会话手里，会**在 4 行伪造记录上签字**。
 * 一个我自己就能生产出来的证据，不是证据。
 *
 * 修法（本版）：
 *   ① `probe=` —— 测试必须显式设 `HOOK_PROBE=1`；宿主不会设。**缺这个字段的行一律不算数。**
 *   ② payload 指纹（`pl=` 字节数 / `abs=` 是否绝对路径 / `sid=` 会话 id 长度）——
 *      伪造的 payload 在这三项上会露出破绽。
 *   ③ `HOOK_TRACE_LOG` —— 测试可以改写到别的文件，**不污染真日志**。
 *   ④ 已有的 4 行伪造记录**改名存档**（`hook.log.forged-2026-09-15`），
 *      不删（是证据），但也不再能被读成实时证据。
 *
 * ─────────────────────────────────────────────────────────────
 * 【但以上都还是「hook 自述」。真正的判据在宿主那一侧。】
 *
 * 2026-09-15 实测（宿主自己的日志，不是 hook 写的）：
 *   · 宿主 `[HookExecutor] spawn` 共 **226 次**，**0 次**的 cmd 含 `.check/`。
 *   · `[HookManager] event=SessionStart` 触发 17 次，每次匹配到的都只有
 *     `tencent-docx` / `agent-browser` 两个插件 hook。
 *   · `event=PostToolUse` 出现 **0 次**。
 *   · 两次宿主进程启动（12:09:47 / 12:36:08）都在本配置写盘**之后**，都没加载它。
 *
 * 原因（官方文档 `cli/hooks.md` 第 17 行原文）：
 *   「支持 CLI `/hooks` 面板进行图形化配置，**所有外部修改需在面板审核后生效**。」
 *   手改 `settings.json` 不会生效 —— 这是一道**人工审批闸门**，设计如此，不是缺陷。
 *
 * ⇒ 所以本文件能做的只有一件事：**把「hook 到底被谁调用过」这件事记清楚**。
 *   判定 hook 是否生效，必须去读宿主的日志（`acceptance.js` 的 [99] 就是这么做的）。
 */

const fs = require('fs');
const path = require('path');

/* 默认写 `.check/hook.log`；测试用 `HOOK_TRACE_LOG` 指到别处，**不污染真日志**。 */
const LOG = process.env.HOOK_TRACE_LOG
  ? path.resolve(process.env.HOOK_TRACE_LOG)
  : path.join(path.resolve(__dirname, '..'), '.check', 'hook.log');

/* 测试必须显式设 `HOOK_PROBE=1`。宿主不会设。**缺 probe= 字段的行一律不算数。** */
function isProbe() {
  return process.env.HOOK_PROBE === '1';
}

function classify(payload) {
  return /"(session_id|transcript_path|cwd)"\s*:/.test(String(payload)) ? 'host' : 'manual';
}

/* payload 指纹：伪造的 payload 在这三项上会露出破绽。 */
function fingerprint(payload) {
  const s = String(payload);
  const bytes = Buffer.byteLength(s, 'utf8');
  const abs = /"file_path"\s*:\s*"([A-Za-z]:[\\/]|\/)/.test(s) ? 1 : 0;
  const m = s.match(/"session_id"\s*:\s*"([^"]*)"/);
  return 'pl=' + bytes + 'B abs=' + abs + ' sid=' + (m ? m[1].length : 0);
}

function trace(src, msg, payload) {
  const line =
    new Date().toISOString() +
    ' pid=' + process.pid +
    ' src=' + src +
    ' probe=' + (isProbe() ? 1 : 0) +
    (payload === undefined ? '' : ' ' + fingerprint(payload)) +
    ' ' + msg + '\n';
  try {
    fs.appendFileSync(LOG, line);
  } catch (e) { /* 日志写不进去不许影响主流程 */ }
}

function readStdin() {
  let p = '';
  try { p = fs.readFileSync(0, 'utf8'); } catch (e) { p = ''; }
  return p;
}

module.exports = { trace, classify, fingerprint, isProbe, readStdin, LOG };
