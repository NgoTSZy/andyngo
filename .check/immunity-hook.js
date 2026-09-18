// 免疫层宿主钩子 —— 编辑即查（PostToolUse）
//
// 唯一真源：immunity/host-hooks/immunity-hook.js
// 安装位置：~/.workbuddy-ai/.check/immunity-hook.js（由 install-triggers.py 拷贝）
//           改这里之后要重新安装；--status 会比对两者 sha256 是否一致。
//
// ⚠ 生效条件：宿主文档「所有外部修改需在 /hooks 面板审核后生效」。
//   2026-09-15 实测：本钩子**已经**被宿主 spawn（宿主日志 `[HookExecutor] spawn` 7 次，
//   其中 4 次留下运行记录）。所以「需放行」这句话在本机**已经成立**，不必再等。
//
// 退出码（与 git 钩子对齐）
//   0 干净
//   1 命中 → 报给宿主
//   2 扫描错误 / 3 入口异常 → **也报给宿主**
//   4 工具缺失
//   ⚠ 原来的实现是 `if (r.status === 1) exit 1; else exit 0` ——
//     于是 rc=2（扫描错误 = 空洞，不是通过）对宿主**报成了成功**。那是假绿，已修。
//
// 【为什么「无 file_path」也必须留痕】2026-09-15 实测（audit/probe-host-hook-input.py）：
//   payload 缺 file_path / 非法 JSON / 空 stdin 这三种输入下，钩子被 spawn 了却
//   **什么都不做、也不留任何记录**。于是「宿主 spawn 记录」与「运行记录」之间
//   出现一块**无法区分的空白** —— 看到 spawn 却没有运行记录时，你分不清是
//   宿主没递 payload、payload 形状变了、还是钩子自己崩了。
//   三种原因三种修法，而在证据链里长得一模一样。
//   （宿主日志里 7 次 spawn 有 2 次没有运行记录，就是这么来的，且**事后无法判定**。）
//   与约定 7 同族：第三态必须单独报出来，不许并进「空」。
//
// 【字段转义】约定 10：`\` → `\\`、CR → `\r`、LF → `\n`、TAB → `\t`、
//   NUL → `\0`、其余控制字符 → `\xNN`。不转义则路径里的换行会造出假记录行。

const fs = require('fs');
const { spawnSync } = require('child_process');

const PY = 'C:\\Users\\<user>\\.workbuddy-ai\\binaries\\python\\versions\\3.13.12\\python.exe';
const RUNNER = 'C:\\Users\\<user>\\WorkBuddy AI\\2026-09-14-22-54-28\\immunity\\run_immunity.py';
/* 【2026-09-15 加】落点可被 `IMMUNITY_TRACE` 覆盖 —— 否则**测试夹具会污染真日志**。
 * 实测：`audit/probe-host-hook-input.py` 每次运行往真 TRACE 写 12 行（含 4 行 `ok`），
 * 跑两次就有 8 行「畸形输入」混进「宿主 spawn 记录」里，
 * 于是「自述 N 行」不再等于宿主产出，而下游**分不清那几行是谁写的**。
 * 与 `hook-trace.js` 的 `HOOK_TRACE_LOG` 同一条规矩：**测试写别处，不污染真日志**。
 * 不设该变量时行为**完全不变**（向后兼容）。 */
const TRACE = process.env.IMMUNITY_TRACE
  || 'C:\\Users\\<user>\\WorkBuddy AI\\2026-09-14-22-54-28\\immunity\\host-hook-spawns.log';

function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\r/g, '\\r').replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t').replace(/\0/g, '\\0')
    .replace(/[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/g, (c) =>
      '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0'));
}

// append-only（约定 39）：重跑不抹掉历史。写失败**不许**让钩子崩 —— 但要在 stderr 说。
function trace(verdict, extra) {
  const parts = ['ts=' + new Date().toISOString(), 'pid=' + process.pid, 'verdict=' + verdict];
  for (const k of Object.keys(extra || {})) parts.push(k + '=' + esc(extra[k]));
  try {
    fs.appendFileSync(TRACE, parts.join(' ') + '\n', { encoding: 'utf8' });
  } catch (e) {
    process.stderr.write('[immunity] 留痕失败（这是可见的洞，不是静默）: ' + e.message + '\n');
  }
}

// ── 1) 读 stdin ────────────────────────────────────────────────────────────
let input = '';
let readErr = '';
try {
  input = fs.readFileSync(0, 'utf8');
} catch (e) {
  readErr = e.code || String(e);
}

// ── 2) 解析 payload ────────────────────────────────────────────────────────
let fp = '';
let parseErr = '';
try {
  const j = JSON.parse(input);
  fp = (j && (j.tool_input && (j.tool_input.file_path || j.tool_input.path))) || '';
} catch (e) {
  parseErr = 'bad-json';
}

// ── 3) 拿不到 file_path：**留痕**，然后放行 ─────────────────────────────────
// 不阻断：PostToolUse 时文件已经写下去了，阻断改变不了事实，只会制造噪音。
// 但也**不许静默**：这条 trace 是事后唯一能区分几种原因的凭证。
//
// 四种原因**分开报**（约定 7：`<ERROR>` 与 `<EMPTY>` 不许混）：
//   stdin-error   读 stdin 就失败了（宿主侧管道问题）
//   no-payload    stdin 是空的 —— 宿主**什么都没递**（与「递了但坏了」不是一回事）
//   bad-json      递了，但 JSON 解不开（形状变了 / 被截断）
//   no-file-path  能解开，但没有 file_path 字段（工具形状变了，如 MultiEdit 的 edits 数组）
if (!fp) {
  let verdict;
  if (readErr) verdict = 'stdin-error';
  else if (input.trim() === '') verdict = 'no-payload';
  else if (parseErr) verdict = 'bad-json';
  else verdict = 'no-file-path';
  trace(verdict, { input_len: input.length, err: readErr || parseErr || '-', rc: 0 });
  process.exit(0);
}

// ── 4) 调用统一入口 ────────────────────────────────────────────────────────
const r = spawnSync(PY, [RUNNER, '--files', fp], { encoding: 'utf8' });
const st = r.status === null || r.status === undefined ? 3 : r.status;

if (st === 1) {
  trace('hit', { fp: fp, rc: 1 });
  process.stderr.write('[immunity] 该文件命中已登记的失败模式：\n' + (r.stdout || '') + '\n');
  process.exit(1);
}
if (st !== 0) {
  // rc=2 扫描错误 / rc=3 入口异常 / rc=4 工具缺失 —— **都不许报成成功**
  trace('non-clean:rc=' + st, { fp: fp, rc: st,
    why: String(r.stderr || '').slice(0, 200) || '-' });
  process.stderr.write('[immunity] 检查未能完成（rc=' + st + '）—— ' +
    '这是空洞，不是通过；见 host-hook-spawns.log\n' + (r.stdout || '') + '\n');
  process.exit(st);
}
trace('ok', { fp: fp, rc: 0 });
process.exit(0);
