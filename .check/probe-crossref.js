#!/usr/bin/env node
'use strict';
/* probe-crossref.js —— 「跨物对照」判据（**新文件，不动任何冻结件**，DEC-031）
 *
 * 主题（一个，不是五个）：**A 与 B 的关系有没有被写下来。**
 * 起源：七项待裁决里 5 项是同一个形状 —— 两样东西相邻，中间缺一张显式对照表。
 *   X1 ← ISS-043  数字 `2` ↔ 含义（验收类 DRIFT/UNVERIFIED vs 测试类拒跑）
 *   X2 ← ISS-035  三态 ↔ 五态（子代理回传 vs 主代理输出）
 *   X3 ← ISS-026  协议**要求产出**的文件 ↔ 检查面
 *   X4 ← CHG-025  常量（冻结 md5）↔ 指针（file-history）
 *   （X5 ← ISS-025 见 `--report` 里的口径自检，只报告）
 *
 * ★ 判据不问「A 对不对」「B 对不对」，只问「A↔B 的关系有没有被写下来」。
 *   所以每一条都**可机械判定**，且**不预设哪一边是对的**。
 *
 * 模式：
 *   --report  只报告命中与样本，**不判红、rc 恒 0**（定规则之前先量误伤，automation §三 铁律）
 *   --scan    判定（默认），命中即 rc=1；豁免逐条打印；悬空豁免 rc=2
 *   --inject  双向测：注入向量必须被抓、反向向量必须干净、计数自检
 *
 * 退出码：0 合规 / 1 命中 / 2 拒跑（参数或环境不自洽）
 */
const fs = require('fs');
const path = require('path');

const HOME = path.resolve(__dirname, '..');
const REC = path.join(HOME, '.check', 'record');
const EXEMPT = path.join(REC, 'crossref-exemptions.md');
const BASELINE = path.join(REC, 'crossref-baseline.json');

/* 检查面：**活工具**。历史归档（applied / audit / evidence / tmp）与记录正文（*.md）不进面 ——
 * 理由同 fileset.js 的 FROZEN：把历史并进来只会把「当时就是那样」报成缺陷（假红）。 */
const SKIP = [
  /^\.check\/applied\//,
  /^\.check\/audit\//,
  /^\.check\/record\/evidence\//,
  /^\.check\/record\/exemptions\//,
  /^\.check\/tmp\//,
  /^\.check\/_battery-tmp/,
  /^\.check\/record\/[^/]+\.md$/,
];

function walk(dir, out) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    const rel = path.relative(HOME, p).split(path.sep).join('/');
    if (e.isDirectory()) {
      if (/^(node_modules|\.git|file-history|logs)$/.test(e.name)) continue;
      walk(p, out);
    } else if (/\.(js|sh)$/.test(e.name)) {
      if (SKIP.some((x) => x.test(rel))) continue;
      out.push({ rel, abs: p });
    }
  }
  return out;
}

function liveFiles() {
  const out = [];
  walk(path.join(HOME, '.check'), out);
  walk(path.join(HOME, 'skills'), out);
  return out;
}

/* 基线：X3 的各日期 evidence 文件数 + X4 的 changes.md 最大已判 CHG 号。
 * 存在理由同 `id-collision-exemptions.md`：**历史 append-only，判据不能把它们永远报红**
 * （永远红的断言会被训练成忽略，DEC-019）。基线一挪，只有**新写的行**受判。 */
function readBaseline() {
  if (!fs.existsSync(BASELINE)) return null;
  try { return JSON.parse(fs.readFileSync(BASELINE, 'utf8')); } catch (e) { return null; }
}

/* 豁免表：`EXEMPT <规则> <路径>:<行> <原因>`。粒度是 (规则, 位置)，不是整文件。 */
function loadExempt() {
  if (!fs.existsSync(EXEMPT)) return { list: [], raw: 0 };
  const list = [];
  for (const l of fs.readFileSync(EXEMPT, 'utf8').split('\n')) {
    const m = /^EXEMPT\s+(X\d)\s+(\S+)\s+(.+)$/.exec(l.trim());
    if (m) list.push({ rule: m[1], at: m[2], why: m[3] });
  }
  return { list, raw: list.length };
}

/* ------------------------------------------------------------------ 规则实现 */

/* X1 · 退出码语义必须**就地声明**（ISS-043）
 * 「2」在验收类工具里是 DRIFT/UNVERIFIED，在测试类工具里是拒跑 —— 两套都合法。
 * 所以判据不是「统一它」，而是「**每一处都写清楚它是哪一套**」。
 * 判法：`exit 2` / `process.exit(2)` 所在行 ±3 行内必须出现语义词。 */
