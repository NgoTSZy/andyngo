#!/usr/bin/env node
/* ruler-callpoint.js —— **尺子必须有「可执行调用点」**（ISS-134 的根因判据 · ISS-135）
 *
 * ── 为什么需要它 ─────────────────────────────────────────────────────────
 * ISS-134 记的是「`.check/tests/` 下两把尺子**调用点 0 个**」——
 * 而它是**我手工 `grep` 出来的**。**「尺子有没有调用点」这件事当时没有判据。**
 * 本仓库老话：「**一个不会响的守门人比没有守门人更坏**」——
 * 而比这更坏的是：**「守门人有没有上岗」这件事本身没人管**。
 * 所以本条判据管的不是「尺子判得对不对」，是「**尺子有没有被接上**」。
 *
 * ── 什么算「可执行调用点」────────────────────────────────────────────────
 * 在 `<root>/skills/**` 或 `<root>/.check/**` 的 **`.sh` / `.js`** 文件里**出现该文件名**，
 * **且不在注释里**（先剥注释再判）。
 *   · **`.md` 不算** —— 文档里提到不是执行（ISS-134 的第一版粗糙扫描就栽在这里：
 *     它把「记录层里提到」也算成调用点，于是两把真没接的尺子都显示「有调用点」）。
 *   · **注释不算**（ISS-138）—— `.js` / `.sh` 的注释**同样不是执行**。
 *     ISS-135 当时只排除了 `.md`，于是 `battery-relative.js` 里**一行注释**提到的
 *     `x1-freshness-test.sh` 就被算成了它的调用点。**那一轮结论碰巧是对的**
 *     （那把尺子另有真调用点）⇒ 这**不是假绿事故**，是一个**还没响的洞**。
 *     实现用 `.check/strip-comments.js`（与 `probe-crossref.js` 的 X1 **同一份口径**）。
 *   · **字符串字面量不剥** —— `bash -c "…x.js"` 是**真执行**，剥字符串会造**假红**；
 *     所以**只剥注释**，残余风险如实记在 `strip-comments.js` 文件头。
 *   · 排除：**自身** · `.check/record/`（记录层）· `.check/audit/`（历史报告）
 *     · `.check/artifact-index/` · `.check/changes-detail/` · `node_modules/`。
 *
 * ── 规则 ────────────────────────────────────────────────────────────────
 *   R1  每个 `.check/tests/*` 文件必须有 **≥1** 个可执行调用点
 *   R2  R1 不过的，必须在豁免表里**逐条登记**：`EXEMPT <文件名> <类别> <原因>`
 *       类别 ∈ {手工仪器, 工具非尺子, 冻结件手工}；**原因不得少于 8 个字**
 *   R3  豁免表的每一条必须指向**磁盘上真实存在**的文件（**悬空豁免报红**）
 *   R4  豁免表里**不得**出现「其实已经有调用点」的条目（**多余豁免报红** ——
 *       否则豁免表会变成「把判据弄瞎」的入口，同 DEC-026 家族）
 *
 * 用法：
 *   node .check/tests/ruler-callpoint.js               # 扫真仓库
 *   node .check/tests/ruler-callpoint.js <repoRoot>    # 扫指定根（给 `--inject` 夹具用）
 *   node .check/tests/ruler-callpoint.js --inject      # 双向测（造夹具，不动真盘）
 * 退出码：0 合规 · 1 有违规 · 2 拒跑（参数/环境错）
 */
'use strict';
const fs = require('fs');
const path = require('path');
/* ★ 与 `probe-crossref.js` 的 X1 **同一份口径**（ISS-138）—— 实现住在共享模块里，
 *   不在这里复制（**复制会静默分叉**）。`require` 按**本文件**所在目录解析，
 *   所以 `--inject` 造出来的合成根**不影响**它。 */
const { stripComments } = require('../strip-comments.js');

const REPO = path.resolve(__dirname, '..', '..');
const argv = process.argv.slice(2);
const isInject = argv.includes('--inject');
const ROOT = path.resolve(argv.find((a) => !a.startsWith('--')) || REPO);

const die = (msg) => { console.error('UNVERIFIED ' + msg); process.exit(2); };

if (!fs.existsSync(ROOT) || !fs.statSync(ROOT).isDirectory()) die('根不存在：' + ROOT);

