#!/usr/bin/env node
/* ============================================================================
 * lock-coverage.js —— 「**改动时刻** ↔ **写权锁持有区间**」对照
 *                    （ISS-118 缺口的**另一半**：从「可判」到「有人判」）
 * ----------------------------------------------------------------------------
 * ## 它守什么
 * 每条 `CHG-nnn` 行的 ts = **那一刻文件被改了**；`.check/.write-lock.log` 里的
 * `acquire → release` = **那一刻有人在写**。本判据把两者对表，报出
 * **「改了、但那一分钟没有任何持有区间覆盖它」**的行。
 *
 * ## 为什么需要它（不是纪律问题）
 * ISS-118 原话：「**仍然没有『改了但没人持锁』的自动比对判据 —— 把『改动时刻』
 * 与『持有区间』对表仍要人做（这才是本条真正要的东西，只完成了一半：
 * **从不可判变成可判，但没人判**）**」。
 * 锁日志（CHG-211）解决了「事后不可判」；**本文件解决「可判但没人判」**。
 * 口径同 `alloc.sh` 的诞生：**把纪律换成机制**。
 *
 * ## 口径（**两种精度混用，必须都收**）
 * CHG 的 ts 有两种形态（实测：330 行里 8 行带秒）：
 *   · `YYYY-MM-DDThh:mmZ`    —— **分钟**精度（多数）
 *   · `YYYY-MM-DDThh:mm:ssZ` —— **秒**精度（CHG-072 / CHG-119..125）
 * 锁日志一律秒精度。于是判定取**三态**，**不把不确定说成通过**：
 *   · `IN`      该时刻**完整**落在某个持有区间内            → 通过
 *   · `PARTIAL` **部分**落在区间内（分钟精度的固有边界）     → **不报红，但单独计数**
 *               （**它不是通过** —— 「拿不到信息 ≠ 通过」）
 *   · `OUT`     与**所有**持有区间**都无交集**               → **报红**
 *
 * ## 基线（append-only ⇒ 改不了的行，**跳过并计数**，不静默）
 *   · 锁日志**起点之前**的 CHG 行 —— 那时**根本没有锁日志**，无从回溯
 *   · **缺 ts** 的行 —— 实测 10 行（CHG-073..082，历史左移族）。缺 ts 已由
 *     `probe-crossref.js` 的 **X4** 单独守（先例：CHG-117 被 X4 当场抓到并补回），
 *     所以这里**只计数不重复判**。
 *
 * ## 已知边界（**不假装已覆盖**）
 * ① **只守有 CHG 行的改动**。改了文件而**没落 CHG** ⇒ 本判据**看不见**
 *    （那由 `probe-record-shape.js` / SEAL 一族管，不是本判据的面）。
 * ② **只守有锁日志之后的时段**。锁日志之前的历史（200 行）**不可回溯**。
 * ③ **锁日志不防篡改**（`WRITE_LOCK_LOG` 可覆盖）⇒ 「读到的都是真的，
 *    但『没读到』不能反推『没发生』」（ISS-118 缺口③）。
 * ④ **第一条持有区间不完整**（日志第一行是 `release`）⇒ 悬空 release **跳过并计数**。
 * ⑤ **未闭合的 `acquire` 视为「持有至今」** —— 保守：宁可漏报、不假红；
 *    输出里**显式打印**「有未闭合区间」，不静默。
 * ⑥ **分钟精度的 PARTIAL 永远无法消歧** —— 除非 CHG 的 ts 统一到秒（那是另一件事）。
 *
 * ## 三态退出码
 *   `0` 通过 · `1` 有违规（OUT）· `2` **拒跑**（拿不到信息 ≠ 通过）：
 *   · 锁日志不存在 / 读不到
 *   · **一条持有区间都解析不出**（防「空集 PASS」）
 *   · `changes.md` 读不到
 *
 * 用法：`node .check/tests/lock-coverage.js [--scan|--inject]`
 * ==========================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const LOCK_LOG = path.join(ROOT, '.check', '.write-lock.log');
const CHANGES = path.join(ROOT, '.check', 'record', 'changes.md');

/* ---- 豁免表（**逐条登记 + 每条必须能被反查到**，口径同 `evt-field-shape.js`）----
 * 这 2 行是**同一次真实事件**（2026-09-17T02:42Z「放锁后直接收尾」）的现场：
 * `W23-J18-ANDY-FMT9` 于 02:37:53Z 释放、`W23-J18-ISS134` 到 02:44:37Z 才取，
 * 而 CHG-275/276 的 ts = 02:42Z ⇒ **那一分钟确实没人持锁**。
 * 不修的理由：**append-only ⇒ 历史行不改**（同 `record-shape.js` 的基线口径）。
 * ★ 这不是「为了让判据变绿而豁免」—— 本判据**首次运行就报出了它们**（见留证）。 */