/* X1 · 退出码语义必须**有一处显式登记**（ISS-043）
 * 「2」在验收类工具里是 DRIFT/UNVERIFIED，在测试类工具里是拒跑 —— 两套都合法。
 * 所以判据不是「统一它」，而是「**每一处都写清楚它是哪一套**」。
 *
 * ★ 测量出来的第一个修正：第一版要求「每处 exit 2 附近有语义词」→ 命中 13 处，横跨 3 个 skill，
 *   而且其中多数**本来就写了**（「用法」「拒绝在错的根上产出」「基线不干净，先停」），
 *   只是我的词表太窄 → **假红**。逐处加注释要动 16 个文件、跨 3 个 skill，改动面太大。
 *   → 改成**登记制**：`2` 的语义写在**一处**（`.check/record/exit-codes.md`），
 *     判据只问「**这个文件登记了没有**」。一处显式对照 > 十六处就地注释（同 fileset.js 的理由）。
 *
 * ★ 测量出来的第二个修正：**注释里的 `exit 2` 不是退出码**。`verify-ledger.js:13` 是块注释里的
 *   文档行（不以 `*` 开头，所以按行首判注释会漏）→ 必须**先剥注释再判**。
 */
const X1_RE = /(^|[^0-9A-Za-z_.])exit\s+2\b|\.exit\(2\)/;

/* 剥掉块注释与行注释（含 shell 的 `#`）。判的是**代码**，不是文档。
 *
 * ★ 2026-09-17 搬走（ISS-138）：实现现在住在 **`.check/strip-comments.js`** ——
 *   `tests/ruler-callpoint.js` 的 R1 犯了**同一个错**（把「注释里提到」也算调用点），
 *   需要**同一份口径**；而**复制会静默分叉**（`fileset.js` 文件头记的实测代价）。
 *   本文件与 `ruler-callpoint.js` 现在 `require` 同一个模块。 */
const { stripComments } = require('./strip-comments.js');

