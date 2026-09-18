#!/usr/bin/env node
/* evt-field-shape.js —— EVT 的 `wave`/`job` **形状**判据（**ISS-074**）
 *
 * 由来：ISS-074 实测 —— `eventlog/2026-09-16.txt` 里 EVT 001–018 写 `W11 J1` 这种形式，
 * 而 **EVT 019/020 写成 `22 1` / `22 2`**（丢了 `W`/`J` 前缀）。
 * 完整性判据 I1–I7 只查「字段数 / seq 连续 / 路径存在 / ts 单调 / 双向单射 / status 合法」——
 * **`wave`/`job` 的形状没有任何判据** ⇒ 这次漂移**全绿通过**。
 *
 * ★ ISS-074 自己规定的做法：「**先扫一遍看实际有几种形状，再决定**」——已照做，实测：
 *   全量 84 条 EVT 里 **82 条是 `W<n> J<n>`**，**只有 2 条是 `<n> <n>`**（即上面那两条历史行）。
 *   ⇒ 误伤面 = **精确 2 行**，且都是**已记录的历史行**（append-only 不改）⇒ 可以判红。
 *
 * 判什么（表驱动 + 白名单）：
 *   R1  每条 EVT 行的第 4 字段必须匹配 `^W[0-9]+$`、第 5 字段必须匹配 `^J[0-9]+$`
 *   R2  **多余豁免**：白名单里的条目若**已合规**或**根本不存在** → 报红（**该删**）
 *       ★ 没有 R2，白名单就是「**把判据弄瞎**」的入口（同族：`ruler-callpoint.js` 的 R4）。
 *
 * 退出码（三态，**不许合并**）：0 通过 · 1 失败 · 2 拒跑
 *   `2` 的語義是「**没跑成 ≠ 通过**」：找不到 eventlog 目录、或一条 EVT 都解析不出 → 拒跑。
 *   ★ 最后那条尤其重要：**「空集 PASS」是假绿**（同族：`card-entry-coverage.sh` 的空判据守门人）。
 *
 * ★ 边界（写在**文件里**，不只写在日志里）：
 *   ① 它只判**形状**（有没有 `W`/`J` 前缀 + 数字），**不判**「wave/job 与作业实际对不对」。
 *   ② 扫描面 = `.check/record/eventlog/*.txt`；**别处的 EVT 它看不见**。
 *   ③ 白名单只收「**append-only 的历史行**」，且每条必须**写明理由**、并接受 R2 的反查。
 *
 * 用法：node .check/tests/evt-field-shape.js [--inject]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const EVENTLOG = path.join(ROOT, '.check', 'record', 'eventlog');

/* ---------- 白名单：append-only 的历史行（每条必须写明理由；R2 会反查） ---------- */
const ALLOW = [
  {
    file: '2026-09-16.txt', seq: '019',
    why: 'ISS-074 记录的漂移现场之一（`22 1`）；append-only ⇒ 历史行不改，只在这里豁免'
  },
  {
    file: '2026-09-16.txt', seq: '020',
    why: '同上，ISS-074 的第二条现场（`22 2`）'
  }
];

/* ---------- 純函數判定體（--inject 直接餵它） ---------- */
function judge(entries, allow) {
  const fails = [];
  const used = new Set();
  entries.forEach(e => {
    if (/^W[0-9]+$/.test(e.wave) && /^J[0-9]+$/.test(e.job)) return;
    const key = e.file + '#' + e.seq;
    if (allow.some(a => a.file === e.file && a.seq === e.seq)) { used.add(key); return; }
    fails.push('R1 wave/job 形状不合规: ' + e.file + ' EVT ' + e.seq +
      ' → 「' + e.wave + ' ' + e.job + '」（应为 `W<n> J<n>`）');
  });
  /* R2：白名单条目必须**真的被用到** —— 否则它是多余豁免（该删） */
  allow.forEach(a => {
    const key = a.file + '#' + a.seq;
    if (!used.has(key)) {
      fails.push('R2 多余豁免（该行已合规或不存在）: ' + key + ' —— **该删**（白名单不能变成把判据弄瞎的入口）');
    }
  });
  return fails;
}

/* ---------- 讀磁碟 ---------- */
function listEvents() {
  const out = [];
  fs.readdirSync(EVENTLOG).filter(f => f.endsWith('.txt')).sort().forEach(f => {
    fs.readFileSync(path.join(EVENTLOG, f), 'utf8').split('\n').forEach(line => {
      const p = line.split(/\s+/);
      if (p[0] === 'EVT' && p.length >= 5) {
        out.push({ file: f, seq: p[1], ts: p[2], wave: p[3], job: p[4] });
      }
    });
  });
  return out;
}

