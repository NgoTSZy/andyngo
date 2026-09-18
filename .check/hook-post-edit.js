#!/usr/bin/env node
'use strict';
/* hook-post-edit.js —— PostToolUse hook：改到协议文件就自动跑一次协议校验
 *
 * 存在的理由（一句话）：**「提示词是建议，不是约束」——一条规则有没有被执行，
 * 标准只有一个：代码里有没有东西会在违反时做出反应。**
 * 在这个 hook 之前，约束模式的所有规则都只写在文档里，没有任何执行者。
 *
 * 契约（照 docs/cn/cli/hooks.md）：
 *   输入：stdin 的 JSON，含 hook_event_name / tool_name / tool_input.file_path
 *   输出：有问题 → { hookSpecificOutput: { hookEventName, additionalContext } }（**追加**给 agent）
 *         没问题 → 静默，什么都不输出
 *
 * **永不阻断**：PostToolUse 在工具执行完之后才触发，本来就无法阻断已完成的调用。
 * 所以本脚本**始终 exit 0**。唯一例外是它自己崩了 —— 那时也 exit 0，
 * 但**必须打一行可解析的结果**（「没有」在账面上会被读成「没有失败」）。
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const HOME_AI = path.resolve(__dirname, '..');

// 只对「协议文件」反应。别的文件一律静默放行 ——
// 一个对每次 Edit 都跑的 hook，是纯延迟，不是防护。
const WATCH_FILES = ['MODE.md', 'MEMORY.md', 'SOUL.md'];
const WATCH_PATTERNS = [
  /^agents\/[\w.-]+\.md$/,
  /^skills\/[\w.-]+\/SKILL\.md$/,
  /^\.check\/[\w.-]+\.js$/,
  /* 【2026-09-15 期 1 加】附录 A–E 拆到 `refs/` 之后，改它们**不再被监视** ——
   * 而它们和 MODE.md 是同一份协议的两半。拆文件时漏改这里，
   * 等于「协议的一半改了不会触发校验」，而且**不报错**。
   * 这是拆分的直接后果，属于欠债，不是新需求。 */
  /^refs\/[\w.-]+\.md$/,
];

/* 【2026-09-15 加】hook 必须留下**可核对的痕迹**。
 * 一个静默的 hook 让「没跑」和「跑了没问题」在账面上无法区分 ——
 * 与 SOUL「一个不产生输出的失败，比不跑更危险」是同一条。
 * 本脚本在装上这段之前，唯一能说的是「配置写进 settings.json 了」，
 * 而**配置存在不等于它被调用**（同族：重启命令返回成功 ≠ 新代码在跑）。
 * 现在每次被调用都追加一行；`.check/hook.log` 就是「它到底会不会触发」的直接证据。 */
/* 【2026-09-15 第二版】痕迹实现搬进 `.check/hook-trace.js`，两个 hook 共用一份。
 * 第一版把 `trace()` 复制在两边 —— 而**复制两份就会静默分叉**。
 * 第二版同时加了来源标记：第一版的日志分不清「我手喂的」和「宿主调的」，
 * 实测代价是那 5 行全是手喂的，而我一度读成「hook 生效了」。详见 hook-trace.js 头注。 */
const { trace, classify, readStdin } = require('./hook-trace.js');

function relOf(fp) {
  if (!fp) return null;
  let p;
  try { p = path.resolve(String(fp)); } catch (e) { return null; }
  if (!p.startsWith(HOME_AI)) return null;
  return path.relative(HOME_AI, p).replace(/\\/g, '/');
}

function isWatched(rel) {
  if (!rel) return false;
  if (WATCH_FILES.indexOf(rel) >= 0) return true;
  return WATCH_PATTERNS.some(re => re.test(rel));
}

function say(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function report(msg) {
  trace(src, 'report: ' + msg, raw);
  process.stdout.write('protocol-hook: ' + msg + '\n');
  process.exit(0);
}

/* stdin 必须**先**读：来源标记要在第一行痕迹之前就成立。
 * 原版把 `trace('invoked')` 放在读 stdin 之前 —— 那一行永远不知道自己是谁触发的。 */
let evt = {};
let src = 'unknown';
let raw = '';
try {
  raw = readStdin();
  src = classify(raw);
  if (raw.trim()) evt = JSON.parse(raw);
} catch (e) {
  report('stdin 不是合法 JSON（' + e.message + '）—— 这一轮协议校验**没跑成**，是第三态，不是通过');
}
trace(src, 'invoked', raw);

try {
  const ti = evt.tool_input || {};
  const rel = relOf(ti.file_path || ti.filePath || ti.path);
  if (!isWatched(rel)) { trace(src, 'skip: 不是协议文件 ' + rel); process.exit(0); }

  trace(src, 'watched: ' + rel);
  const checker = path.join(HOME_AI, '.check', 'check-protocol.js');
  if (!fs.existsSync(checker)) {
    report('校验器不在 `' + checker + '` —— 这一轮**没有校验**（不是「通过」）');
  }

  // 用 process.execPath（正在跑本脚本的那个 node），不依赖 PATH ——
  // 依赖 PATH 的脚本会在换一个 shell 时静默失效。
  const r = spawnSync(process.execPath, [checker], { encoding: 'utf8', timeout: 25000 });
  const code = r.status;
  const out = ((r.stdout || '') + (r.stderr || '')).trim();

  if (r.error) {
    report('跑校验器时出错：' + r.error.message + ' —— 这一轮没跑成（第三态）');
  }
  trace(src, 'watched=' + rel + ' checker exit=' + code + ' 输出长度=' + out.length, raw);
  if (code === 0) process.exit(0);                 // 全绿：不打扰

  const tail = out.split('\n')
    .filter(l => /^(FAIL|UNVERIFIED)\s/.test(l) || /^检查项/.test(l) || /✗/.test(l))
    .slice(0, 20).join('\n');

  say({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext:
        '【协议校验未通过】你刚改了协议文件 `' + rel + '`。\n' +
        '自动校验 `~/.workbuddy-ai/.check/check-protocol.js` 退出码 ' + code +
        '（0=全绿，1=有 FAIL，2=有 UNVERIFIED）。\n' +
        (tail ? '摘要：\n' + tail + '\n' : '') +
        '→ 按 `MODE.md` G6：**这不叫完成**。要么修，要么把未验证项显式记进 UNVERIFIED，' +
        '不许把它当通过。'
    }
  });
} catch (e) {
  report('自身异常：' + e.message + ' —— 这一轮校验没跑成（第三态，不是通过）');
}