/* 登记表：`.check/record/exit-codes.md`，表格里出现 `` `路径` `` 的行即视为已登记。 */
function loadExitTable() {
  const f = path.join(REC, 'exit-codes.md');
  const map = new Map();
  if (!fs.existsSync(f)) return map;
  for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!l.trim().startsWith('|')) continue;
    const m = /^\|\s*`([^`]+)`/.exec(l.trim());
    if (m) map.set(m[1], l.trim());
  }
  return map;
}

/* ★ X1 的**窗口新鲜度前置**（2026-09-17 加 · ISS-127）—— 先例 ISS-116（`[99]` 跨午夜必假红）。
 *
 * **它要解决什么**（实测时间线，不是推测）：X1 在「**外部会话活跃写入期**」会**反复报新缺口** ——
 *   01:13Z 命中 2（`andy-audit.sh` · `andy-dream.sh`）→ 补登记 → **01:26Z 又命中 1**
 *   （`andy-record.sh`，那个会话 09:22 刚写过它）。判据**分不出**两种东西：
 *     · **真缺口** —— 文件已定稿、确实漏了登记 → **现在就该补**；
 *     · **瞬时状态** —— 文件还在被写、登记本来就要等它定稿 → **补了也会立刻过期**。
 *   逐个追的代价：追不上（目标在动），而且**追的动作本身**会写记录层。
 *
 * **修法**：文件 mtime 距今 < `FRESH_MIN` 分钟 ⇒ 该文件的缺口**不计入命中**，
 *   改报 `FRESH`（**逐条打印、tag 变 `NOTE`、结论行显式说明**）。
 *
 * ★ **为什么这个「降级」在这里不是假绿**（这是本条最需要交代的地方，同 ISS-116 的取舍）：
 *   ① **它自愈** —— 对方停写 `FRESH_MIN` 分钟后，mtime 年龄**自己**涨过阈值 ⇒ 缺口**自动变红**。
 *      不需要任何人记得回来复跑（**把纪律换成机制**）。
 *   ② **它可见** —— `FRESH` 逐条打印 · tag 是 `NOTE`（**不是** `OK`）· 结论行明写
 *      「**「命中 0」在这里不等于「没有缺口」**」。所以「命中 0」不会被误读成通过。
 *   ③ **没有「永远新鲜 ⇒ 永远不报」的坏形状** —— 被扫面是**活工具**
 *      （`.check` 下的 `.js` / `.sh` 去掉 SKIP 面 · `skills` 下各 skill 的 `scripts` 里的 `.sh`），
 *      **没有任何东西周期性写它们**；而 mtime 只在**内容被写**时更新，**读**不会更新它。
 *      这才是降级唯一真正的风险，这里不成立。
 *
 * ★ `FRESH_MIN = 30` 的理由：**与写权锁的默认 TTL 同口径**（`.check/write-lock.js` 默认 30min）。
 *   「**一个口径两处用**」—— 两个机制回答的是**同一个问题**：「这个文件还在被写吗」。
 *   （写权锁答「有人在写这棵树」，本前置答「这个文件刚被写过」。）
 *
 * ★ **拿不到 mtime（`null`）时判红**，不当新鲜放过 —— 「**拿不到信息 ≠ 通过**」
 *   （同 X5 的 GONE：磁盘上取不到就报出来，不静默丢）。 */
const FRESH_MIN = 30;

/* 新鲜度判定（纯函数，便于 `--inject` 注入 `nowMs`）。 */
function x1IsFresh(mtimeMs, nowMs) {
  return (nowMs - mtimeMs) < FRESH_MIN * 60000;
}

/* X1 的判定体（纯函数，便于 `--inject`）：
 *   rows = [{ rel, mtimeMs }] —— **已经确认含 `exit 2`** 的那些文件（收集与判定分开）
 *   reg  = 登记表 Map（`x1Reg` 的产物）
 * 返回 { hits, fresh }。`hits` 进命中面，`fresh` 只报告。 */
function x1Judge(rows, reg, nowMs) {
  const hits = [], fresh = [];
  for (const r of rows) {
    if (reg.has(r.rel)) continue;
    const txt = '含 `exit 2` 但未在 exit-codes.md 登记它的语义';
    if (r.mtimeMs !== null && x1IsFresh(r.mtimeMs, nowMs)) {
      fresh.push({ at: r.rel, txt: txt + '（mtime 距今 ' + Math.round((nowMs - r.mtimeMs) / 60000) + ' 分钟 · **可能仍在被写**）' });
    } else {
      hits.push({ at: r.rel, txt });
    }
  }
  return { hits, fresh };
}

function x1(files) {
  const reg = loadExitTable();
  const rows = [];
  const present = new Set();
  for (const f of files) {
    const src = stripComments(fs.readFileSync(f.abs, 'utf8'), /\.sh$/.test(f.rel));
    if (!X1_RE.test(src)) continue;
    present.add(f.rel);
    let mtimeMs = null;
    try { mtimeMs = fs.statSync(f.abs).mtimeMs; } catch (e) { mtimeMs = null; }
    rows.push({ rel: f.rel, mtimeMs });
  }
  const { hits, fresh } = x1Judge(rows, reg, Date.now());
  const dangling = [];
  for (const k of reg.keys()) if (!present.has(k)) dangling.push({ at: 'exit-codes.md ' + k, txt: '登记了但该文件已不含 `exit 2`（悬空登记，必须删）' });
  return { seen: present.size, hits, fresh, dangling, regSize: reg.size };
}

/* X2 · 三态 ↔ 五态必须有一处对照声明（ISS-035）
 * 判法：`event-protocol.md` 里出现「三态」的每一行，其 ±3 行内必须出现对照词
 * （`输出形态` / `SKILL.md` / `ASK` / `PROGRESS`）—— 即「说明这是两件事」。 */
const X2_WORDS = /输出形态|SKILL\.md|ASK|PROGRESS|五态/;

function x2() {
  const f = path.join(HOME, 'skills', 'andyngo', 'references', 'andyngo-event-protocol.md');
  if (!fs.existsSync(f)) return { seen: 0, hits: [], missing: true };
  const L = fs.readFileSync(f, 'utf8').split('\n');
  const hits = [];
  let seen = 0;
  L.forEach((line, i) => {
    if (!/三态/.test(line)) return;
    seen++;
    const win = L.slice(Math.max(0, i - 3), i + 4).join(' ');
    if (!X2_WORDS.test(win)) hits.push({ at: 'references/andyngo-event-protocol.md:' + (i + 1), txt: line.trim().slice(0, 72) });
  });
  return { seen, hits, missing: false };
}

/* X3 · 协议**要求产出**的文件必须在检查面里可见（ISS-026）
 * 判法：`evidence/` 各日期目录（**递归**）的文件数**只增不减**（对比基线），且每个文件非空。
 * 只判这两条 —— **不要求命名合规**（协议自己要求它们叫 `<原名>.pre-<slug>-<hhmmss>`）。
 * ★ 测量出来的第二个修正：**必须递归且只数普通文件**。第一版把子目录 `_superseded` 当成
 *   文件、`statSync().size` 在目录上返回 0 → 报「0 字节（归档件损坏）」= **纯假红**。
 *   「目录的 size 是 0」是平台行为，不是损坏。 */
function listFiles(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

function x3() {
  const base = path.join(REC, 'evidence');
  if (!fs.existsSync(base)) return { seen: 0, hits: [], dirs: {} };
  const cur = {};
  for (const d of fs.readdirSync(base, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const files = listFiles(path.join(base, d.name), []);
    cur[d.name] = files.length;
    for (const p of files) {
      if (fs.statSync(p).size === 0) {
        cur[d.name + '::' + path.relative(base, p).split(path.sep).join('/')] = -1;
      }
    }
  }
  let known = null;
  if (fs.existsSync(BASELINE)) {
    try { known = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).evidence; } catch (e) { known = null; }
  }
  const hits = [];
  for (const [k, v] of Object.entries(cur)) {
    if (v === -1) { hits.push({ at: 'evidence/' + k.split('::')[0] + '/' + k.split('::')[1], txt: '**0 字节**（归档件损坏或写入中断）' }); continue; }
    if (known && typeof known[k] === 'number' && v < known[k]) {
      hits.push({ at: 'evidence/' + k, txt: '文件数 ' + v + ' < 基线 ' + known[k] + '（归档件消失？）' });
    }
  }
  return { seen: Object.keys(cur).length, hits, dirs: cur };
}

/* X4 · **新增**的 CHG 行第 2 字段必须是合规 ts（ISS-043 家族的意外收获）
 *
 * ★ 测量出来的第三个修正（**两次**）：
 *   第一版：`凡有 md5 的行都要有指针` → 命中 **47/61（77%）**，全部是「改前/改后 md5」这个**格式字段** → 废。
 *   第二版：收紧到「声称不变」的词表（冻结/永久/不变/以此为准/锁定）→ 命中 12 条，但抽样 6 条里
 *     `永久 UNVERIFIED` · `行数不变` · `永久红` **三条都是普通叙述** → **假红率 ≈ 50%，不可判红**。
 *     **结论：「哪条 md5 是不变式」在文本层面与普通叙述同形 —— 这条做不成判据（量出来的负面结果）。**
 *   第三版（本版）：改判**机械确定**的东西 —— **CHG 行的第 2 字段必须是 ts**。
 *     成因：`eventlog` 有 I4 管 ts，而 `changes.md` **没有任何判据管**（`probe-record-shape.js` 只查
 *     前缀+3位号+字段数下限 9，缺 ts 的行照样 ≥9 字段 → **全绿通过**）。
 *     实测：**CHG-073 … CHG-082 共 10 行第 2 字段直接是文件路径**；CHG-072 是 `…T02:02:00Z`（**带了秒**）。
 *     **危害是具体的**：任何 `awk '{print $2}'` 取时间戳的脚本会拿到一个路径 ——
 *     本探针自己的第一版就因此把 md5 当成了路径（`GONE` 4 条假象）。
 *
 * 判法：**id > 基线的行才判**（历史 11 条 append-only、不可修 → 只报告不判红，避免训练人忽略红色）。 */
/* ★ 2026-09-16 W23 J13 修：原正则**只接受不带秒**，而它没有规格依据 ——
 *   规格 `build.md.txt:352` 对 CHG 只写 `<时间>`，**没规定格式**；而 `:258` 对 EVT 的 ts 写明
 *   `UTC ISO8601`、示例（`:266` 是 `2026-09-15T14:23:01Z`）**带秒**。
 *   所以「CHG 必须不带秒」是**从历史数据归纳的约束**，不是规范 —— 它拒掉了一个**比它更标准**的格式。
 *   **这不是「为了让判据变绿而放宽」**（本表铁律 1 的同类精神）：X4 的真正目的是
 *   「防**路径**冒充时间戳」（见上方「危害是具体的」那句），两种精度都能达到这个目的。
 *   同时补一条边界向量「带毫秒必须报红」，确保放宽没有过头。 */
/* ★ 2026-09-16 W23 J14 补：**上面那段只说清了「CHG 该收两种精度」，漏了一件更要紧的事** ——
 *   本仓库对 `ts` 有**两套口径**，要求**不同**，而此前**没有任何一处写下来**：
 *     · **CHG 第 2 字段**（本判据 X4 管）→ 实测 **112/120 行只到分**（`…T11:20Z`），**分是惯例**；
 *     · **EVT 第 3 字段**（由 `andyngo-integrity.js` 的 **I4** 管）→ 实测 **50/51 行带秒**
 *       （`…T11:20:00Z`），**秒是惯例，且 I4 强制要求秒**。
 *   后果实测（**我自己踩的**）：W23 J14 我照「分也可以」写了 EVT 039 的 `11:20Z`
 *   → **X4 全绿、I4 报红**（`格式不合·形状 1 条（要求 YYYY-MM-DDThh:mm:ss[.sss]Z）`）。
 *   **不是判据错，是口径分叉而无人登记** —— 写记录的人只能靠「跑一遍判据才知道」。
 *   所以这一段的作用是**把两套口径写在一起**：**改 CHG 行用「分」，改 EVT 行用「秒」**。
 *   （**不改 `andyngo-integrity.js` 去容纳分精度** —— 它是冻结件（DEC-031），
 *    且 I4 要的是「秒」这个更严的形态，放宽它没有依据；**改的是我写的那一行**。） */
const X4_TS = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?Z$/;

function x4() {
  const f = path.join(REC, 'changes.md');
  if (!fs.existsSync(f)) return { seen: 0, hits: [], note: '' };
  const base = readBaseline();
  const maxId = base && base.changesMaxId ? Number(String(base.changesMaxId).slice(4)) : 0;
  const hits = [];
  let seen = 0, histBad = 0;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = /^CHG-(\d{3}) /.exec(line);
    if (!m) continue;
    const id = Number(m[1]);
    const f2 = line.split(' ')[1] || '';
    const ok = X4_TS.test(f2);
    if (id > maxId) { seen++; if (!ok) hits.push({ at: 'changes.md CHG-' + m[1], txt: '第 2 字段不是 ts（`' + f2.slice(0, 40) + '`）' }); }
    else if (!ok) histBad++;
  }
  return { seen, hits, note: '历史行（≤ ' + (base && base.changesMaxId || '--') + '）不合规 **' + histBad + '** 条，append-only 不判红' };
}

/* X5 · **只报告**：记录里的 md5 与磁盘的差距（CHG-025 的「常量会腐烂」）
 * 不判红 —— 它指向的**全是历史行**，判红会变成一条永远红的断言（会训练人忽略红色）。
 * 但**每次跑都打印**，让腐烂可见；能实测的数不估。 */
const X5_PARSE = (field) => {
  if (field === '--' || /^[0-9a-f]{32}$/.test(field) || /（/.test(field)) return [];
  const m = /^([^{]*)\{([^}]*)\}(.*)$/.exec(field);
  if (m) return m[2].split(',').map((s) => m[1] + s.trim() + m[3]);
  return [field];
};

/* X5 的「改后 md5」**只从第 5 字段取**，按 `/` 切、与路径**按索引配对**。
 * 为什么不「扫整行取最后一个 md5」（v1 的做法）：正文里再提一次改前 md5，
 * 配对就**静默错位** —— 实测 CHG-103 报出两条假 STALE（把 event-protocol.md 的
 * 改前 md5 配给了 audit.sh）。配对必须**机械确定**，不能取决于正文写了什么。 */
const X5_SLASH = (field) => {
  if (field === '--' || field === '新增' || /（/.test(field)) return [];
  return field.split('/').map((s) => s.trim()).filter((s) => /^[0-9a-f]{32}$/.test(s));
};

/* X5 的**分类**（纯函数，`--inject` 测的就是它）：给定「记录 md5」与「磁盘 md5 / null（取不到）」，
 * 返回 `'same' | 'stale' | 'gone'`。
 * ★ 为什么要把这一步单独提出来（ISS-091）：v2 里 `statSync` 失败是 **`continue` 静默跳过** ——
 *   于是「被记录过 md5 的文件 26 个」而「一致 21 + 过期 4」只等于 25，**差的那 1 个不报也不计数**。
 *   实测那 1 个恰恰是 **CHG-106 被空格截断的路径**（`<项目外目录>`，
 *   配的 md5 其实是**改前**的）—— 也就是 **ISS-090 那个字段漂移的指纹**，它本来每次跑都该可见，
 *   却被静默丢掉了。**「跳过」可以，「跳过了不说」不行**：能实测的数不估。 */
const x5Classify = (rec, disk) => (disk === null ? 'gone' : (disk === rec ? 'same' : 'stale'));

function x5() {
  const f = path.join(REC, 'changes.md');
  if (!fs.existsSync(f)) return { seen: 0, hits: [], note: '' };
  const map = new Map();
  let misaligned = 0;
  for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    const g = /^(CHG-\d{3}) (\S+) (\S+) (\S+) (\S+)/.exec(l);
    if (!g) continue;
    const paths = X5_PARSE(g[3]);
    const after = X5_SLASH(g[5]);
    if (!after.length) continue;
    if (after.length !== paths.length) { misaligned++; continue; } /* 数不齐 → 不猜 */
    paths.forEach((p, i) => map.set(p, { id: g[1], md5: after[i] }));
  }
  let same = 0; const stale = []; const gone = [];
  for (const [p, v] of map) {
    let st = null; try { st = fs.statSync(p); } catch (e) { st = null; }
    let now = null;
    if (st && st.isFile()) now = require('crypto').createHash('md5').update(fs.readFileSync(p)).digest('hex');
    const kind = x5Classify(v.md5, now);
    if (kind === 'same') same++;
    else if (kind === 'stale') stale.push({ at: p, txt: '记录=' + v.md5.slice(0, 8) + ' 磁盘=' + now.slice(0, 8) + '（最后记录于 ' + v.id + '）' });
    else gone.push({ at: p, txt: '记录=' + v.md5.slice(0, 8) + '（' + v.id + '）· ' + (st ? '不是普通文件' : '磁盘上取不到（statSync 失败）') });
  }
  const sum = same + stale.length + gone.length;
  return {
    seen: map.size, hits: [],
    note: '被记录过 md5 的文件 **' + map.size + '** 个 · 最新记录与磁盘一致 **' + same + '** · 已过期 **' + stale.length +
      '** · 磁盘上取不到 **' + gone.length + '**（**' + same + '+' + stale.length + '+' + gone.length + '=' + sum +
      ' 必须等于 ' + map.size + (sum === map.size ? ' ✓' : ' ✗ 口径漏了') + '**）' +
      (misaligned ? ' · 路径/改后 md5 数不齐而跳过 **' + misaligned + '** 行' : ''),
    report: stale, goneList: gone,
  };
}

/* ------------------------------------------------------------------ 纯判定（--inject 测的就是这几个，唯一实现） */

/* X1 的判定体是两件纯函数：① 剥注释 ② 登记表解析。 */
function x1Strip(src, isSh) { return stripComments(src, isSh); }
function x1Reg(rows) {
  const map = new Map();
  for (const l of rows) {
    if (!l.trim().startsWith('|')) continue;
    const m = /^\|\s*`([^`]+)`/.exec(l.trim());
    if (m) map.set(m[1], true);
  }
  return map;
}
function x2Ok(win) { return X2_WORDS.test(win); }
function x4Ok(f2) { return X4_TS.test(f2); }
function x5Parse(field) { return X5_PARSE(field); }
function x5Slash(field) { return X5_SLASH(field); }