/* ---------- 拒跑（第三態） ---------- */
function refuse(msg) {
  console.log('REFUSE ' + msg);
  console.log('结论：拒跑（**没跑成 ≠ 通过**）');
  process.exit(2);
}

if (!fs.existsSync(EVENTLOG)) refuse('找不到 eventlog 目录: ' + EVENTLOG);

const EVENTS = listEvents();
if (EVENTS.length === 0) refuse('一条 EVT 都解析不出 —— 路径或格式变了，**不许「空集 PASS」**');

/* ---------- 反向注入模式 ---------- */
if (process.argv.indexOf('--inject') !== -1) {
  /* ★ 前提：基线必须全绿 —— 否则「假红」这个词没有意义
     （无法区分「无关变异引起的红」与「本来就红」）。同 hardcoded-count.js。 */
  const base = judge(EVENTS, ALLOW);
  if (base.length) refuse('基线本身不是全绿（' + base.length + ' 项）—— 先修好基线，再谈假红: ' + base[0]);

  const GOOD = { file: '2099-01-01.txt', seq: '001', ts: '2099-01-01T00:00:00Z', wave: 'W99', job: 'J9' };
  const BAD = { file: '2099-01-01.txt', seq: '002', ts: '2099-01-01T00:00:00Z', wave: '22', job: '9' };
  const VECTORS = [
    { name: '新增一条 `22 9`（丢前缀）', ev: EVENTS.concat([BAD]), mustHit: true, hit: 'R1' },
    { name: '多余豁免：把一条**已合规**的行塞进白名单', ev: EVENTS,
      allow: ALLOW.concat([{ file: '2026-09-17.txt', seq: '001', why: '注入用' }]), mustHit: true, hit: 'R2' },
    { name: '新增一条合规的 `W99 J9`', ev: EVENTS.concat([GOOD]), mustHit: false },
    { name: '假红守门人：把一条合规行的 ts 改掉（无关变异）',
      ev: EVENTS.map(e => (/^W[0-9]+$/.test(e.wave) ? Object.assign({}, e, { ts: '1970-01-01T00:00:00Z' }) : e)),
      mustHit: false }
  ];
  console.log('=== 反向注入（每条都必须符合预期；守门人必须不报红）===');
  let bad = 0;
  VECTORS.forEach(v => {
    const f = judge(v.ev, v.allow || ALLOW);
    if (v.mustHit) {
      const want = v.hit || 'R1';
      if (f.some(x => x.indexOf(want) === 0)) console.log('  OK   ' + v.name + ' → 如预期报红（' + want + '）');
      else { console.log('  FAIL ' + v.name + ' → 未复现缺陷（该断言是假绿）'); bad++; }
    } else {
      if (f.length === 0) console.log('  OK   ' + v.name + ' → 如预期**不报红**');
      else { console.log('  FAIL ' + v.name + ' → 无关变异却报红（假红）: ' + f[0]); bad++; }
    }
  });
  console.log(bad === 0
    ? '反向注入 ' + VECTORS.length + '/' + VECTORS.length + ' 全部符合预期'
    : '反向注入有 ' + bad + ' 条不符合预期');
  process.exit(bad === 0 ? 0 : 1);
}

/* ---------- 正常模式 ---------- */
const shape = {};
EVENTS.forEach(e => {
  const k = e.wave.replace(/[0-9]+/g, 'N') + ' ' + e.job.replace(/[0-9]+/g, 'N');
  shape[k] = (shape[k] || 0) + 1;
});
console.log('扫描 ' + EVENTS.length + ' 条 EVT · 形状分布: ' +
  Object.keys(shape).sort().map(k => '「' + k + '」×' + shape[k]).join(' · '));
console.log('白名单 ' + ALLOW.length + ' 条（append-only 历史行）');
const fails = judge(EVENTS, ALLOW);
fails.forEach(f => console.log('FAIL ' + f));
console.log(fails.length === 0
  ? '结论：OK ' + EVENTS.length + ' 条 EVT 的 wave/job 形状全部合规（豁免 ' + ALLOW.length + ' 条，全部真的被用到）'
  : '结论：FAIL ' + fails.length + ' 项');
process.exit(fails.length === 0 ? 0 : 1);