const ALLOW = [
  { id: 'CHG-275', why: 'ISS-118 首次运行的真实现场（02:42Z 无持有区间）；append-only ⇒ 历史行不改，只在此豁免' },
  { id: 'CHG-276', why: '同上，同一次事件的第二行（留证被追加）' },
  /* ★ 2026-09-17 加（ISS-147）：**第二种形态** —— 不是「放锁后收尾」的时序缝隙，
   * 而是「19 个零引用 skill 移出」那个作业**整个没取锁**（13:49Z / 13:58Z 与所有持有区间无交集）。
   * `why` 里**不许把它含糊成「时序缝隙」**：豁免可以静音，但不许改写事实的形状。 */
  { id: 'CHG-346', why: 'ISS-147：该作业未取写权锁即改 .check/record/exit-codes.md（13:49Z 与所有持有区间无交集）；append-only ⇒ 历史行不改，只在此豁免' },
  { id: 'CHG-347', why: 'ISS-147：同上，同一次作业的第二行（skills/hub/routes.md，13:58Z）' },
];

const TS_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?Z$/;
const MIN = 60000;

/* ---- 解析：锁日志 → 持有区间 -------------------------------------------------
 * 返回 `{ intervals, danglingRelease, takeover, openTail }`。
 * `intervals[0].start` 就是**基线起点**。 */
function parseLockLog(text) {
  const intervals = [];
  let cur = null, danglingRelease = 0, takeover = 0;
  for (const raw of String(text).replace(/\r\n/g, '\n').split('\n')) {
    const l = raw.trim();
    if (!l) continue;
    const f = l.split(/\s+/);
    const ts = Date.parse(f[0]);
    if (Number.isNaN(ts)) continue;
    if (f[1] === 'acquire' || f[1] === 'takeover') {
      if (f[1] === 'takeover') takeover++;
      /* 未闭合的上一段 → 用本次起点截断（保守：把区间**截短**，宁可漏报不假红） */
      if (cur) intervals.push({ who: cur.who, start: cur.start, end: ts, truncated: true });
      cur = { who: f[2], start: ts, end: null };
    } else if (f[1] === 'release') {
      if (!cur) { danglingRelease++; continue; }   /* 边界④：第一条是 release */
      cur.end = ts;
      intervals.push({ who: cur.who, start: cur.start, end: ts });
      cur = null;
    }
  }
  let openTail = null;
  if (cur) { openTail = cur.who; intervals.push({ who: cur.who, start: cur.start, end: Infinity, open: true }); }
  return { intervals, danglingRelease, takeover, openTail };
}

/* ---- 解析：changes.md → CHG 行的 ts ----------------------------------------- */
function parseChanges(lines) {
  const rows = [], noTs = [];
  for (const l of lines) {
    if (!/^CHG-\d+ /.test(l)) continue;
    const f = l.split(' ');
    const id = f[0], t2 = f[1];
    const m = TS_RE.exec(t2 || '');
    if (!m) { noTs.push(id); continue; }
    rows.push({ id, ts: Date.parse(t2), raw: t2, sec: !!m[2] });
  }
  return { rows, noTs };
}

/* ---- 纯函数判定体（`--inject` 在内存里变异它，不碰磁盘）------------------------
 * `rows` 必须已按 ts 升序无关；`intervals` 来自 `parseLockLog`。
 * 返回 `{ fails, stats }`；`fails` 是**字符串数组**（空 = 通过）。 */
