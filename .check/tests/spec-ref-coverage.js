#!/usr/bin/env node
'use strict';
/* spec-ref-coverage.js —— 规格 §3.N 规定的文件，**必须有引用点**。
 *
 * 用法:
 *   node .check/tests/spec-ref-coverage.js [spec 路径]      # 判红绿
 *   node .check/tests/spec-ref-coverage.js --report [spec]  # 只打印表格，恒 rc=0
 *   node .check/tests/spec-ref-coverage.js --inject         # 双向测（内置夹具，不读真规格）
 * 退出码: 0 = 全部有引用点 · 1 = 有零引用点 · 2 = 拒跑（规格读不到 / 参数错）
 *
 * ── 为什么要有这个判据 ────────────────────────────────────────────────
 * 规格是**构建指令**（「按以下规格创建」），它规定了 22 个文件必须存在。
 * **「存在」与「可达」是两件事**：一个文件躺在磁盘上、但没有任何文件指向它，
 * 它就**永远不会被读到**（模型不会去读一个没人提过的文件）。
 * 2026-09-16 实测（W23 J13）：22 个 §3.N 文件里 **2 个零引用点** ——
 *   §3.2  `andyngo-glossary.md`（其它 references 都在 SKILL.md 的必读表里，**只有它不在**）
 *   §3.22 `andyngo-security-scan.sh`（scripts/ 三兄弟里 record.sh / audit.sh 都接线了，**只有它没有**）
 * 两处都是**接线遗漏**，不是「设计如此」—— 判据就是这条：**兄弟都接了，你没接**。
 *
 * ── 口径（不写清楚就会「只会乱报」—— 本判据的 v1 就踩过）────────────────
 * ① **活文件 = 白名单，不是黑名单。**
 *    v1 用黑名单（只排除 `.check/record/`），实测把 `.check/audit/` 下的 seal 产物、
 *    `file-tree-manifests/` 的索引 json、`.check/tmp/` 的正文文件全算成了「引用点」→
 *    22 个文件**全部**「有引用」、零引用 = 0。**这是 ISS-082/087 的同族第 7 次**
 *    （判据分不清「引用（去读它）」与「提及（在讨论它）」）。
 *    白名单的好处：**新出现的产物目录默认不算引用点**，不会静默污染口径。
 * ② **按 basename 匹配，不按全路径。** SKILL.md 里写 `A-discovery/andyngo-task.md`
 *    （相对 references/），若按全路径比就会漏。
 * ③ **剥注释后**再匹配 —— 注释里的提及只证明「有人知道它存在」，不证明「会去用它」。
 *
 * ── 与同源兄弟的分工边界（DEC-035：加判据前必须先回答「有没有同源兄弟」）──────
 *   `card-entry-coverage.sh` / `card-entry-coverage2.js` —— **入口名**层：
 *      规格速查卡的 9 个入口**名字**在不在 SKILL.md 里（检查面 = 9 个入口）
 *   `spec-sync-measure.js`                              —— **内容一致性**层：
 *      §3.N 的**代码文本** ↔ 磁盘（检查面 = 22 段的文本，只读测量）
 *   **本判据**                                          —— **文件可达性**层：
 *      §3.N 的**每个文件**有没有引用点（检查面 = 22 个文件的引用图）
 *   **`card-entry-coverage` 绿 ≠ 本判据绿**：`security` 入口存在（前者绿），
 *   但 `andyngo-security-scan.sh` 曾零引用（后者红）—— 「入口在」不等于
 *   「入口背后要用的工具有人指向」。**这正是本判据的独立价值。**
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');   // .check/tests -> .workbuddy-ai
/* ★ 结构上排除**本判据自身** —— 否则「判据代码里写下某个规格文件名」会构成自证引用点。
 *   靠注释剥除只能挡住注释；一旦有人把它写进**非注释代码**（例如一张豁免清单），
 *   判据就会给自己发一张永久绿卡。**自指必须靠结构排除，不能靠推理**（同 ISS-070）。 */
const SELF = path.relative(ROOT, __filename).replace(/\\/g, '/');

/* ---- 白名单：活文件 = 会被人/模型/宿主读到并照着做的文件 ----
 * ★ 必须是白名单（理由见文件头 ①）。新出现的产物目录默认**不算**引用点。 */