const TESTS = path.join(ROOT, '.check', 'tests');
const EXEMPT_FILE = path.join(ROOT, '.check', 'record', 'ruler-callpoint-exemptions.md');
const SCAN_DIRS = [path.join(ROOT, 'skills'), path.join(ROOT, '.check')];
/* 这些子树**不是「能执行它的地方」**：记录层 / 历史报告 / 重型索引 / 一次性草稿区。 */
const SKIP_REL = ['.check/record', '.check/audit', '.check/artifact-index',
                  '.check/changes-detail', 'node_modules',
                  /* ★ 2026-09-17 加：`.check/tmp` 是**草稿/构建产物区**，不是仓库的一部分。
                   * 实测踩到两次：① 演练骨架 `.check/tmp/drill{,2}` 被当成「第二个调用点」，
                   * ② 发布副本 `.check/tmp/publish/` 里那份 `.check/` 让 `andyngo-manifest.js` 与
                   * `i5-bidirectional-test.sh` 凭空多出 1 个调用点 ⇒ **R4 多余豁免报红**。
                   * 第一次的处置是「把 drill 搬走」—— 那是**纪律修法**，所以同形事故又来了第二次。
                   * 这一行才是机制修法：**草稿区里的调用点不算数**。 */
                  '.check/tmp'];
const CLASSES = ['手工仪器', '工具非尺子', '冻结件手工'];

if (!fs.existsSync(TESTS)) die('找不到 ' + TESTS);

/* ── 可执行调用点 ──────────────────────────────────────────────────────── */
function execCallPoints(name, selfPath) {
  const hits = [];
  const walk = (d) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const q = path.join(d, e.name);
      const rel = path.relative(ROOT, q).split(path.sep).join('/');
      if (SKIP_REL.some((s) => rel === s || rel.startsWith(s + '/'))) continue;
      if (e.isDirectory()) { walk(q); continue; }
      if (!/\.(sh|js)$/.test(e.name)) continue;      /* .md 不算：文档里提到 ≠ 执行 */
      if (path.resolve(q) === path.resolve(selfPath)) continue;
      let t;
      try { t = fs.readFileSync(q, 'utf8'); } catch { continue; }
      /* ★ 注释不算（ISS-138）—— **先剥注释再判**，口径同 `probe-crossref.js` 的 X1。 */
      if (stripComments(t, /\.sh$/.test(e.name)).includes(name)) hits.push(rel);
    }
  };
  for (const d of SCAN_DIRS) if (fs.existsSync(d)) walk(d);
  return hits.sort();
}

/* ── 豁免表 ────────────────────────────────────────────────────────────── */
function loadExempt() {
  const m = new Map();
  if (!fs.existsSync(EXEMPT_FILE)) return m;
  for (const l of fs.readFileSync(EXEMPT_FILE, 'utf8').replace(/\r\n/g, '\n').split('\n')) {
    const x = /^EXEMPT\s+(\S+)\s+(\S+)\s+(.+)$/.exec(l.trim());
    if (x) m.set(x[1], { cls: x[2], why: x[3].trim() });
  }
  return m;
}

/* ── 双向测（--inject）：造夹具，跑**同一份逻辑** ───────────────────────────
 * ⑤ 是**假红守门人**（反向的另一半）：无关变异**不得**报红 ——
 * 总是响的警报等于没有警报。 */