function judge(rows, intervals, allow) {
  const fails = [];
  const stats = { total: rows.length, IN: 0, PARTIAL: 0, OUT: 0, before: 0, exempt: 0 };
  const outIds = new Set();
  const used = new Set();

  if (!intervals.length) return { fails: ['**拒跑条件**：一条持有区间都解析不出（防「空集 PASS」）'], stats, refuse: true };
  const baseStart = intervals[0].start;

  for (const r of rows) {
    if (r.ts < baseStart) { stats.before++; continue; }        /* 基线外：不可回溯 */
    const lo = r.ts, hi = r.sec ? r.ts : r.ts + MIN - 1;        /* 分钟精度 → 该分钟整段 */
    let anyIn = false, allIn = false;
    for (const v of intervals) {
      if (hi < v.start || lo > v.end) continue;
      anyIn = true;
      if (lo >= v.start && hi <= v.end) { allIn = true; break; }
    }
    if (allIn) { stats.IN++; continue; }
    if (anyIn) { stats.PARTIAL++; continue; }                   /* **不是通过** */
    stats.OUT++;
    outIds.add(r.id);
    if (allow.some(a => a.id === r.id)) { used.add(r.id); stats.exempt++; continue; }
    fails.push('R1 改了但没人持锁: ' + r.id + ' ts=' + r.raw +
      '（该时刻与**所有**持有区间都无交集 —— 见 `.check/.write-lock.log`）');
  }

  /* **R2 反查**：豁免项没被用到（该行已合规 / 不存在）⇒ 报红。
   * 没有 R2，白名单就是「把判据弄瞎」的入口 —— 加了豁免就永久静音，
   * 且**没有任何东西会响**（同族先例：`ruler-callpoint.js` 的 R4）。 */
  allow.forEach(a => {
    if (!used.has(a.id)) {
      fails.push('R2 多余豁免（该行已合规或不存在）: ' + a.id + ' —— **该删**（白名单不能变成把判据弄瞎的入口）');
    }
  });
  return { fails, stats };
}

/* ---- 模式 ------------------------------------------------------------------- */
const mode = process.argv[2] || '--scan';

function readDisk() {
  if (!fs.existsSync(LOCK_LOG)) return { refuse: '锁日志不存在: ' + LOCK_LOG };
  if (!fs.existsSync(CHANGES)) return { refuse: 'changes.md 不存在: ' + CHANGES };
  return {
    log: parseLockLog(fs.readFileSync(LOCK_LOG, 'utf8')),
    chg: parseChanges(fs.readFileSync(CHANGES, 'utf8').replace(/\r\n/g, '\n').split('\n')),
  };
}

function report(tag, r, st) {
  console.log(tag + '  ' + JSON.stringify(st));
  r.forEach(x => console.log('  FAIL  ' + x));
}

if (mode === '--scan') {
  const d = readDisk();
  if (d.refuse) { console.log('拒跑：' + d.refuse); process.exit(2); }

  console.log('===== 锁覆盖（改动时刻 ↔ 写权锁持有区间 · ISS-118）=====');
  console.log('锁日志: ' + d.log.intervals.length + ' 个持有区间 · 悬空 release ' + d.log.danglingRelease +
    ' · takeover ' + d.log.takeover + ' · 未闭合 ' + (d.log.openTail ? '**有**（' + d.log.openTail + '，视为持有至今）' : '无'));
  if (!d.log.intervals.length) { console.log('拒跑：一条持有区间都解析不出'); process.exit(2); }
  console.log('基线起点（锁日志第一个完整区间）: ' + new Date(d.log.intervals[0].start).toISOString() +
    ' —— **早于它的 CHG 行不可回溯，跳过**');
  console.log('CHG 行: ' + d.chg.rows.length + ' 有 ts · ' + d.chg.noTs.length + ' 缺 ts（已由 X4 守，此处只计数）');

  const { fails, stats, refuse } = judge(d.chg.rows, d.log.intervals, ALLOW);
  if (refuse) { console.log('拒跑：' + fails.join(' · ')); process.exit(2); }

  console.log('---- 判定（三态：IN 通过 / PARTIAL **不是通过** / OUT 报红）----');
  console.log('  可判范围 ' + stats.total + ' 行 = 基线外 ' + stats.before + ' · IN ' + stats.IN +
    ' · PARTIAL ' + stats.PARTIAL + ' · OUT ' + stats.OUT + '（其中豁免 ' + stats.exempt + '）');
  if (stats.PARTIAL) console.log('  ★ PARTIAL ' + stats.PARTIAL + ' 行是**分钟精度的固有边界**（部分落在区间内）—— ' +
    '**不报红、也不计入通过**（「拿不到信息 ≠ 通过」）');
  if (d.chg.noTs.length) console.log('  ★ 缺 ts 的 ' + d.chg.noTs.length + ' 行: ' + d.chg.noTs.join(' '));

  if (fails.length) {
    console.log('---- FAIL ----');
    fails.forEach(x => console.log('  ' + x));
    console.log('结论：**' + fails.length + ' 条不合规**（改了但没人持锁 / 多余豁免）EXIT=1');
    process.exit(1);
  }
  console.log('结论：OK 可判范围内 **没有「改了但没人持锁」**（豁免 ' + stats.exempt + ' 条，全部真的被用到）EXIT=0');
  process.exit(0);
}