const ALLOW = [
  /^(SOUL|MODE|MEMORY|IDENTITY|USER)\.md$/,        // 常驻注入层
  /^refs\/[^/]+\.md$/,                               // 引用层
  /^skills\/[^/]+\/(SKILL|MODULE)\.md$/,             // skill 入口
  /^skills\/[^/]+\/references\/.+\.md$/,             // skill 参考文档
  /^skills\/.+\.(js|sh)$/,                           // skill 配套脚本
  /^\.check\/[^/]+\.(js|sh)$/,                       // .check 顶层判据
  /^\.check\/tests\/.+\.(js|sh)$/,                   // 测试
  /^\.check\/record\/[^/]+\.(js|sh)$/,               // 记录层**机制**（不含 .md 记录）
  /^settings\.json$/,
];

function collect() {
  const out = [];
  (function walk(dir) {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      const rel = path.relative(ROOT, p).replace(/\\/g, '/');
      if (/^\.backup-|node_modules|^logs\/|^\.git\/|^traces\//.test(rel)) continue;
      if (rel === SELF) continue;                    // 自指：结构上排除（见上）
      if (e.isDirectory()) walk(p);
      else if (ALLOW.some((re) => re.test(rel))) {
        let text;
        try { text = fs.readFileSync(p, 'utf8'); } catch (e2) { continue; }
        out.push({ rel, text });
      }
    }
  })(ROOT);
  return out;
}

function stripComments(text, isSh) {
  let t = text;
  if (!isSh) t = t.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return t.split('\n').map((l) => {
    const s = l.trim();
    if (s.startsWith('#')) return '';
    if (!isSh) { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; }
    return l;
  }).join('\n');
}

/* ---- 路径容错：POSIX `/c/...` → Windows `C:/...` ----
 * 为什么判据**自己**做这件事，而不是要求调用方先转（既有做法是调用方 `win()` 转换）：
 * 「给原生 node.exe 传 /c/... 会被解析成 C:\c\...」是本项目**踩过两次**的坑
 * （judge-selftest.sh 第 11 行有记）。让**每个**调用方都记得转，是把正确性押在纪律上；
 * 让**判据自己**容错，才是机制。**路径格式错 ≠ 判据发现问题** —— 拒跑会让人以为判据坏了。
 * 拆成纯函数 `posixToWin` 是为了能被双向测覆盖（`toWin` 带 platform 分支，测不到）。 */
function posixToWin(p) {
  const m = /^\/([a-zA-Z])\/(.*)$/.exec(String(p));
  return m ? m[1].toUpperCase() + ':/' + m[2] : p;
}
function toWin(p) {
  return process.platform === 'win32' ? posixToWin(p) : p;
}

/* ---- 纯函数：扫描（双向测直接调它，不碰磁盘）---- */
function scan(specText, files) {
  const secs = [];
  String(specText).replace(/\r\n/g, '\n').split('\n').forEach((l) => {
    const m = /^## (3\.\d+) (.+)$/.exec(l);
    if (m) secs.push({ id: m[1], file: m[2].trim() });
  });
  const rows = [];
  for (const s of secs) {
    const rel = s.file.replace(/^skills[\\/]andyngo[\\/]/, '');
    const base = rel.split('/').pop();
    const selfRel = 'skills/andyngo/' + rel;
    const hits = [];
    for (const f of files) {
      if (f.rel === selfRel) continue;                       // 文件自身不算引用点
      const isSh = /\.sh$/.test(f.rel);
      if (!stripComments(f.text, isSh).includes(base)) continue;
      hits.push(f.rel);
    }
    rows.push({ id: s.id, file: s.file, base, hits });
  }
  return rows;
}

/* ---- 双向测 ---- */
const F = (rel, text) => ({ rel, text });
const INJECT = [
  { name: 'INJECT_ONE  一个零引用点必须被抓到',
    spec: '## 3.1 skills/andyngo/a.md\n## 3.2 skills/andyngo/zzz-nope.md\n',
    files: [F('skills/andyngo/SKILL.md', '见 a.md 的说明')],
    wantZero: ['zzz-nope.md'] },
  { name: 'INJECT_TWO  两个零引用点必须都抓到',
    spec: '## 3.1 skills/andyngo/zzz-nope1.md\n## 3.2 skills/andyngo/zzz-nope2.md\n',
    files: [F('skills/andyngo/SKILL.md', '什么都不提')],
    wantZero: ['zzz-nope1.md', 'zzz-nope2.md'] },
  { name: 'CLEAN       全部有引用点必须干净',
    spec: '## 3.1 skills/andyngo/a.md\n## 3.2 skills/andyngo/b.md\n',
    files: [F('skills/andyngo/SKILL.md', 'a.md 和 b.md 都在这里'), F('refs/x.md', 'a.md')],
    wantZero: [] },
  { name: 'BOUNDARY    按 basename 匹配（别的路径下同名也算）',
    spec: '## 3.1 skills/andyngo/references/A-discovery/andyngo-task.md\n',
    files: [F('skills/andyngo/SKILL.md', '见 A-discovery/andyngo-task.md')],
    wantZero: [] },
  { name: 'BOUNDARY    文件自身的出现不算引用点',
    spec: '## 3.1 skills/andyngo/references/selfref.md\n',
    files: [F('skills/andyngo/references/selfref.md', '本文件叫 selfref.md'), F('refs/x.md', '无关')],
    wantZero: ['selfref.md'] },
];