/* ------------------------------------------------------------------ 主流程 */

const argv = process.argv.slice(2);
const has = (k) => argv.includes(k);
const MODE = has('--inject') ? 'inject' : has('--baseline') ? 'baseline' : has('--report') ? 'report' : 'scan';

/* X6 · **只报告**：活引用检查面（C5）到底覆盖哪些文件（ISS-025）
 * 根因：C5 的检查面是 `fileset.js` 的 **7 段**（`MODE.md` + `refs/*.md`），**不含 `.check/`**；
 * 而「`skills/constraint-mode/SKILL.md` 被 7 处引用」是**一次 grep** 数出来的 ——
 * **两套口径，同名不同物**。ISS-025 卡了一整天就卡在这里。
 *
 * ★ 测量出来的第四个修正（**负面结果，如实记**）：本想做一条**判红**规则
 *   「凡出现『N 处引用』必须写明口径」→ 实测 16 个候选里 6 个命中，
 *   而抽看即知多数是普通叙述里的「N 处」+「引用」**同形**（同 X4 词表版的命运）。
 *   → **判红版废弃**；改成**每次跑都把检查面打印出来**，让「口径」永远可见、不需要谁记得问。
 */
function x6() {
  const segs = require('./fileset.js').buildFileSet().segs.map((s) => path.relative(HOME, s.file).split(path.sep).join('/'));
  return {
    seen: segs.length,
    hits: [],
    note: '活引用检查面 **' + segs.length + '** 段：' + segs.join(' · ') +
      '\n        不含 `.check/` —— 所以「grep 数出 N 处引用」与「C5 报红」是**两套口径**（ISS-025 的根因）',
    report: [],
  };
}