if (isInject) {
  const { spawnSync } = require('child_process');
  const os = require('os');
  const run = (root) => {
    const r = spawnSync(process.execPath, [__filename, root], { encoding: 'utf8' });
    return { rc: r.status, out: (r.stdout || '') + (r.stderr || '') };
  };
  /* 造一个**最小合成根**（不复制真仓库：真仓库太重，且夹具应当只含被检形状）。 */
  const mk = ({ wired = true, exempt = null, ghost = false, whyShort = false, extraMd = false,
                commentOnly = null, trailing = false }) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ruler-cp-'));
    fs.mkdirSync(path.join(d, '.check', 'tests'), { recursive: true });
    fs.mkdirSync(path.join(d, '.check', 'record'), { recursive: true });
    fs.mkdirSync(path.join(d, 'skills', 'andy', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(d, '.check', 'tests', 'real-ruler.sh'), '#!/usr/bin/env bash\nexit 0\n');
    fs.writeFileSync(path.join(d, '.check', 'tests', 'orphan-ruler.sh'), '#!/usr/bin/env bash\nexit 0\n');
    let call;
    if (commentOnly === 'sh') {
      /* 只在**整行 shell 注释**里提到 —— 不是执行，orphan 必须仍然「未接」。 */
      call = '# 见 .check/tests/orphan-ruler.sh\nbash .check/tests/real-ruler.sh\n';
    } else if (commentOnly === 'js') {
      /* 调用点只在 `.js` 的**块注释 / 行注释**里 —— 同样不是执行。 */
      call = 'bash .check/tests/real-ruler.sh\n';
      fs.writeFileSync(path.join(d, 'skills', 'andy', 'scripts', 'helper.js'),
        '/* 见 .check/tests/orphan-ruler.sh */\n// 见 .check/tests/orphan-ruler.sh\n');
    } else if (trailing) {
      /* **行尾注释的真实调用** —— 名字在**代码部分**，必须**算**调用点（不许过度剥）。 */
      call = 'bash .check/tests/real-ruler.sh # 说明\n' +
             'bash .check/tests/orphan-ruler.sh # 说明\n';
    } else {
      call = wired
        ? 'bash .check/tests/real-ruler.sh\nbash .check/tests/orphan-ruler.sh\n'
        : 'bash .check/tests/real-ruler.sh\n';
    }
    fs.writeFileSync(path.join(d, 'skills', 'andy', 'scripts', 'andy-audit.sh'), call);
    if (extraMd) {
      fs.writeFileSync(path.join(d, 'skills', 'andy', 'README.md'), '见 .check/tests/orphan-ruler.sh\n');
    }
    if (exempt !== null || ghost) {
      const why = whyShort ? '短' : '这是一个足够长的、说明得清楚的原因。';
      const line = ghost
        ? 'EXEMPT ghost-ruler.sh 工具非尺子 ' + why
        : 'EXEMPT orphan-ruler.sh ' + exempt + ' ' + why;
      fs.writeFileSync(path.join(d, '.check', 'record', 'ruler-callpoint-exemptions.md'),
        '# 尺子调用点 · 豁免表\n\n' + line + '\n');
    }
    return d;
  };

  const CASES = [
    ['① 未接的尺子 → 必红（R1 · ISS-134 的形状）', mk({ wired: false }), 1, 'R1'],
    ['② 登记进豁免表 → 必绿（R2 生效）', mk({ wired: false, exempt: '手工仪器' }), 0, null],
    ['③ 悬空豁免（登记了不存在的文件）→ 必红（R3）', mk({ ghost: true }), 1, 'R3'],
    ['④ 豁免原因太短 → 必红（R2 原因下限）', mk({ wired: false, exempt: '手工仪器', whyShort: true }), 1, 'R2'],
    ['⑤ 假红守门人：`.md` 里提到 ≠ 调用点 → 仍然必红（口径不许放宽）', mk({ wired: false, extraMd: true }), 1, 'R1'],
    ['⑥ 假红守门人：无关变异（没有未接的尺子）→ 必须 rc=0', mk({ wired: true }), 0, null],
    /* ★ 以下三条是 ISS-138 的成对断言 —— **修法剥了注释，就必须证明两个方向都没坏**：
     *   ⑦⑧ 证明「注释**不再**冒充调用点」（真阳性：该红的仍然红）；
     *   ⑨ 证明「剥注释**没有**过度」（假红守门人：行尾注释的真实调用仍算数）。 */
    ['⑦ 真阳性：只在**整行 shell 注释**里提到 → 必须仍然报红（注释不是执行 · ISS-138）',
      mk({ commentOnly: 'sh' }), 1, 'R1'],
    ['⑧ 真阳性：只在 **`.js` 注释**（块注释 + 行注释）里提到 → 必须仍然报红（ISS-138）',
      mk({ commentOnly: 'js' }), 1, 'R1'],
    ['⑨ 假红守门人：**行尾注释**的真实调用 → 必须 rc=0（不许过度剥）',
      mk({ trailing: true }), 0, null],
  ];

  let P = 0, F = 0;
  for (const [title, root, wantRc, wantRule] of CASES) {
    const r = run(root);
    if (r.rc === wantRc && (wantRule === null || r.out.includes(wantRule))) {
      console.log('  PASS ' + title + '（rc=' + r.rc + (wantRule ? ' · 命中 ' + wantRule : '') + '）');
      P++;
    } else {
      console.log('  FAIL ' + title + '（rc=' + r.rc + ' · 期望 rc=' + wantRc +
                  (wantRule ? ' 且命中 ' + wantRule : '') + '）');
      console.log('        ' + r.out.trim().split('\n').slice(-3).join('\n        '));
      F++;
    }
  }
  console.log('');
  console.log('合计：PASS ' + P + ' / FAIL ' + F);
  process.exit(F > 0 ? 1 : 0);
}