function runInject() {
  let bad = 0, n = 0;
  for (const t of INJECT) {
    n++;
    const rows = scan(t.spec, t.files);
    const zero = rows.filter((r) => r.hits.length === 0).map((r) => r.base).sort();
    const want = t.wantZero.slice().sort();
    const ok = JSON.stringify(zero) === JSON.stringify(want);
    if (!ok) bad++;
    console.log((ok ? '[PASS] ' : '[FAIL] ') + t.name +
      '  得 ' + JSON.stringify(zero) + ' 期 ' + JSON.stringify(want));
  }
  /* 计数自检：判据自己数的段数对不对 */
  const self = scan('## 3.1 x\n## 3.2 y\n## 3.3 z\n', []);
  n++;
  const okCount = self.length === 3;
  if (!okCount) bad++;
  console.log((okCount ? '[PASS] ' : '[FAIL] ') + 'COUNT       段数自检 得 ' + self.length + ' 期 3');
  /* 路径容错自测（POSIX → Windows） */
  const PC = [['/c/Users/x/a.txt', 'C:/Users/x/a.txt'], ['C:/Users/x/a.txt', 'C:/Users/x/a.txt'], ['/tmp/a.txt', '/tmp/a.txt']];
  for (const [got, want] of PC) {
    n++;
    const okP = posixToWin(got) === want;
    if (!okP) bad++;
    console.log((okP ? '[PASS] ' : '[FAIL] ') + 'PATH        posixToWin(' + got + ') 得 ' + posixToWin(got) + ' 期 ' + want);
  }
  console.log('');
  console.log(bad ? '双向测：' + bad + '/' + n + ' 项失败' : '双向测：' + n + '/' + n + ' 全部通过');
  return bad ? 1 : 0;
}

/* ---- 主流程 ---- */
const argv = process.argv.slice(2);
const isInject = argv.includes('--inject');
const isReport = argv.includes('--report');
const rest = argv.filter((a) => !a.startsWith('--'));
const specArg = toWin(rest[0] || process.env.ANDYNGO_SPEC || '<项目外文件>');

if (isInject) process.exit(runInject());

let specText;
try { specText = fs.readFileSync(specArg, 'utf8'); }
catch (e) {
  console.log('拒跑：读不到规格 ' + specArg);
  console.log('（判据不猜默认路径就往下跑 —— 那会产出一片假红）');
  process.exit(2);
}

const files = collect();
const rows = scan(specText, files);
const zero = rows.filter((r) => r.hits.length === 0);

if (isReport) {
  console.log('活文件面 = ' + files.length + ' 个（白名单口径）');
  console.log('规格 §3.N 段数 = ' + rows.length + ' · 零引用点 = ' + zero.length);
  console.log('');
  console.log('| 段 | 文件 | 引用点数 | 引用点 |');
  console.log('|---|---|---|---|');
  for (const r of rows) {
    console.log('| ' + r.id + ' | `' + r.base + '` | ' + r.hits.length + ' | ' +
      (r.hits.length ? r.hits.slice(0, 4).join(' · ') + (r.hits.length > 4 ? ' …' : '') : '**（无）**') + ' |');
  }
  process.exit(0);
}

if (zero.length === 0) {
  console.log('OK  规格 §3.N 共 ' + rows.length + ' 个文件，全部有引用点（活文件面 ' + files.length + ' 个）');
  process.exit(0);
}
console.log('HIT 规格 §3.N 共 ' + rows.length + ' 个文件，其中 ' + zero.length + ' 个**零引用点**：');
for (const r of zero) console.log('   §' + r.id + '  ' + r.base + '   （' + r.file + '）');
console.log('');
console.log('零引用点 = 规格要求它存在、但**没有任何通道能到达它** ——');
console.log('模型不会去读一个没人提过的文件，所以它等于不存在。');
console.log('修法：给它一个引用点（SKILL.md 的必读表 / 对应事件的 reference 文档）。');
process.exit(1);