const RULES = {
  X1: { name: '退出码语义有一处显式登记（ISS-043）', run: () => x1(liveFiles()) },
  X2: { name: '三态 ↔ 五态有对照声明（ISS-035）', run: x2 },
  X3: { name: 'evidence 清单只增不减且非空（ISS-026）', run: x3 },
  X4: { name: '新增 CHG 行第 2 字段是合规 ts（新发现）', run: x4 },
  X5: { name: '记录 md5 ↔ 磁盘新鲜度（CHG-025）· **只报告不判红**', run: x5, reportOnly: true },
  X6: { name: '活引用检查面（C5）覆盖哪些文件（ISS-025）· **只报告不判红**', run: x6, reportOnly: true },
};

function collect() {
  const out = {};
  for (const [id, r] of Object.entries(RULES)) out[id] = r.run();
  return out;
}

function line(rule, id, res, showSamples) {
  const n = res.hits.length;
  const d = (res.dangling || []).length;
  const nf = (res.fresh || []).length;
  /* ★ 有 `fresh` 时 tag 必须是 `NOTE` 而**不是** `OK`（ISS-127）——
   *   否则「缺口全部新鲜」与「一处缺口都没有」长得**一模一样**（= 一条总是绿的判据）。 */
  const tag = (n === 0 && d === 0) ? (nf ? 'NOTE' : 'OK  ') : (RULES[rule].reportOnly ? 'NOTE' : 'HIT ');
  console.log('[' + rule + '] ' + tag + RULES[rule].name + '  检查 ' + res.seen + ' 处 · 命中 ' + n +
    (nf ? ' · **新鲜未判** ' + nf : '') + (d ? ' · 悬空登记 ' + d : '') + (res.missing ? '  ⚠ 文件缺失' : ''));
  if (res.note) console.log('        ' + res.note);
  if (showSamples) res.hits.slice(0, 6).forEach((h) => console.log('        ' + h.at + '  ' + h.txt));
  if (showSamples && n > 6) console.log('        …（共 ' + n + ' 处，只列前 6）');
  if (showSamples && res.fresh) res.fresh.slice(0, 12).forEach((h) => console.log('        FRESH  ' + h.at + '  ' + h.txt));
  if (showSamples && res.fresh && res.fresh.length > 12) console.log('        …（共 ' + res.fresh.length + ' 处新鲜未判）');
  if (showSamples && res.report) res.report.slice(0, 12).forEach((h) => console.log('        STALE  ' + h.at + '  ' + h.txt));
  if (showSamples && res.report && res.report.length > 12) console.log('        …（共 ' + res.report.length + ' 条过期）');
  if (showSamples && res.goneList) res.goneList.slice(0, 12).forEach((h) => console.log('        GONE   ' + h.at + '  ' + h.txt));
  if (showSamples && res.goneList && res.goneList.length > 12) console.log('        …（共 ' + res.goneList.length + ' 条取不到）');
  if (showSamples && d) (res.dangling || []).forEach((h) => console.log('        DANGLING  ' + h.at + '  ' + h.txt));
}