/* ── 正向判定 ──────────────────────────────────────────────────────────── */
const rulers = fs.readdirSync(TESTS).filter((n) => fs.statSync(path.join(TESTS, n)).isFile()).sort();
const exempt = loadExempt();
const V = [];
const report = [];

for (const name of rulers) {
  const self = path.join(TESTS, name);
  const hits = execCallPoints(name, self);
  const ex = exempt.get(name);
  report.push({ name, hits, ex });
  if (hits.length === 0) {
    if (!ex) {
      V.push('R1 未接：`.check/tests/' + name + '` **可执行调用点 0 个**，且**未在豁免表登记**\n' +
             '       （判据不跑等于没有判据 —— ISS-134。要么接进载体，要么在 ' +
             '.check/record/ruler-callpoint-exemptions.md 逐条登记并写原因）');
    } else {
      if (CLASSES.indexOf(ex.cls) < 0) {
        V.push('R2 `.check/tests/' + name + '` 豁免类别 `' + ex.cls + '` 不合法（合法：' +
               CLASSES.join(' / ') + '）');
      }
      if (ex.why.length < 8) {
        V.push('R2 `.check/tests/' + name + '` 豁免原因只有 ' + ex.why.length +
               ' 个字（< 8）—— 没写清楚为什么它可以不接');
      }
    }
  } else if (ex) {
    V.push('R4 多余豁免：`.check/tests/' + name + '` 其实**已经有 ' + hits.length +
           ' 个调用点**（' + hits.slice(0, 3).join(' · ') + '），却还登记在豁免表里\n' +
           '       —— 豁免表不得成为「把判据弄瞎」的入口（DEC-026 家族），请删掉这条');
  }
}

for (const [name, ex] of exempt) {
  if (!fs.existsSync(path.join(TESTS, name))) {
    V.push('R3 悬空豁免：豁免表登记了 `' + name + '`，但 `.check/tests/' + name + '` **不存在**');
  }
  if (ex.cls && CLASSES.indexOf(ex.cls) < 0) {
    V.push('R2 悬空豁免条目 `' + name + '` 的类别 `' + ex.cls + '` 也不合法');
  }
}

/* ── 打印（含**检查面度量**：逐条打印调用点，不让人只看一个 OK）────────── */
console.log('扫描面：' + rulers.length + ' 个文件（' + path.relative(ROOT, TESTS).split(path.sep).join('/') + '）');
console.log('豁免表：' + (fs.existsSync(EXEMPT_FILE) ? exempt.size + ' 条' : '不存在（视为空表）'));
for (const r of report) {
  const tag = r.hits.length > 0 ? '接 ' + String(r.hits.length).padStart(2) + ' 处'
                                : (r.ex ? '豁免（' + r.ex.cls + '）' : '**未接**');
  console.log('  ' + r.name.padEnd(30) + tag +
              (r.hits.length ? '  ← ' + r.hits.slice(0, 2).join(' · ') +
                               (r.hits.length > 2 ? ' …' : '') : ''));
}

if (V.length === 0) {
  console.log('');
  console.log('OK   .check/tests/ 下 ' + rulers.length + ' 个文件**全部**有可执行调用点，' +
              '或已在豁免表逐条登记（' + exempt.size + ' 条）');
  process.exit(0);
}
console.log('');
console.log('HIT 有 ' + V.length + ' 处违规：');
for (const v of V) console.log('  x ' + v);
console.log('');
console.log('★ 判据不跑等于没有判据（ISS-105）。**接进载体**或**逐条登记豁免**，二选一，没有第三条路。');
process.exit(1);