if (mode === '--inject') {
  /* **基线断言**：`--inject` 的前提是**基线必须全绿** —— 否则分不清
   * 「无关变异引起的红」与「本来就红」（2026-09-17 由 `hardcoded-count.js` 教出来）。 */
  const d0 = readDisk();
  if (d0.refuse) { console.log('拒跑：' + d0.refuse); process.exit(2); }
  const base = judge(d0.chg.rows, d0.log.intervals, ALLOW);
  if (base.fails.length) {
    console.log('拒跑：**基线本身不是全绿**（' + base.fails.length + ' 条）—— 先修好基线，再谈假红');
    base.fails.forEach(x => console.log('  ' + x));
    process.exit(2);
  }

  const IV = [{ who: 'X', start: Date.parse('2026-09-17T10:00:00Z'), end: Date.parse('2026-09-17T10:10:00Z') }];
  const mk = (id, raw) => { const m = TS_RE.exec(raw); return { id, ts: Date.parse(raw), raw, sec: !!m[2] }; };

  let bad = 0;
  const chk = (why, rows, ivs, alw, wantFails, wantStat) => {
    const r = judge(rows, ivs, alw || []);
    const got = r.fails.length;
    let ok = got === wantFails;
    if (wantStat) for (const k of Object.keys(wantStat)) if (r.stats[k] !== wantStat[k]) ok = false;
    if (!ok) bad++;
    console.log((ok ? 'CAUGHT  ' : '**WRONG** ') + why);
    console.log('        → FAIL ' + got + '（期望 ' + wantFails + '）· ' + JSON.stringify(r.stats));
    if (!ok) r.fails.forEach(x => console.log('          ' + x));
  };

  console.log('===== 注入向量（纯函数 · 内存变异 · 不碰磁盘）=====');
  chk('R1 正向：ts 落在**所有区间之外** → 必须报 1 条',
    [mk('CHG-901', '2026-09-17T10:30Z')], IV, [], 1, { OUT: 1 });
  chk('R1 反向：ts **完整落在区间内** → 不得报',
    [mk('CHG-902', '2026-09-17T10:05Z')], IV, [], 0, { IN: 1, OUT: 0 });
  chk('PARTIAL：分钟精度、**部分**落在区间内（10:09Z 的 10:09:00–10:09:59 vs 区间止于 10:10:00）→ 不得报红，但**不并入 IN**',
    [mk('CHG-903', '2026-09-17T10:10Z')], [{ who: 'X', start: Date.parse('2026-09-17T10:00:00Z'), end: Date.parse('2026-09-17T10:10:30Z') }], [], 0, { PARTIAL: 1, IN: 0, OUT: 0 });
  chk('秒精度：带秒的 ts **完整在内** → IN（不得因「分钟口径」误判）',
    [mk('CHG-904', '2026-09-17T10:05:30Z')], IV, [], 0, { IN: 1 });
  chk('基线：ts **早于**第一个区间起点 → 跳过并计数（不可回溯），不得报',
    [mk('CHG-905', '2026-09-17T09:00Z')], IV, [], 0, { before: 1, OUT: 0 });
  chk('R2 反查：把一条**已经合规**的 id 塞进白名单 → 必须报「多余豁免」',
    [mk('CHG-906', '2026-09-17T10:05Z')], IV, [{ id: 'CHG-906', why: 'x' }], 1, {});
  chk('豁免**真的被用到**时 → 不得报（正向）',
    [mk('CHG-907', '2026-09-17T10:30Z')], IV, [{ id: 'CHG-907', why: 'x' }], 0, { OUT: 1, exempt: 1 });
  chk('空集拒跑：**一条区间都没有** → 必须拒跑（防「空集 PASS」）',
    [mk('CHG-908', '2026-09-17T10:30Z')], [], [], 1, {});
  chk('**假红守门人**：与判定无关的变异（多一条区间、改 who 名）→ **不得**报红',
    [mk('CHG-909', '2026-09-17T10:05Z')],
    [{ who: 'Y-无关', start: Date.parse('2026-09-17T10:00:00Z'), end: Date.parse('2026-09-17T10:10:00Z') }], [], 0, { IN: 1 });

  console.log('----');
  if (bad) { console.log('注入向量 ' + (9 - bad) + '/9 符合期望 —— **有 ' + bad + ' 条不符合**'); process.exit(1); }
  console.log('注入向量 9/9 全部符合期望（含 R1 正反向 · PARTIAL · 秒精度 · 基线 · R2 反查 · 豁免正向 · 空集拒跑 · **假红守门人**）');
  process.exit(0);
}

console.log('用法：node .check/tests/lock-coverage.js [--scan|--inject]');
process.exit(2);