if (MODE === 'baseline') {
  const cur = x3().dirs;
  const ev = {};
  for (const [k, v] of Object.entries(cur)) if (v >= 0) ev[k] = v;
  let maxId = 'CHG-000';
  for (const l of fs.readFileSync(path.join(REC, 'changes.md'), 'utf8').split('\n')) {
    const m = /^(CHG-\d{3}) /.exec(l);
    if (m && Number(m[1].slice(4)) > Number(maxId.slice(4))) maxId = m[1];
  }
  fs.writeFileSync(BASELINE, JSON.stringify({
    _note: '跨物对照判据的基线。evidence = X3 的各日期文件数（判只增不减，不判命名合规）；changesMaxId = X4 只判「比它更新的行」—— 历史行 append-only，判红只会训练人忽略红色（DEC-019）。',
    _how_to_update: '确认减少/格式漂移是有意为之之后，重跑 `node .check/probe-crossref.js --baseline`。★ **更正（ISS-145）：本字段原先写「否则新行会落进『历史』而不受判」，把因果写反了** —— 判法本体是 `id > maxId` ⇒ **不重跑时新行一直受判**（更严）；**重跑会把 `changesMaxId` 抬到当前最大号，其下的行从此不再受判**（存量豁免）。⇒「要不要抬基线」是**设计取舍**，不是「让新行受判」的必要动作。★ 另：`evidence` 面（X3）**只覆盖本表登记过的日期**（ISS-146）。',
    evidence: ev,
    changesMaxId: maxId,
  }, null, 2) + '\n');
  console.log('BASELINE 已写 ' + BASELINE + '  · evidence ' + Object.keys(ev).length + ' 个目录 · changesMaxId ' + maxId);
  process.exit(0);
}

if (MODE === 'report') {
  console.log('===== 跨物对照判据 · **只报告不判红**（定规则之前先量误伤）=====');
  const res = collect();
  for (const id of Object.keys(RULES)) line(id, id, res[id], true);
  const tot = Object.values(res).reduce((a, r) => a + r.hits.length, 0);
  console.log('----');
  console.log('合计命中 ' + tot + ' 处（**本轮不判红** —— 先看这些命中里有多少是合法自指/历史行）');
  process.exit(0);
}

if (MODE === 'inject') {
  /* ★ 向量必须与标签分开（本轮实测的教训）：第一版把中文说明直接拼进**被测字符串**，
   *   于是 13 条里 7 条假失败 —— 例如标签尾巴的「（合规 ts）」让 `X4_TS` 不匹配、
   *   「（花括号展开 2 条）」里的全角括号让 `X5_PARSE` 直接返回 []、前缀「登记表命中：」让
   *   `startsWith('|')` 为假。**那不是判定体坏了，是尺子自己带着脏东西。**
   *   所以元组是 [规则, 标签, **输入**, 判定体, 期望]。 */
  const NOW = Date.now();
  const cases = [
    ['X1', '代码里的 exit 2 —— 必须留下', '  process.exit(2);', (w) => X1_RE.test(x1Strip(w, false)), true],
    ['X1', '块注释里的文档行 —— 必须剥掉', '/*\n * 无快照 → 打印 NO-SNAPSHOT · exit 2\n */', (w) => X1_RE.test(x1Strip(w, false)), false],
    ['X1', 'shell 行注释里的 exit 2 —— 必须剥掉', '# 缺参即 exit 2', (w) => X1_RE.test(x1Strip(w, true)), false],
    ['X1', '登记表命中', '| `.check/a.js` | 甲 · 拒跑 | x |', (w) => x1Reg([w]).has('.check/a.js'), true],
    ['X1', '表头行不得当登记', '| 文件 | 2 = 哪一类 | 语义 | 备注 |', (w) => x1Reg([w]).size > 0, false],
    ['X1', '分隔行不得当登记', '|---|---|---|---|', (w) => x1Reg([w]).size > 0, false],
    /* ★ ISS-127：窗口新鲜度前置 —— **成对**，防「降级」退化成「一律不报」 */
    ['X1', '新鲜文件（1 分钟前）的缺口 → **不算命中**（ISS-127）', 'x', () => x1Judge([{ rel: 'a.js', mtimeMs: NOW - 60000 }], new Map(), NOW).hits.length === 0, true],
    ['X1', '新鲜文件的缺口 → **报为 fresh**（可见，不是静默）', 'x', () => x1Judge([{ rel: 'a.js', mtimeMs: NOW - 60000 }], new Map(), NOW).fresh.length === 1, true],
    ['X1', '陈旧文件（31 分钟前）的缺口 → **必须判红**（这是自愈的证明）', 'x', () => x1Judge([{ rel: 'a.js', mtimeMs: NOW - 31 * 60000 }], new Map(), NOW).hits.length === 1, true],
    ['X1', '边界：**恰好** 30 分钟 → 不算新鲜（必须判红）', 'x', () => x1IsFresh(NOW - FRESH_MIN * 60000, NOW) === false, true],
    ['X1', '已登记 → 既不命中也不新鲜（不得因新鲜而多报）', 'x', () => { const r = x1Judge([{ rel: 'a.js', mtimeMs: NOW - 60000 }], new Map([['a.js', '|']]), NOW); return r.hits.length === 0 && r.fresh.length === 0; }, true],
    ['X1', 'mtime 取不到（null）→ **必须判红**（拿不到信息 ≠ 通过）', 'x', () => x1Judge([{ rel: 'a.js', mtimeMs: null }], new Map(), NOW).hits.length === 1, true],
    ['X2', '有对照声明 —— 不得报红', '子代理回传三态；主代理**输出形态**另有 ASK/PROGRESS', (w) => x2Ok(w), true],
    ['X2', '裸三态 —— 必须报红', '4. status 三态：OK / FAIL / BLOCK', (w) => x2Ok(w), false],
    ['X4', '合规 ts（历史惯例，不带秒）', '2026-09-16T05:15Z', (w) => x4Ok(w), true],
    ['X4', '合规 ts（完整 ISO8601，带秒）—— W23 J13 起放行', '2026-09-16T02:02:00Z', (w) => x4Ok(w), true],
    ['X4', '第 2 字段是路径（缺 ts）—— 必须报红', '.check/record/issues.md', (w) => x4Ok(w), false],
    ['X4', '日期只有日精度 —— 必须报红', '2026-09-16', (w) => x4Ok(w), false],
    ['X4', '带毫秒 —— 必须报红（放宽不能过头）', '2026-09-16T02:02:00.123Z', (w) => x4Ok(w), false],
    ['X5', '花括号展开成 2 条', '.check/record/{issues.md,decisions.md}', (w) => x5Parse(w).length === 2, true],
    ['X5', '`--` 展开 0 条（不得把 md5 当路径）', '--', (w) => x5Parse(w).length === 0, true],
    ['X5', '纯 md5 不得当路径', '3f3192d5bc8b3de8482ae558915c3a1d', (w) => x5Parse(w).length === 0, true],
    ['X5', '中文描述不得当路径', 'skills/（22 个目录）', (w) => x5Parse(w).length === 0, true],
    ['X5', '改后 md5 按 `/` 切 2 条', '9c3903e4250d2f5532f1d071b395950c/395512dd19eab102c72f6087d91ad53b', (w) => x5Slash(w).length === 2, true],
    ['X5', '「新增」不得当 md5', '新增', (w) => x5Slash(w).length === 0, true],
    ['X5', '`--` 不得当 md5', '--', (w) => x5Slash(w).length === 0, true],
    ['X5', '磁盘取不到 → **gone**（v2 会静默丢，ISS-091）', 'a'.repeat(32), (w) => x5Classify(w, null) === 'gone', true],
    ['X5', '记录 = 磁盘 → same', 'a'.repeat(32), (w) => x5Classify(w, w) === 'same', true],
    ['X5', '记录 ≠ 磁盘 → stale', 'a'.repeat(32), (w) => x5Classify(w, 'b'.repeat(32)) === 'stale', true],
  ];
  let ok = 0, bad = 0;
  for (const [id, label, input, fn, want] of cases) {
    const got = fn(input);
    if (got === want) { ok++; console.log('  ✓ ' + id + '  ' + (want ? 'CAUGHT' : 'CLEAN ') + '  ' + label); }
    else { bad++; console.log('  ✗ ' + id + '  期望 ' + (want ? '命中' : '干净') + ' 实得 ' + (got ? '命中' : '干净') + '  ' + label + '  ← 输入=' + JSON.stringify(input)); }
  }
  console.log('----');
  console.log('双向测 ' + cases.length + ' 条：符合 ' + ok + ' / 不符 ' + bad);
  process.exit(bad ? 1 : 0);
}

const ex = loadExempt();
const res = collect();
const used = new Set();
let red = 0;
let ruleDangling = 0;
for (const id of Object.keys(RULES)) {
  const r = res[id];
  const keep = [];
  for (const h of r.hits) {
    const hit = ex.list.find((e) => e.rule === id && e.at === h.at);
    if (hit) used.add(hit.rule + ' ' + hit.at);
    else keep.push(h);
  }
  /* 规则自带的悬空（例如 X1 的登记表里有、磁盘上已不含 exit 2）也计入拒跑面 */
  const rd = (r.dangling || []).filter((d) => {
    const hit = ex.list.find((e) => e.rule === id && e.at === d.at);
    if (hit) { used.add(hit.rule + ' ' + hit.at); return false; }
    return true;
  });
  ruleDangling += rd.length;
  line(id, id, { seen: r.seen, hits: keep, fresh: r.fresh, dangling: rd, missing: r.missing, note: r.note, report: r.report, goneList: r.goneList }, true);
  if (!RULES[id].reportOnly) red += keep.length;
}
console.log('---- 豁免（逐条打印；豁免的正当理由只有「记录层 append-only」）----');
if (!ex.list.length) console.log('（无）');
for (const e of ex.list) console.log('EXEMPT  ' + e.rule + '  ' + e.at + '  ← ' + e.why);
const dangling = ex.list.filter((e) => !used.has(e.rule + ' ' + e.at));
if (dangling.length) {
  console.log('DANGLING  悬空豁免 ' + dangling.length + ' 条（登记了却没命中）→ 必须删掉：' + dangling.map((d) => d.rule + ' ' + d.at).join(' · '));
}
const dang = dangling.length + ruleDangling;
/* ★ 「命中 0」在有新鲜缺口时**不等于通过**（ISS-127）—— 必须显式说出来。
 *   否则 `HIT` 计数归零会被读成「一片干净」（本仓库原话：「一个不会响的守门人比没有守门人更坏」）。 */
const freshTot = Object.values(res).reduce((a, r) => a + ((r.fresh || []).length), 0);
if (freshTot) console.log('注意：另有 ' + freshTot + ' 处**新鲜文件**的缺口**未计入命中**（mtime < ' + FRESH_MIN + ' 分钟 · 可能仍在被写）—— 「命中 0」在这里**不等于「没有缺口」**；等它们定稿后复跑即**自动变红**（ISS-127）。');
console.log('结论：命中 ' + red + ' 处 · 豁免 ' + ex.list.length + ' 条 · 悬空 ' + dang + '（豁免 ' + dangling.length + ' + 规则 ' + ruleDangling + '）');
process.exit(dang ? 2 : (red ? 1 : 0));


