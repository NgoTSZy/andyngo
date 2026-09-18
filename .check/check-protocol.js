#!/usr/bin/env node
'use strict';
/* check-protocol.js —— 协议文件的自动化校验器（零依赖）
 *
 * 为什么存在：
 *   验收代理丙的元发现 —— 「协议文件当前**零自动化校验**，这三处新冲突
 *   不会有任何东西报出来。」（丙的 D2 / D3 / D6 就是这么漏过去的）
 *   SOUL：「先把检查变成可枚举的，再谈「下次注意」。」
 *
 * 三态，**拿不到证据时不许报 PASS**：
 *   PASS / FAIL / UNVERIFIED
 *
 * 用法：
 *   node check-protocol.js            # 校验
 *   node check-protocol.js --mutate   # 变异测试：证明这 8 条检查**有齿**
 *
 * 检查项：
 *   C1 目录 → 正文      目录每一行都有对应 `## ` 标题
 *   C2 正文 → 目录      每个 `## ` 标题都在目录里登记
 *   C3 单值量           同一个量（如「合并后文件数」）全文件只有一个值
 *   C4 ASK 配额         口径唯一，且旧口径（1 次）不残留
 *   C5 活引用           提到的 ~/.workbuddy-ai 路径真实存在（豁免须有覆盖者）
 *   C6 跨文件锚点       指向另一个文件的 `模板 X` / `铁律X` 真的存在
 *   C7 「已落」可核对   声明已落必须自带 grep 命令（历史区域豁免，但**打印出来**）
 *   C8 真的跑核对命令   把 C7 找到的 grep 实际执行，比对期望值
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const HOME = path.resolve(__dirname, '..');
const MODE = path.join(HOME, 'MODE.md');
/* 【2026-09-15 期 1】MODE.md 拆成「核心 + 附录桩」，附录正文搬到 refs/。
 * 为什么检查器必须跟着改：**拆文件不等于内容少了** —— 只是换了存放位置。
 * 如果 C3/C5/C6 只扫 MODE.md，那拆出去的那些「已落」声明、活引用、跨文件锚点
 * 就**从被检查的对象里消失**了 —— 检查器会照样报 PASS，而 PASS 是假的。
 * 「一个把「我失败了」和「我成功了」塞进同一个返回值的函数，下游指标必然把告示牌当合格证。」
 * 所以：**内容搬家，检查范围必须跟着搬。**
 * 文件集的定义在 fileset.js —— 只此一份（run-battery.js 也 require 它）。 */
const { buildFileSet, REFS } = require('./fileset.js');

/* 读 MODE.md。
 * 行尾符规范化**不在这里** —— 它在 run() 里（唯一的必经之路）。
 * 踩过（2026-09-15，hook 的第一次真实测试）：校验器按 '\n' 切行、正则用 `$` 收尾，
 * 而 `$`（无 m 标志）只匹配串尾 —— CRLF 文件里每行尾部多一个 \r，`.+$` 就匹配不上，
 * 于是 C1/C2 报「找不到 `## 目录` / 正文一个 `## ` 标题都没有」，**归因全错**
 * （说「检查器失效」，真因是**行尾符**）。
 * 而 Windows 上的编辑器（以及 hook 收到的文件）默认就可能写 CRLF。 */
function readMode() {
  return fs.readFileSync(MODE, 'utf8');
}

/* 【2026-09-15 加，D16】`--file <path>`：独立测试者的入口。
 * 没有它，测试者只能自己抽 run()（那层胶水出 bug 会被归因到检查器头上）。 */
function readTarget() {
  const i = argv.indexOf('--file');
  if (i < 0) {
    const fsx = buildFileSet();
    return { text: fsx.text, file: MODE, segs: fsx.segs, frozen: fsx.frozenSkipped, revived: fsx.frozenRevived };
  }
  const p = argv[i + 1];
  if (!p || p.startsWith('--')) { console.error('FAIL --file 后面缺路径'); process.exit(2); }
  const file = path.resolve(p);
  if (!fs.existsSync(file)) { console.error('FAIL --file 指的文件不存在：' + file); process.exit(2); }
  return { text: fs.readFileSync(file, 'utf8'), file, segs: null };
}

/* 【2026-09-15 加】极简 glob 展开（只支持 `*` 与 `?`，逐段下钻）。
 * 存在性检查对通配形态**不能**用字面 existsSync —— 那会把一个模式当成一个文件。 */
function globExists(rel) {
  let dirs = [HOME];
  for (const seg of rel.replace(/<[^>]*>/g, '*').split('/')) {
    const next = [];
    for (const d of dirs) {
      if (!/[*?]/.test(seg)) {
        const q = path.join(d, seg);
        if (fs.existsSync(q)) next.push(q);
        continue;
      }
      const rx = new RegExp('^' + seg.replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*').replace(/\?/g, '.') + '$');
      let list = [];
      try { list = fs.readdirSync(d); } catch (e) { list = []; }
      for (const e of list) if (rx.test(e)) next.push(path.join(d, e));
    }
    dirs = next;
    if (!dirs.length) return false;
  }
  return dirs.length > 0;
}

const results = [];
function check(id, name, fn) {
  const r = { id, name, fails: [], notes: [], state: 'PASS' };
  try { fn(r); } catch (e) { r.state = 'UNVERIFIED'; r.notes.push('检查器自身抛错：' + e.message); }
  if (r.fails.length) r.state = 'FAIL';
  results.push(r);
}

// ---------------------------------------------------------------- 解析器

function parseTocLabels(lines) {
  // 【2026-09-15 修，第三方-2 N20】标题允许**前导空白** —— CommonMark 里 `  ## 标题` 就是标题。
  // 原来锚死 `^## `，于是缩进过的标题被当成「不存在」。
  let i0 = -1;
  for (let i = 0; i < lines.length; i++) if (/^\s*##\s*目录\s*$/.test(lines[i])) { i0 = i; break; }
  if (i0 < 0) return null;
  let i1 = lines.length;
  for (let i = i0 + 1; i < lines.length; i++) if (/^\s*## /.test(lines[i])) { i1 = i; break; }
  const out = [];
  for (const l of lines.slice(i0 + 1, i1)) {
    // 放开到「任意编号 / 任意附录字母」—— 原来写死 0-6 与 A-E，
    // 于是**认不出的新标签直接逃过 C1**（踩过：目录里插一行 **7** 时 C1 全绿）。
    // 这与 SOUL「裸的允许清单是下一次静默放行的入口」同族：
    // 一份写死的白名单，会把它没列到的东西当成不存在。
    // 【2026-09-15 修，第三方变异 E10】原来锚死 `^\|` —— **行首多一个空格，整行就不被解析**。
    // 表格缩进、编辑器自动对齐、手工对齐都可能引入前导空格。
    // 而"没被解析"和"不存在"在输出上无法区分 —— 一张写死的锚点，
    // 会把它没匹配到的东西当成不存在（SOUL：裸的允许清单是下一次静默放行的入口）。
    /* 【2026-09-15 修，第四个测试者 F01】原来要求标签**必须带粗体** ——
     * 于是 `| 7 | 幽灵节 | — |`（不带粗体）整行不被解析，C1 看不见它。
     * **「没被解析」和「不存在」在输出上无法区分** —— 与上面 E10 那条同一个病。
     * 现在粗体可有可无。放宽的边界由**区块**兜住：目录区块被 `## 目录` 与下一个 `## ` 夹住，
     * 区块里没有别的以数字开头的表格行，所以放宽的代价可控。 */
    /* 【修·第五次，第二轮 G16】改成**整格匹配**：允许 `| **7、** |` 这种带分隔符的写法。
     * 原来只认 `| **7** |`，于是「目录与正文都写顿号」这一对**互不匹配** ——
     * C1 与 C2 各报一次假红（两边都说对方没有）。
     * **同一件事的两侧判据必须同一把尺子。** */
    const m = l.match(/^\s*\|\s*(.+?)\s*\|/);
    if (m) {
      const cell = m[1].replace(/[*_\s]+/g, '').replace(/[.、．)）]$/, '');
      if (/^(?:[0-9]+|附录[A-Z])$/.test(cell)) {
        out.push(cell.startsWith('附录') ? ('附录 ' + cell.slice(2)) : cell);
      }
    }
  }
  return out;
}

/* 【2026-09-15 加，第三方变异 E11】把代码围栏内的行清空。
 * 契约缺口：围栏里的 `## ` **不是章节** —— 它是一段被引用的示例文本。
 * 原来的 C1 拿全文找 `## X`，于是「目录登记一个只存在于围栏里的章节」能全绿：
 * 检查器把**引用**当成了**定义**。
 * 与 SOUL「判代码先剥注释」同族 —— 先剥掉不是内容的东西，再判内容。 */
function stripFences(lines) {
  // 【2026-09-15 修，第三方-2 N21】围栏标记有两种：三个反引号 **和三个波浪号**。
  // 只认前者时，用 `~~~` 围起来的示例里的 `## 标题` 会被当成真章节 ——
  // 于是「目录登记一个只存在于围栏里的章节」又能过。
  const out = lines.slice();
  let inFence = false;
  for (let i = 0; i < out.length; i++) {
    if (/^\s*(?:```|~~~)/.test(out[i])) { inFence = !inFence; out[i] = ''; continue; }
    if (inFence) out[i] = '';
  }
  return out;
}

/* 【2026-09-15 删】carvedSections / sectionOfLine 两个函数已移除。
   它们实现的是「按附录整块豁免核对要求」—— 验收代理 D13 证明这个口径太宽：
   豁免区里有 4 条「已落」的目标本身可核对。现在 C7 改成逐行豁免（命令 或 显式「不可核对：」）。
   删掉而不是留着：**一段没人调用的代码，是下一次有人误用它的时候才付账。** */

// ---------------------------------------------------------------- 检查

function run(rawText, targetPath, segments) {
  // 【2026-09-15 加，D16】被测文件路径。默认 MODE.md；`--file` 可换成任意副本。
  const TARGET = targetPath || MODE;
  /* 【2026-09-15 期 1】文件集模式：segments 非空时，rawText 是 MODE.md + refs/*.md 的拼接。
   * 每一行要知道**自己来自哪个文件**，否则报出来的「行 N」指向另一个文件 ——
   * 那是归因错误，比不报还坏。 */
  const SEGS = segments || null;
  const text = String(rawText).replace(/\r\n/g, '\n');
  results.length = 0;      // 【必须】不清空的话多次 run 会**累加**，归因全错

  // ================================================================ 前端
  /* 【2026-09-15 加，D17 —— 第三个独立测试者的 36 条逃逸 / 5 条假红】
   * 之前 8 条检查各自用正则去**猜**文档结构，于是每一个字形变化都要单独补一条规则：
   *   `##\t7.` / `- ## 7.` / 4 空格缩进 / 零宽前缀 / `##6.` / 全角空格 / NBSP ……
   * 补到最后拿到的不是「有齿的检查器」，是「恰好能过上一轮那批反例的检查器」。
   * 改成**一次解析成结构模型，8 条检查都读模型**：
   *   · 标题按 CommonMark 的 ATX / setext 规则认（不是按 `## ` 这个字面串）
   *   · 代码围栏、代码跨度、「」引述先标成「不是内容」
   *   · 单元格、数字词、箭头都**归一化之后**再比
   * **结构的变化是有限的，字形的变化是无限的。**
   */
  const ZW_RE = /[\u200B-\u200F\u2060\uFEFF\u00AD]/g;
  // 折叠：去零宽/软连字符 + NFKC（顺带解决全角数字、全角空格、NBSP、圈码 ①→1）
  const fold = (s) => String(s).replace(ZW_RE, '').normalize('NFKC');

  const CN_NUM = { '一':1, '二':2, '两':2, '三':3, '四':4, '五':5, '六':6, '七':7, '八':8, '九':9, '十':10 };
  /* 数字词 → 数。**比数字，不比写法。** 归一化之后 `铁律 15` / `铁律十五` / `铁律⑮` 是同一个值。 */
  function numTok(s) {
    const f = fold(s).trim();
    if (/^[0-9]+$/.test(f)) return parseInt(f, 10);
    if (!/^[一二三四五六七八九十两]+$/.test(f)) return null;
    if (f === '十') return 10;
    const i = f.indexOf('十');
    if (i < 0) return f.split('').reduce((a, c) => a * 10 + CN_NUM[c], 0);
    const head = i === 0 ? 1 : CN_NUM[f[0]];
    const tail = f.slice(i + 1);
    return head * 10 + (tail ? CN_NUM[tail] : 0);
  }

  /* ATX 标题：缩进 ≤3 空格，1-6 个 `#`，其后**必须是空白或行尾**。
   * `##6.` 因此**不是**标题（CommonMark 如此）—— 于是「把 `## 6.` 写成 `##6.`」
   * 会让第 6 节消失，C1 必须报红（这正是第三个测试者的 M03）。 */
  function atxOf(s) {
    const m = fold(s).match(/^( {0,3})(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/);
    if (!m) return null;
    return { level: m[2].length, text: (m[3] || '').trim() };
  }
  /* 列表项里也能放标题（CommonMark 允许）—— M42 就是靠这个逃的。 */
  function headingOf(line, prevLine) {
    const f = fold(line);
    const li = f.match(/^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+(.*)$/);
    const atx = atxOf(li ? li[1] : f);
    if (atx) return atx;
    /* setext：**只认 `=` 下划线**。`-` 下划线在本文档里与「分节横线」同形，
     * 认它会把每一条 `---` 前面的正文都变成标题 —— 那是制造假红。
     * 代价明写进残洞清单：`-` 下划线的 setext 标题不被认。 */
    const u = f.trim();
    if (/^=+$/.test(u) && prevLine != null) {
      const p = fold(prevLine).trim();
      if (p && !p.startsWith('#') && !p.startsWith('|') && !/^[-*_=+]+$/.test(p)) {
        return { level: 1, text: p };
      }
    }
    return null;
  }

  function codeRanges(s) {
    const out = [];
    let i = 0;
    while (i < s.length) {
      if (s[i] !== '`') { i++; continue; }
      let n = 1;
      while (s[i + n] === '`') n++;
      const close = s.indexOf('`'.repeat(n), i + n);
      if (close < 0) break;
      out.push([i, close + n]);
      i = close + n;
    }
    return out;
  }
  const QUOTE_RE = /「[^」]*」|『[^』]*』/g;
  function quoteRanges(s) {
    const out = [];
    let m;
    QUOTE_RE.lastIndex = 0;
    while ((m = QUOTE_RE.exec(s))) out.push([m.index, m.index + m[0].length]);
    return out;
  }
  const inRanges = (rs, i) => rs.some((q) => i >= q[0] && i < q[1]);

  // 行模型
  const lines = [];
  {
    let inFence = false;
    for (let i = 0; i < text.split('\n').length; i++) {
      const raw = text.split('\n')[i];
      const f = fold(raw);
      const isMark = /^ {0,3}(?:```|~~~)/.test(f);
      if (isMark) { lines.push({ i, raw, f, inFence: true, isMark: true, heading: null }); inFence = !inFence; continue; }
      lines.push({ i, raw, f, inFence, isMark: false, heading: null });
    }
  }
  for (const L of lines) {
    if (L.inFence) continue;
    L.heading = headingOf(L.raw, L.i > 0 ? lines[L.i - 1].raw : null);
  }
  /* 把全局行号还原成「文件:行」。没有 segments（`--file` 副本）时退回纯数字。 */
  if (SEGS) {
    for (const L of lines) {
      let s = SEGS[SEGS.length - 1];
      for (const g of SEGS) if (L.i >= g.start && L.i < g.start + g.count) { s = g; break; }
      L.srcFile = s.file; L.srcLn = L.i - s.start + 1;
    }
  }
  const relName = (p) => path.relative(HOME, p).replace(/\\/g, '/');
  const contentLines = lines.filter((L) => !L.inFence);
  const headings = lines.filter((L) => L.heading);
  const splitCells = (L) => (L.f.includes('|') ? L.f.split('|') : null);
  const ln = (L) => L.i + 1;
  /* loc() 是**给人看的**定位；ln() 是**给程序算的**行号。
   * 两者不能合并 —— C8 里 `lines[g.line - 1]` 真的在做算术。 */
  /* 【2026-09-16 加，ISS-013】把「`文件:行`」这个表达式的**唯一一份实现**放在这里。
   * 原先 `loc(L)` 内联写着它，而 C5/C6 的报错走的是 `info.line`（全局行号）—— 两条路。
   * 修 ISS-013 时我差点再造一个 `siteOf` 内联同一表达式 —— 那就是 fileset.js 开头
   * 警告的「复制两份就会静默分叉」。故抽成 `fmtLoc`，`loc` 与 `siteOf` 都调它。 */
  const fmtLoc = (srcFile, srcLn, fallback) => (srcFile ? relName(srcFile) + ':' + srcLn : String(fallback));
  const loc = (L) => fmtLoc(L.srcFile, L.srcLn, L.i + 1);
  /* C1/C2 只看 MODE.md —— 目录是 MODE.md 的目录，refs/ 里的文件不登记进它。 */
  const isMode = (L) => !SEGS || L.srcFile === MODE;

  // ================================================================ 检查

  // ---- C1 目录 → 正文
  /* 【2026-09-15 改】原来只认 level 2。setext `===` 是 **h1**，而
   * `7. 幽灵` + `===` 仍然是一个**看起来像章节**的标题 —— 只认 level 2 会把它漏掉。
   * 改成 level ≤ 2；`###`/`####` 才是小节，目录不登记。 */
  const h2 = headings.filter((L) => L.heading.level <= 2 && isMode(L));
  check('C1', '目录 → 正文：目录每一行都有对应章节', r => {
    const labels = parseTocLabels(lines.filter(isMode).map((L) => (L.inFence ? '' : L.f)));
    if (labels === null) {
      r.fails.push('找不到 `## 目录` —— 检查器失效');
      r.notes.push('若目录标题里混了不可见字符，这里也会报「失效」—— 那属于**归因错误**，' +
        '请先 `grep -n "^#\\+.*目录" MODE.md | cat -A` 看一眼');
      return;
    }
    if (labels.length === 0) { r.fails.push('目录里一条都没解析出来 —— 目录格式变了，检查器失效'); return; }
    for (const lab of labels) {
      /* 【2026-09-15 修，第四个测试者 F03】编号后的分隔符原来只认 `.` ——
       * `## 7、幽灵章节` 两边都认不出，于是「目录有 7 / 正文有 7、」互不匹配。
       * 两种后果都是坏的：**能藏新章节**（C2 看不见）**也能造假红**（C1 说正文没有）。
       * 现在认 `. 、 ． ) ）`。 */
      /* 【修·第五次，第二轮 G17】编号后允许**空白**当分隔符（`## 7 幽灵节`）——
       * 与 C2 同一把尺子。附录侧也允许「附录与字母之间无空格」（`## 附录F`）。 */
      const re = lab.startsWith('附录')
        ? new RegExp('^附录\\s*' + escRe(lab.slice(-1)) + '(?![\\w])')
        : new RegExp('^' + escRe(lab) + '(?:\\s*[.、．)）]|\\s)');
      if (!h2.some((L) => re.test(L.heading.text))) {
        r.fails.push('目录有 **' + lab + '**，正文里没有对应 `## ` 标题');
      }
    }
    r.notes.push('目录 ' + labels.length + ' 行；正文 `##` 标题 ' + h2.length + ' 个（含列表项/setext 形态）');
  });

  // ---- C2 正文 → 目录
  check('C2', '正文 → 目录：每个 `## ` 标题都在目录里登记', r => {
    const labels = new Set(parseTocLabels(lines.filter(isMode).map((L) => (L.inFence ? '' : L.f))) || []);
    /* 【2026-09-15 修·第四次】这里原来有一句 `h2.slice(0, firstAp)` ——
     * 把检查范围**截到第一个附录之前**，理由是「附录内部的小节不该被要求登记」。
     * 那句理由本身是错的：附录内部的小节是 `###`，**从来就不在 h2 里**（h2 只收 level ≤ 2）。
     * 当时真正的病根是 setext 把 `-` 下划线也当标题，而 `---` 在本文档里是分节横线 → 13 个幽灵标题。
     * **我修的是症状，而且这个「修法」自己开了三个洞**（第四个测试者 F04/F05/F06）：
     * 删掉目录里的「附录 D」行、正文新增 `## 附录 F`、附录 A 后插 `## 7. 幽灵` —— 三者全零红。
     * 而且 C1（目录→正文）本来就不截断，**两条检查范围不对称本身就是信号**。
     * **只盯一个缺口的修法，一定会推高另一个缺口。**
     * 现在的契约是干净的一条：**`##` = 顶层（必须登记），`###` = 附录内部（不登记）**。 */
    const scope = h2;
    let n = 0;
    for (const L of scope) {
      const h = L.heading.text;
      /* 【修·第五次，第二轮 G15/G17】`## 附录F · …`（附录与字母间无空格）与 `## 7 幽灵节`
       * （编号后无分隔符）原来**完全不被认到** —— 而认不出就等于不存在（同一个病第 4 次）。
       * 附录标签统一归一成 `附录 X`（补一个空格），与目录侧的写法对齐。 */
      const ap = h.match(/^附录\s*([A-Z])(?![\w])/);
      const num = h.match(/^(\d+)(?:\s*[.、．)）]|\s)/);
      const lab = ap ? ('附录 ' + ap[1]) : (num ? num[1] : null);
      if (!lab) continue;
      n++;
      if (!labels.has(lab)) r.fails.push('正文有 `## ' + h.slice(0, 40) + '`（行 ' + ln(L) + '），目录里没登记 **' + lab + '**');
    }
    r.notes.push('登记过编号的顶层标题 ' + n + ' 个 / `##` 共 ' + h2.length +
      ' 个（契约：`##` 必须登记；附录内部一律写 `###`，不进这条检查）');
  });

  // ---- C3 单值量
  /* 箭头**不列清单**：ASCII 只认两字符箭头（`->` `=>` `<-` `<=`，避免把 `2026-09-15` 这种
   * 日期里的 `-` 当成连接符），其余交给**符号区段**（U+2190–U+21FF 箭头、
   * U+2200–U+22FF 数学符、U+2700–U+27BF 装饰、U+27F0–U+297F 补充箭头、U+2B00–U+2BFF）。
   * 代价明写：**方框符号区段之外的自造字形仍会逃**（残洞清单）。 */
  const NUMW = '(?:[0-9]+|[一二三四五六七八九十两]+)';
  const ARROW =
    '(?:->|=>|<-|<=|[-\\u2013\\u2014]\\s*>|[=\\uFF1D]\\s*>|[<\\uFF1C]\\s*[-\\u2013\\u2014=]' +
    '|[\\u2190-\\u21FF\\u2200-\\u22FF\\u2700-\\u27BF\\u27F0-\\u27FF\\u2900-\\u297F\\u2B00-\\u2BFF])';
  const LEFT_ARROW = /^(?:<-|<=|<[-=]|[\u2190\u21D0\u21E6\u21A4\u27F5\u27F8\u2B05])$/;
  const SINGLETONS = [
    { name: '合并后文件数（9 → N）', from: 9, expect: 5,
      // 【2026-09-15 修】数字两侧原来只允许空白与反引号 —— 于是 `9 → **5**`
      // 这条**真声明**根本没进枚举（粗体星号不是允许字符），全文件只剩 C.7 标题一处。
      // 加上 `*` `_`（粗体/斜体标记）。
      re: new RegExp('(' + NUMW + ')[ \\t`*_]*(' + ARROW + ')[ \\t`*_]*(' + NUMW + ')', 'g') },
  ];
  check('C3', '单值量：同一个量在全文件只有一个值', r => {
    for (const s of SINGLETONS) {
      const vals = new Map();
      const add = (v, L) => { if (!vals.has(v)) vals.set(v, ln(L)); };
      const named = new Set();
      let negated = 0, skipped = 0;
      for (const L of contentLines) {
        const codeR = codeRanges(L.f);
        s.re.lastIndex = 0;
        let m;
        while ((m = s.re.exec(L.f))) {
          // ① 代码跨度里的是「引述」，不是声明
          if (inRanges(codeR, m.index)) { skipped++; continue; }
          const a = numTok(m[1]);
          const b = numTok(m[3]);
          if (a === null || b === null) { skipped++; continue; }
          // ② 反向箭头 → 交换，让 `5 ← 9` 与 `9 → 5` 等价
          const left = LEFT_ARROW.test(m[2].trim());
          const src = left ? b : a;
          const dst = left ? a : b;
          if (src !== s.from) { skipped++; continue; }   // 不是这个量
          // ③ 否定词必须**紧贴**这个值
          const pre = L.f.slice(Math.max(0, m.index - 4), m.index);
          if (/不是|而非|并非|≠|非/.test(pre)) { negated++; continue; }
          const pre6 = L.f.slice(Math.max(0, m.index - 6), m.index);
          if (/(?:激进|方案|选项)\s*$/.test(pre6)) named.add(String(dst));
          else add(String(dst), L);
        }
      }
      /* 【2026-09-15 修】三态：
       *   0 处**活**声明 + 有引述跳过 → UNVERIFIED（这条检查失去对象，不是检查器坏了）
       *   0 处且连引述都没有         → FAIL（该量被删了，或检查器失效）
       *   >1 个值                    → FAIL
       *   1 个值 ≠ expect            → FAIL（**原来没有这一条**，所以「改掉唯一那个值」永远逃） */
      if (vals.size === 0) {
        if (skipped) {
          r.state = 'UNVERIFIED';
          r.notes.push(s.name + '：全文件 **0 处活声明**（' + skipped +
            ' 处匹配都在代码跨度里 = 引述）—— 这条检查没有对象，不是通过，也不是失败');
        } else r.fails.push(s.name + ' 一处声明都没找到 —— 检查器失效或该量被删了');
      } else if (vals.size > 1) r.fails.push(s.name + ' 有 ' + vals.size + ' 个不同值：' +
        [...vals].map(([v, l]) => v + '（行 ' + l + '）').join(' / '));
      else if ([...vals.keys()][0] !== String(s.expect)) {
        r.fails.push(s.name + ' 的值是 ' + [...vals.keys()][0] + '（行 ' + [...vals.values()][0] +
          '），契约写的是 ' + s.expect);
      } else r.notes.push(s.name + '=' + [...vals.keys()][0] + '（行 ' + [...vals.values()][0] + '）');
      if (named.size) r.notes.push('选项专名 `9→' + [...named].join('` / `9→') +
        '` 不计入声明值（**紧邻**前面有「方案 / 选项 / 激进」）');
      if (negated) r.notes.push('否定句（不是 / 而非 / 并非 / ≠）跳过 ' + negated + ' 处 —— 打出来，不静默丢');
      if (skipped) r.notes.push('代码跨度里 / 与源值不符的匹配跳过 ' + skipped + ' 处');
    }
  });

  // ---- C4 ASK 配额
  check('C4', 'ASK 配额：口径唯一（比**值**，不只比出现次数）', r => {
    /* 声明判据**不要求字面 `ASK 总配额`**：`ASK` 与 `配额` 之间、`配额` 与分隔符之间
     * 都允许若干字符（`ASK总配额` / `ASK 总配额数` / `ASK 的总配额` / 漏掉「次」都能进）。
     * **要求字面串 = 把绕过成本压到一个空格。** */
    const declRe = new RegExp(
      // 【2026-09-15 修】原来 `配额` 与分隔符之间允许 6 个任意字符 → 把
      // 「ASK 是**配额制**：一个任务全程**最多 2 次**」读成一条「口径=1」的声明（假红）。
      // 收成只允许空白 / 格式符 / 「数」。
      // 【2026-09-15 修，第四个测试者 F10】`**ASK 总配额上限 = 3 次**` 原来**完全不被看见** ——
      // 于是可以往文档里塞**第二条互相矛盾的权威口径**而全绿。
      // 这是最危险的一类逃逸：不是漏报细节，是**两条规则同时成立**。
      // 修法不是把窗口放宽到任意字符（那会把「配额**制**：…」重新读成声明 → 假红），
      // 而是枚举**能跟在「配额」后面的量词名词**（有限、有语义的一份清单）。
      // 【修·第五次，第二轮 G10/G11】补「配额**的**总次数」与「配额**是** 3 次」两种写法 ——
      // 它们都能往文档里塞**第二条矛盾的权威口径**而全绿。
      'ASK[^\\n`]{0,10}?配额[ \\t*_]*(?:的)?(?:上限值|上限|最大值|总次数|值|数|次数|额度)?[ \\t*_]*(?:[=:]|是|为)\\s*\\*{0,2}\\s*(' + NUMW + ')\\s*\\*{0,2}(?:次)?', 'g');
    /* 【2026-09-15 加】澄清句「不是 X 次，而是 Y 次」也是**一条声明**，值是 Y。
     * 不认它的话：声明数为 0 → 报「权威口径缺失」（假红），
     * 而旧口径扫描又会拿 X 来报（第二条假红）。**同一句话被两把尺子各报一次。** */
    const clarifyRe = new RegExp(
      'ASK[^\\n`]{0,10}?配额[^\\n`]{0,6}?不是[ \\t*_]*(' + NUMW + ')[ \\t*_]*次' +
      '[^\\n`]{0,6}?而是[ \\t*_]*(' + NUMW + ')[ \\t*_]*次', 'g');
    const clarifyLines = new Set();
    const declPairs = [];
    for (const L of contentLines) {
      const codeR = codeRanges(L.f);
      let cl;
      clarifyRe.lastIndex = 0;
      while ((cl = clarifyRe.exec(L.f))) {
        if (inRanges(codeR, cl.index)) continue;
        clarifyLines.add(ln(L));
        declPairs.push({ raw: cl[2], val: numTok(cl[2]), line: ln(L) });
      }
      declRe.lastIndex = 0;
      let m;
      while ((m = declRe.exec(L.f))) {
        if (inRanges(codeR, m.index)) continue;          // 引述不算声明
        declPairs.push({ raw: m[1], val: numTok(m[1]), line: ln(L) });
      }
    }
    if (declPairs.length === 0) { r.fails.push('找不到「ASK … 配额 = N」—— 唯一权威口径缺失'); return; }
    const vals = new Set(declPairs.map((p) => p.val));
    if (vals.size > 1) {
      r.fails.push('ASK 权威口径有 ' + vals.size + ' 个不同值：' + declPairs
        .filter((p) => vals.has(p.val))
        .map((p) => p.val + '（原文 `' + p.raw + '`，行 ' + p.line + '）').join(' / '));
    } else if ([...vals][0] !== 2) {
      r.fails.push('ASK 权威口径的值是 ' + [...vals][0] + '，契约写的是 2');
    }
    // 旧口径：按**句式**抓，不按字面量清单；否定词紧贴即豁免（C3 有，C4 原来没有 → 假红）
    const QUOTA1 = [/只有\s*(?:1|一)\s*次/, /仅有\s*(?:1|一)\s*次/, /最多\s*(?:1|一)\s*次/,
                    /仅\s*(?:1|一)\s*次/, /(?:1|一)\s*次\s*(?:配额|提问|询问)/,
                    /(?:配额|提问|询问)[^。\n|]{0,8}?(?:1|一)\s*次/];
    const SHIELD = /总配额\s*[=:]?\s*\*{0,2}(?:2|二)\s*次/;
    for (const L of contentLines) {
      if (!/ask/i.test(L.f)) continue;
      if (clarifyLines.has(ln(L))) continue;   // 澄清句不是旧口径
      const codeR = codeRanges(L.f);
      let bad = null, badAt = -1;
      for (const re of QUOTA1) {
        const g = new RegExp(re.source, 'g');
        let mm;
        while ((mm = g.exec(L.f))) {
          if (inRanges(codeR, mm.index)) continue;
          const pre = L.f.slice(Math.max(0, mm.index - 4), mm.index);
          if (/不是|而非|并非|≠|非/.test(pre)) continue;   // 澄清句，不是旧口径
          bad = mm[0]; badAt = mm.index; break;
        }
        if (bad) break;
      }
      if (!bad) continue;
      if (SHIELD.test(L.f)) continue;
      r.fails.push(loc(L) + ' 出现「ASK 配额 = 1 次」的旧口径（按句式抓，非字面量黑名单）：' +
        L.f.trim().slice(Math.max(0, badAt - 20), badAt + 30));
    }
    r.notes.push('权威口径 ' + declPairs.length + ' 处，值 ' + [...vals].join('/'));
  });

  // ---- C5 活引用
  const EXEMPT = {
    'SOURCES.md': '## 附录 A', 'PIPELINE.md': '## 附录 B',
    'RETRO.md': '## 附录 D', 'decisions.md': '## 附录 E',
  };
  /* 「归属标记」：这一行在**说明某个路径属于别人**（产品自带 / 第三方 / 上游仓库），
   * 不是在引用本机路径。与「引述不算声明」同一条口径 ——
   * **一份不能讨论别人目录结构的文档，会逼着人把说明写成隐语。** */
  /* 【2026-09-15 删】原来这里有一个 `ATTRIB` 归属口（行内含「产品/第三方/上游…」
   * 就把整行的引用都放行）。它开得太宽：行 244 写的是「（设计选择，**非产品强制**）」——
   * 一个**否定**语境里的「产品」二字，把那一行的**真活引用**豁免掉了，
   * 5 条变异（M5/M42/M43/M44/M45）因此全部逃逸。
   * **一个口径太宽的豁免口，会把真引用一起豁免。** 删掉，改用一个带覆盖者的显式例外表。 */
  /* `docs/` 是**产品文档命名空间**（产品自带的 md），不是本机活引用。
   * 明写在这里、并且**每次输出都打印** —— 要豁免就在众人眼前豁免。 */
  const PRODUCT_NS = /^docs\//;
  /* 唯一真正需要例外的路径，带**覆盖者**（SOUL 铁律八）：覆盖者标题消失就自动重新报。
   * `~/.codebuddy/agents/` 是产品的自定义代理目录；本机没装自定义代理时它不存在 ——
   * 这不是失效引用，是**未安装**。 */
  const EXEMPT_PATH = {
    '~/.codebuddy/agents': '## 5. 执行机制',
  };
  /* `~/` 是**用户主目录**，而 HOME 已经是 `~/.workbuddy-ai` —— 两者必须分开解析。
   * 重写第一版把它们混成一个 → 13 条假红（`~/.workbuddy-ai/MODE.md` 被解析成
   * `~/.workbuddy-ai/.workbuddy-ai/MODE.md`）。 */
  const USERHOME = path.dirname(HOME);
  /* 【2026-09-15 再修】`~/X` 与 `agents/X` 是**两个不同的根**：
   *   `~/X`       → 用户主目录（USERHOME）
   *   `agents/X`  → HOME（= `~/.workbuddy-ai`）—— 本文档里的相对路径一律相对 HOME
   * 混成一个的后果：`agents/verifier.md` 被解析成 `~/agents/verifier.md` → 7 条假红。
   * **同一个符号在两种上下文里有两种含义时，必须显式传上下文，不能靠猜。** */
  function resolveRef(rel, fromTilde) {
    const p = rel.replace(/\/+$/, '');
    if (fromTilde) {
      if (p === '.workbuddy-ai') return HOME;
      if (p.startsWith('.workbuddy-ai/')) return path.join(HOME, p.slice('.workbuddy-ai/'.length));
      return path.join(USERHOME, p);
    }
    return path.join(HOME, p);
  }
  /* 【2026-09-15 加】同一个路径被引用多次时，**记下全部行号**。
   * 实测踩到：`skills/constraint-mode/SKILL.md` 在文档里被引用 **8 次**，
   * 而这里原来是 `if (!refs.has(key)) refs.set(...)` —— Map 去重，只留第一处。
   * 后果：C5 报「1 条失效引用」，我照它去修，**修完以为干净了，其实还有 7 处**。
   * 严格说不是漏判（修一处、下次报下一处，逐次也能收敛），
   * 但**报告的形状与事实不符** —— 输出说 1 条，事实是 8 处。
   * 现在报出「该路径共被引用 N 处（行 …）」，一眼知道要修几处。
   * 注意 `EXEMPT` 那条 `refs.set(k, {line: 0, …})` 不带 count，输出时按 1 处理。 */
  /* 【2026-09-16 修，ISS-013】**归因**：每处引用必须记住它**住在哪个文件的第几行**。
   * 原先 `addRef` 只存 `line: ln(L)` = **文件集里的全局行号** —— 而 C5 的报错就写
   * `'行 ' + info.line`。实测踩到：C5 报「引用了不存在的路径 `skills/constraint-mode/MODULE.md`
   * · 该路径在文档里共被引用 2 处（行 26, 973）」，而 `MODE.md` **只有 280 行** ——
   * 行 973 在 `refs/` 的某个文件里，输出却**没说是哪个**。
   * 同文件第 287 行**有** `loc()`（`relName(srcFile)+':'+srcLn`），第 1327 行还自称
   * 「C5/C6 · 行号现在是 `文件:行`」—— **实现与自称不符，对 C5 和 C6 都不符**。
   * 这正是本文件第 167–170 行注释自己写的：
   *   「报出来的『行 N』指向另一个文件 —— **那是归因错误，比不报还坏**。」
   * 我定位那 5 处悬空指针花了 6 次工具调用（先怀疑 MODE.md 行数、再怀疑拼接、最后才到 refs/）。
   * 修法：sites 与 lines **平行记录**，报错改用 `siteOf()`；`--file` 模式无 srcFile 时退回纯数字。 */
  function addRef(map, key, info) {
    const cur = map.get(key);
    const site = { line: info.line, srcFile: info.srcFile, srcLn: info.srcLn };
    if (!cur) { info.sites = [site]; info.lines = [info.line]; info.count = 1; map.set(key, info); return; }
    if (!cur.sites) { cur.sites = [{ line: cur.line, srcFile: cur.srcFile, srcLn: cur.srcLn }]; }
    if (!cur.lines) { cur.lines = [cur.line]; }
    if (!cur.lines.includes(info.line)) { cur.lines.push(info.line); cur.sites.push(site); cur.count = cur.lines.length; }
  }
  /* 给人看的定位：`文件:行`（`--file` 跑副本时退回纯数字）。**与 `loc()` 同一个实现**（`fmtLoc`）。 */
  const siteOf = (s) => (!s ? '?' : fmtLoc(s.srcFile, s.srcLn, s.line));
  const sitesOf = (info) => ((info.sites && info.sites.length) ? info.sites : [{ line: info.line }]).map(siteOf).join(', ');
  /* ---- 「陈述缺席」判据：**一套**，装在三个地方（代码跨度 / 链接 / 跨文件锚点） ----
   * 【2026-09-15 修·第五次】第四个测试者的第二轮当场证明：这套判据第一版**只装在代码跨度上**，
   * 而且窗口是**定长 6 字**。两个毛病各造一批洞：
   *   ① 链接不吃这套判据 → `[旧契约已删除](agents/old-contract.md)` 照报红（G06，假红）
   *   ② 定长窗口会**跨过结构边界**去撞缺席词：
   *      `| <失效路径> | 没有任何豁免条款 |`（G01）、`| <失效路径> | 缺失的部分见附录 B |`（G03）、
   *      `落点没有变：<失效路径>`（G02）—— 全部被放行
   * 修法：窗口**在结构边界处截断**（单元格 `|`、句读、行尾）。
   * **定长窗口是"字形"判据，边界截断是"结构"判据** —— 与箭头那条同源。
   * 不是把窗口改短：改短会误伤「`hooks/` 目录不存在」（缺席词前隔着「目录」两字）。
   * **同一个判据只装在一半的地方，就是一半的假红。** */
  /* 【修·第六次，第二轮 G07】缺席词表补「消失 / 已移除 / 移除了 / 不见了 / 已撤掉」——
   * 原来那句「原落点 … 随技能改薄指针而**消失**」不在表里，于是**在描述缺席的句子照报红**。
   * ⚠ **这份表是枚举的，天生不完备。** 这是本轮最该被记住的一条：
   * 缺席是**语义**概念，我用**词表**去近似它 —— 每加一轮就多几个词，永远补不完。
   * 这就是这个检查器的设计天花板，已写进 LIMITATIONS。
   * 方向仍然是「宁可漏，不可假红」：漏掉的代价是少查一处，假红的代价是训练人忽略红色。 */
  const ABSENT_RE = /不存在|没有|未安装|未创建|未找到|缺失|已删除|不在了|无此|消失|已移除|移除了|不见了|已撤掉|已废弃/;
  /* 【修·第七次，第二轮 G07 复测】窗口从「**定长 6 字**」改成「**所在小句**」
   * （向后最多 16 字、向前最多 24 字，遇 `|。，、：；,.:;` 即止）。
   * 定长窗口**同时错在两个方向**，因为它量的不是语义单位：
   *   · 漏 —— `模板 2b 已随技能改薄指针而消失，` 里缺席词「消失」在 11 字外，够不到 → 假红（G07）
   *   · 滥 —— `| <失效路径> | 没有任何豁免条款 |` 里缺席词在隔壁单元格 → 放行（G01/G03）
   * 小句边界把两边一起解决：G01–G03 被 `|` 挡住，G07 被「到 `，` 为止」收进来。
   * 实测对照：F28（`hooks/` 目录不存在、）仍在句内 ✓；G19 反向对照（`落点是 <路径>`）仍报红 ✓。 */
  const BOUND_CH = '|。，、：；,.:;';
  function absentHit(s, a, b) {
    let i = a - 1, back = '';
    while (i >= 0 && back.length < 16 && BOUND_CH.indexOf(s[i]) < 0) { back = s[i] + back; i--; }
    let j = b, fwd = '';
    while (j < s.length && fwd.length < 24 && BOUND_CH.indexOf(s[j]) < 0) { fwd += s[j]; j++; }
    return (back + '\u0000' + fwd).match(ABSENT_RE);
  }
  /* 【修·第五次，第二轮 G04】域名不是本机目录：`easings.net/` 的首段含点且形如 `名.顶级域`。
   * 本机相对目录的首段**从不含点**（`.backup-…/` 是以点**开头**，不是含点）。 */
  const HOSTLIKE = /^[A-Za-z0-9][A-Za-z0-9-]*\.[A-Za-z]{2,}(?:[/:]|$)/;

  check('C5', '活引用：提到的路径真实存在（代码跨度里；引述/围栏/归属说明不算）', r => {
    const refs = new Map();          // rel → {line, home}
    const notes = [];
    for (const L of contentLines) {
      const codeR = codeRanges(L.f);
      const attrib = false;   // 归属口已删（见 EXEMPT_PATH 的注释）
      /* 【2026-09-15 修】markdown 链接的扫描原来在 `if (!codeR.length) continue;` **之后** ——
       * 而链接行通常没有代码跨度，于是整条链接引用**永远不被枚举**（第三方 M68 因此逃逸）。 */
      /* 【2026-09-15 修，第四个测试者 F12】原来只认 `~/` 开头的链接 ——
       * **同一份文档里两种链接写法，一种判一种不判，是不对称。** 相对链接整条不被枚举。
       * 现在：带协议（`://`）、纯锚点（`#`）、绝对路径（`/`）之外，一律按 HOME 相对路径判。
       * 实测本机当前 **0 条** markdown 链接 —— 这条修的是将来，不是现在（改完无新红）。 */
      const lk = /\]\(([^)\s]+)\)/g;
      let lm;
      while ((lm = lk.exec(L.f))) {
        const raw2 = lm[1];
        const t2 = raw2.split('#')[0];
        /* 【修·第五次，第二轮 G05】链接目标里**没有 `/`** 的一律不判 ——
         * `[缓动参考](easings.net)` 指的是外部站，不是本机相对路径。
         * 原来只要不带协议就当本机路径 → 假红。 */
        if (!t2 || /:\/\//.test(t2) || t2.startsWith('/') || !t2.includes('/')) continue;
        if (HOSTLIKE.test(t2)) {
          notes.push(loc(L) + ' 链接目标 `' + t2 + '` —— 形如域名，不当本机路径');
          continue;
        }
        /* 【修·第五次，第二轮 G06】链接也要吃「陈述缺席」判据 —— 原来只有代码跨度有。 */
        const am2 = absentHit(L.f, lm.index + 2, lm.index + 2 + raw2.length);
        if (am2) {
          notes.push(loc(L) + ' 链接 `' + t2 + '` —— 上下文有缺席标记「' + am2[0] + '」，按陈述缺席处理');
          continue;
        }
        const m2 = t2.match(/^~\/(.+)$/);
        const r2 = (m2 ? m2[1] : t2).replace(/\\/g, '/').replace(/\/+$/, '');
        if (!r2) continue;
        const k2 = (m2 ? '~/' : '') + r2;
        addRef(refs, k2, { line: ln(L), srcFile: L.srcFile, srcLn: L.srcLn, raw: t2, rel: r2, tilde: !!m2 });
      }
      if (!codeR.length) continue;
      for (const [a, b] of codeR) {
        const seg = L.f.slice(a + 1, b - 1).trim();
        /* 【2026-09-15 修，第四个测试者 F13】反斜杠原来在**匹配之后**才归一 —— 等于没用：
         * `` `~\.workbuddy-ai\agents\ghost.md` `` 整条不被枚举（静默盲区）。
         * 归一挪到**匹配之前**。实测：本机含反斜杠的代码跨度只有 `\b` / `\w` / `(\d+)` / `^\s*## `，
         * 归一后都不匹配任何路径形态 → 无新红。 */
        const segN = seg.replace(/\\/g, '/');
        let rel = null, fromTilde = false;
        let m = segN.match(/^~\/(.+)$/);
        if (m) { rel = m[1]; fromTilde = true; }
        /* 【修·第五次，第二轮 G04】域名不是本机目录 —— 见 HOSTLIKE。 */
        else if (HOSTLIKE.test(segN)) {
          notes.push(loc(L) + ' `' + seg + '` —— 形如域名的首段，不当本机路径');
          continue;
        }
        else if (/^[\w.-]+(?:\/[\w.*?<>\u4e00-\u9fa5\[\]-]+)+\.[A-Za-z0-9]{1,5}$/.test(segN)) { rel = segN; fromTilde = false; }
        /* 【2026-09-15 修，第四个测试者 F11】补**目录引用**（尾斜杠、无扩展名）——
         * 原来只认带扩展名的文件路径，于是 `agents/` 改名成 `agents-typo/` 静默通过。
         * 唯一的已知风险样本是 `` `hooks/` 目录不存在 ``，它由**陈述缺席**判据兜住（F28 的修复）。
         * 实测：本机 7 个尾斜杠代码跨度里只有 `hooks/` 不存在，而它带缺席标记 → 无新红。 */
        else if (/^[\w.-]+(?:\/[\w.*?<>\u4e00-\u9fa5-]+)*\/$/.test(segN)) { rel = segN; fromTilde = false; }
        if (rel === null) continue;
        /* 【2026-09-15 修，第四个测试者 F28】原来「代码跨度里长得像路径」就要求它存在 ——
         * 于是「我查的是：`settings.json` 无 `hooks` 键、`hooks/` 目录不存在」这类**陈述缺席**
         * 被报成失效引用。**那句话本身是对的，报它才是错的。**
         * （原文里的 `hooks/` 只是**碰巧**没有扩展名才没进枚举 —— 靠运气通过不算通过。）
         * 现在看紧邻上下文（前后各 6 字）有没有缺席标记；有就按陈述处理，**并且打印出来**。
         * 代价明写进 LIMITATIONS：真实引用旁边恰好写这些词会被放过。
         * 方向我认 —— **假红比逃逸贵，它会训练人忽略红色。** */
        const am = absentHit(L.f, a, b);
        if (am) {
          notes.push(loc(L) + ' `' + seg + '` —— 上下文有缺席标记「' + am[0] +
            '」，按**陈述缺席**处理，不当活引用');
          continue;
        }
        rel = rel.replace(/\\/g, '/').replace(/\/+$/, '');
        if (!rel) continue;
        if (PRODUCT_NS.test(rel)) { notes.push(loc(L) + ' `' + seg + '` —— 产品文档命名空间 `docs/`，不当本机活引用'); continue; }
        const key = (fromTilde ? '~/' : '') + rel;
        addRef(refs, key, { line: ln(L), srcFile: L.srcFile, srcLn: L.srcLn, raw: seg, rel, tilde: fromTilde });
      }
    }
    for (const k of Object.keys(EXEMPT)) if (fold(text).includes(k)) refs.set(k, { line: 0, raw: k, rel: k, tilde: false });
    for (const [key, info] of refs) {
      const rel = info.rel;
      /* 【2026-09-15 修，第四个测试者 F15】原来只认**精确 key** ——
       * 于是 `~/.codebuddy/agents/foo.md` 这种**它下面的文件**不豁免，
       * 而「那个目录没装」是同一件事（未安装，不是失效引用）。改成前缀匹配。 */
      const exKey = Object.keys(EXEMPT_PATH).find((k) => key === k || key.startsWith(k + '/'));
      if (exKey) {
        const cov = EXEMPT_PATH[exKey];
        /* 【2026-09-15 修】原来用 `\\b` —— 而 `\\b` 在**中文后面永远不成立**
         * （JS 正则无 u 标志时汉字不是 `\\w`，所以「制 → 空格」之间没有边界）。
         * `## 附录 A` 之所以碰巧通过，只是因为 `A` 是 ASCII 词字符 ——
         * **同一个写法在两处，一处靠运气通过、一处失败，这本身就是口径不统一的信号。**
         * 改成显式后视：覆盖者后面不许紧跟词字符或汉字。 */
        const covRe = new RegExp('^' + escRe(cov) + '(?![\\w\\u4e00-\\u9fa5])', 'm');
        if (!covRe.test(fold(text))) {
          r.fails.push('路径豁免规则 `' + exKey + '`（本次命中 `' + key +
            '`）的覆盖者 `' + cov + '`（须为**行首标题**）不在了 —— 豁免自动失效，重新报');
        } else r.notes.push('路径豁免 ' + exKey + '（本次命中 ' + key + '；覆盖者 ' + cov +
          ' 仍在）—— 未安装，不是失效引用');
        continue;
      }
      if (EXEMPT[rel]) {
        const cov = EXEMPT[rel];
        /* 【2026-09-15 修】原来用 `\\b` —— 而 `\\b` 在**中文后面永远不成立**
         * （JS 正则无 u 标志时汉字不是 `\\w`，所以「制 → 空格」之间没有边界）。
         * `## 附录 A` 之所以碰巧通过，只是因为 `A` 是 ASCII 词字符 ——
         * **同一个写法在两处，一处靠运气通过、一处失败，这本身就是口径不统一的信号。**
         * 改成显式后视：覆盖者后面不许紧跟词字符或汉字。 */
        const covRe = new RegExp('^' + escRe(cov) + '(?![\\w\\u4e00-\\u9fa5])', 'm');
        if (!covRe.test(fold(text))) {
          r.fails.push('豁免 `' + rel + '` 的覆盖者 `' + cov + '`（须为**行首标题**）不在了 —— 豁免自动失效，重新报');
        } else r.notes.push('豁免 ' + rel + '（覆盖者 ' + cov + ' 仍在，行首标题）');
        continue;
      }
      if (/[*?<>\[\]]/.test(rel)) {
        if (!globExists(rel)) r.fails.push(siteOf(info.sites && info.sites[0]) + '：通配/占位引用一个都匹配不上：' + key +
          (info.count > 1 ? ' · **该形态在文档里共出现 ' + info.count + ' 处**（' + sitesOf(info) + '）' : ''));
        else r.notes.push('通配/占位引用 ' + key + ' 展开后有匹配');
        continue;
      }
      if (!fs.existsSync(resolveRef(rel, info.tilde))) {
        r.fails.push(siteOf(info.sites && info.sites[0]) + '：引用了不存在的路径：' + key + '（原文 `' + info.raw + '`）' +
          /* 报重复次数：**报告的形状必须与事实一致** —— 说「1 条」而事实 8 处，
           * 会让人修完第一处就以为干净了。**每一处都要带自己的 `文件:行`**（ISS-013）。 */
          (info.count > 1 ? ' · **该路径在文档里共被引用 ' + info.count + ' 处**（' + sitesOf(info) + '）' : ''));
      }
    }
    if (refs.size === 0) r.fails.push('一个路径引用都没解析出来 —— 检查器失效');
    else r.notes.push('解析出 ' + refs.size + ' 个路径引用');
    for (const n of notes.slice(0, 8)) r.notes.push(n);
    if (notes.length > 8) r.notes.push('…另有 ' + (notes.length - 8) + ' 处归属说明');
  });

  // ---- C6 跨文件锚点
  check('C6', '跨文件锚点：指向另一个文件的 `模板 X` / `铁律X` 真的存在', r => {
    /* 归一化三件事（第三个测试者 M27/M28/M66 都是靠字形逃的）：
     *   ① 锚点词上的粗体/斜体/圈码先折叠 —— `**铁律十二**` / `铁律⑫` 是同一个锚点
     *   ② 铁律接受「第 N 条铁律」这种描述式写法
     *   ③ 名字**不设长度上限**（原来 `{1,24}` 把长名字截断后再去找 → 假红 + 错误归因） */
    const targets = [];
    for (const L of contentLines) {
      const codeR = codeRanges(L.f);
      /* 【修·第五次，第二轮 G08】C5 归一了反斜杠，C6 没有 ——
       * 同一个处理只装在一半的地方，就是一半的静默盲区：
       * 反斜杠写的锚点整条不被枚举。这里对**整行**归一后再匹配。 */
      const src6 = L.f.replace(/\\/g, '/');
      /* 【2026-09-15 修，第四个测试者 F16】文件名字符类里原来没有 `~` ——
       * 于是 `~/...` 开头的锚点**完全不被枚举**。而本文档的文件地图正是这种写法（行 244 / 712）。
       * **一个静默的盲区比一个报红的缺陷更坏：它连「这里没查」都不说。** */
      /* 【2026-09-15 修，第四个测试者 F17】连接词原来只认「的」——
       * `` `agents/verifier.md` 里的铁律十五 `` 整条不被枚举（静默盲区）。
       * 注意这与「箭头字形」不是同一类问题：**字形变体是无限的，汉语连接词是有限的**。
       * 所以这里可以枚举：的 / 里 / 中 / 内，1–2 字。 */
      const reTpl = /`([~\w./-]+\.md)`[ \t]*(?:[的里中内]{1,2}[ \t]*)?模板[ \t]+([^\s`|（）()，,。；;：:、]{1,})/g;
      let m;
      // 【2026-09-15 修】原来对整条匹配做「在代码跨度里就跳过」的守卫 ——
      // 而匹配**从文件名的反引号开始**，于是**每一条锚点都被当成引述丢掉**，
      // C6 直接报「一条都没解析出来」。文件名按约定**就该**写在代码跨度里。
      void codeR;
      while ((m = reTpl.exec(src6))) {
        targets.push({ file: m[1], kind: '模板', tok: m[2], line: ln(L), srcFile: L.srcFile, srcLn: L.srcLn, src: src6, start: m.index, end: m.index + m[0].length });
      }
      /* 【2026-09-15 修】三处：
       *   ① 文件名与锚点词之间允许夹粗体/斜体标记（`**铁律十二**` 是真引用）
       *   ② 补「第 N 条铁律」这种**描述式**写法（第三方 M28）
       *   ③ 允许锚点词后面再跟「条」（`铁律 N 条`） */
      const N = '[0-9一二三四五六七八九十两]+';
      const reLaw = new RegExp(
        '`([~\\w./-]+\\.md)`[ \\t*_]*(?:[的里中内]{1,2}[ \\t*_]*)?(?:' +
          '铁律[ \\t*_]*(?:第[ \\t]*)?(' + N + ')' +
          '|第[ \\t]*(' + N + ')[ \\t]*条[ \\t*_]*(?:[的里中内]{1,2}[ \\t*_]*)?铁律' +
          '|铁律[ \\t*_]*(?:第[ \\t]*)?(' + N + ')[ \\t]*条' +
        ')', 'g');
      while ((m = reLaw.exec(src6))) {
        const tok = m[2] || m[3] || m[4];
        targets.push({ file: m[1], kind: '铁律', tok, line: ln(L), srcFile: L.srcFile, srcLn: L.srcLn, src: src6, start: m.index, end: m.index + m[0].length });
      }
    }
    if (targets.length === 0) { r.fails.push('一个跨文件锚点引用都没解析出来 —— 检查器失效'); return; }
    const bodies = new Map();
    for (const t of targets) {
      /* `~/` 按**用户主目录**解析，`~/.workbuddy-ai/…` 就是 HOME 本身 ——
       * 与 C5 的 resolveRef 同一口径（同一个符号在两种上下文里有两种含义时，必须显式传上下文）。 */
      /* 【修·第五次，第二轮 G07】锚点也要吃「陈述缺席」判据 ——
       * `` `agents/verifier.md` 中的模板 2b 已删除 `` 这类**在描述锚点已消失**的句子，
       * 原来被读成一条锚点引用 → 假红。
       * **把判据做成一套、装到所有"引用别的东西"的地方**，而不是逐处打补丁。 */
      /* 【修·第八轮】窗口的**起点必须是引用的开头**，不能是结尾 ——
       * 原来是 `absentHit(t.src, t.end, t.end)`，向后 16 字**把引用自己的字也圈进去了**。
       * 后果不是"偶尔漏"，是**任何引用名里含缺席词就自动豁免**：
       * 第三方 N12 的变异名恰好是「模板 一个根本不存在的长模板名」→ 被自己的名字放行（30 命中掉到 29）。
       * 这不是巧合型缺陷：叫 `missing-*.md` / `not-found.md` 的真实路径同样会中。
       * **判据看的是「引用周围的话」，不是「引用自己的字」。** */
      const am6 = t.src != null ? absentHit(t.src, t.start, t.end) : null;
      const tloc = fmtLoc(t.srcFile, t.srcLn, t.line);
      if (am6) {
        r.notes.push(tloc + ' 锚点 `' + t.file + '` ' + t.kind + ' ' + t.tok +
          ' —— 上下文有缺席标记「' + am6[0] + '」，按陈述缺席处理');
        continue;
      }
      const fileN = t.file.replace(/\\/g, '/');
      const p = fileN.startsWith('~/')
        ? path.join(USERHOME, fileN.slice(2))
        : path.join(HOME, fileN);
      if (!fs.existsSync(p)) { r.fails.push(tloc + '：引用了不存在的文件 `' + fileN + '`'); continue; }
      if (!bodies.has(fileN)) bodies.set(fileN, fold(fs.readFileSync(p, 'utf8')));
      const body = bodies.get(fileN);
      let ok;
      if (t.kind === '铁律') {
        const want = numTok(t.tok);
        /* **比数字，不比写法**：`铁律 15` 与 `铁律十五` 是同一个锚点。
         * 原来用 `铁律\\s*十五(?!…)` 的正则，于是换写法就找不到（假红）。 */
        ok = [...body.matchAll(/铁律[ \t]*(?:第[ \t]*)?([0-9]+|[一二三四五六七八九十两]+)/g)]
          .some((x) => numTok(x[1]) === want);
      } else {
        ok = new RegExp('模板[ \\t]+' + escRe(t.tok) + '(?![\\w\\u4e00-\\u9fa5])').test(body);
      }
      if (!ok) r.fails.push(tloc + '：`' + fileN + '` 的 `' + t.kind + ' ' + t.tok +
        '` 在该文件里找不到（锚点须**整词/同值**出现，子串命中不算）');
      else r.notes.push(fileN + ' → ' + t.kind + ' ' + t.tok + ' 命中');
    }
  });

  // ---- C7 「已落」必须可核对
  const greps = [];
  check('C7', '「已落」声明必须自带可执行的核对命令', r => {
    let n = 0, explicit = 0;
    const MAX_EXPLICIT = 2;
    /* 【2026-09-15 改，D17】认声明**不再看「以已落开头」**。
     * 第三个测试者用 5 种前缀就把它绕过去了：`✅ **已落**` / `**已 落**` / `**【已落】**`
     * / `**\u200b已落**` / `**已`落`**` —— 判据是「单元格**含**已落」。
     * 但「引述」不算声明：代码跨度**保留内容**（`` **已`落`** `` 是真声明），
     * 「」里的**整段丢掉**（记录里写 `「已落」粗体里多带字符` 是在描述缺陷，不是声明）。 */
    /* 【2026-09-15 再修，D17 第二轮】第一版写成「**含**已落」——
     * 于是记录里的引述（`上一轮已落`、`` `**已落 ✅**` `` 写在描述格里）也被当成声明 → 假红。
     * 改成「**剥掉前缀后以「已落」开头**」：
     * 剥的是**格式与前缀**（✅ 这类表情、【】括号、粗体/下划线/反引号、零宽、空白），
     * 于是第三个测试者的 5 种前缀形态（`✅ **已落**` / `**已 落**` / `**【已落】**`
     * / 零宽前缀 / `` **已`落`** ``）**全部仍然被抓住**，
     * 而「上一轮已落」「多条已落换成…」这类**句子**不再误报。
     * 「」里的整段照旧丢掉 —— 记录里写 `「已落」粗体里多带字符` 是在**描述缺陷**。 */
    /* 【2026-09-15 修·第四次，第四个测试者 F19】原来是「**列举**要剥掉的格式符」——
     * 于是 `√ **已落**` 逃掉（`√` = U+221A 不在清单里），下一个人拿 `☑` 再来一次。
     * **字形的变化是无限的，列清单永远输。** 改成结构判据：
     *   ① 先剥 markdown 语法字符（`* _ # > \` ~`）—— 这是一份**有限的、有规范的**清单，
     *      不是字形变体；`` **已`落`** `` 靠它还原成 `已落`。
     *   ② 去掉全部空白（`**已 落**` 与 `已落` 同形）。
     *   ③ 然后看「已落」**之前**有没有字母 / 数字 / 汉字：
     *      有 → 是句子（在描述），不是声明；没有 → 是声明（表情、圈码、勾叉、方框、括号一律算"没有内容"）。
     * 于是 `✅ **已落**` / `√ **已落**` / `【已落】` / 零宽前缀 全部命中，
     * 而 `上一轮已落` / `多条已落换成…` 这类句子仍然不被误报。 */
    const isDeclCell = (cell) => {
      let c = fold(cell).replace(/「[^」]*」/g, '').replace(/『[^』]*』/g, '');
      c = c.replace(/[*_#>`~]+/g, '');
      /* 【修·第五次，第二轮 G13】`1️⃣ **已落**` 逃掉 —— keycap 里的数字是 `\p{N}`。
       * keycap 是**有定义的 Unicode 序列**（数字 + U+FE0F + U+20E3），不是任意字形变体，
       * 所以这里可以精确剥掉整条序列。 */
      c = c.replace(/[0-9]\uFE0F?\u20E3/g, '');
      c = c.replace(/[\s\u00A0\u3000]+/g, '');
      const i = c.indexOf('已落');
      if (i < 0) return false;
      return !/[\p{L}\p{N}]/u.test(c.slice(0, i));
    };
    for (const L of lines) {
      const cells = splitCells(L);
      if (!cells) continue;
      const declCells = cells.filter(isDeclCell);
      if (!declCells.length) continue;
      n++;
      // 命令：双引号**或**单引号（第三个测试者 M35：只认双引号 → 假红）
      // 【2026-09-15 修】命令与期望值必须从 **L.raw** 取 —— 折叠会把全角 `：` 变成 ASCII `:`，
      // 于是 `grep -c "铁律九："` 变成 `grep -c "铁律九:"`，在文件里找不到 → 退出码 1（假红）。
      // **命令是"要做的事"，不是"要比的文本"，不许归一化。**
      // 【2026-09-15 修，第四个测试者 F24】补 `-e` 形态（`grep -c -e "…" f`）。
      // 其他选项组合（`-ce` / `--count` / `-F`）仍不被解析 —— 写进 LIMITATIONS，不假装全认。
      const g = L.raw.match(/`(grep\s+-c\s+(?:-e\s+)?(?:"[^"]+"|'[^']+')(?:\s+\S+)?)`/);
      if (g) {
        const em = L.raw.match(/`grep[^`]*`\s*(?:→|->|=>|⇒)\s*\*{0,2}(\d+)/) ||
                   L.raw.match(/核对：[^）]*?(?:→|->|=>|⇒)\s*\*{0,2}(\d+)/);
        greps.push({ cmd: g[1], expect: em ? parseInt(em[1], 10) : null, line: ln(L), loc: loc(L), cells });
        continue;
      }
      const ex = L.f.match(/不可核对[:：]\s*([^|）)]+)/);
      if (ex) {
        const reason = ex[1].trim();
        explicit++;
        const concrete = /\d{4}-\d{2}-\d{2}|`[^`]+`|[~./][\w./-]+\.\w+|\b[0-9a-f]{7,}\b/.test(reason);
        if (reason.length < 6) r.fails.push(loc(L) + '：「不可核对」的原因太短（`' + reason + '`）—— 没说清为什么查不动');
        else if (/不改写|历史记录|历史遗留|无法追溯|无从考证|年代久远/.test(reason)) {
          r.fails.push(loc(L) + '：「不可核对」的原因是**万能话术**（`' + reason + '`）—— ' +
            '它能豁免掉任何声明，等于没有这条规则');
        } else if (!concrete) {
          r.fails.push(loc(L) + '：「不可核对」的原因**点不出任何具体对象**（`' + reason + '`）—— ' +
            '要么给出日期/文件名/路径，要么承认这条查不动是没理由的');
        } else r.notes.push(loc(L) + ' 显式声明不可核对：' + reason);
        continue;
      }
      r.fails.push(loc(L) + ' 声明「已落」但既没有可执行核对命令，也没写「不可核对：<原因>」');
    }
    if (n === 0) r.fails.push('一条「已落」都没有 —— 这条检查必须有对象，否则是空转');
    r.notes.push('已落 ' + n + ' 条 = 有核对命令 ' + greps.length + ' + 显式豁免 ' + explicit);
    if (explicit > MAX_EXPLICIT) r.fails.push('「不可核对」豁免 ' + explicit + ' 条，超过上限 ' + MAX_EXPLICIT +
      ' —— 豁免太多就不是例外，是常态（SOUL：区域级豁免就是一张裸的允许清单）');
    if (explicit) r.notes.push('⚠ 显式豁免 ' + explicit + ' 条（上限 ' + MAX_EXPLICIT +
      '）—— 豁免不是「没问题」，是「承认查不动」');
  });

  // ---- C8 真的跑那些核对命令
  check('C8', '核对命令真的跑一遍（拿不到 bash 就是 UNVERIFIED，不是 PASS）', r => {
    const probe = spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' });
    if (probe.error && probe.error.code === 'ENOENT') {
      r.state = 'UNVERIFIED';
      r.notes.push('本机没有 bash，' + greps.length + ' 条核对命令**一条都没跑** —— 不许当成通过');
      return;
    }
    if (greps.length === 0) { r.fails.push('没有可执行的核对命令 —— 检查器失效'); return; }
    let skipped = 0;
    for (const g of greps) {
      // ---- ① 结构部分：**与被测文本有关，任何入口都要判**（原来在副本入口被整体跳过 → 注释与代码不符）
      if (!/\s+\S+$/.test(g.cmd)) {
        r.fails.push(g.loc + '：`' + g.cmd + '` **没指定文件** —— 它读 stdin，永远跑不出结果');
        continue;
      }
      const target = g.cmd.trim().split(/\s+/).pop();
      /* 【2026-09-15 修，第四个测试者 F23】落点列比对原来拿**字面** target ——
       * 于是 `./agents/verifier.md` 与 `agents/verifier.md` 被当成两个文件，
       * 报出「改文件参数即可绕过」。**同一个文件写两种路径是合法的，不是绕过。**
       * 这条假红最坏的地方是它**指错了方向**：命令本来是对的，它叫人去改命令。
       * 只归一 `./` 前缀；其他等价写法（绝对路径 / `~` / 大小写）仍按字面比 —— 写进 LIMITATIONS。 */
      const targetN = target.replace(/^\.\//, '');
      const rowText = lines[g.line - 1] ? lines[g.line - 1].f : '';
      const cells = rowText.split('|');
      const cmdF = fold(g.cmd);
      if (cells.length < 6) {
        r.fails.push(g.loc + '：核对命令所在行**不是 ≥4 列的表格行**（只有 ' + cells.length +
          ' 段）—— 取不到落点列，无法判定「声明」与「核对」是否指向同一个对象');
        continue;
      }
      const landing = cells[3];
      if (landing.includes(cmdF)) { r.fails.push(g.loc + '：落点列里就是**命令本身** —— 这是自证，不是核对'); continue; }
      if (!landing.includes(fold(targetN))) {
        r.fails.push(g.loc + '：核对命令的对象 `' + targetN + '` 不在这一行的**落点列**里' +
          '（落点列 = `' + landing.trim().slice(0, 40) + '`）—— 改文件参数即可绕过');
        continue;
      }
      /* 【2026-09-15 加，D17】落点列**点名了锚点**（铁律N / 模板 X）时，
       * 命令的匹配模式必须含**同一个锚点** —— 否则「把两行的命令对调」
       * 就能让声明与核对指错对象而全绿（第三个测试者 M41）。
       * 只在落点列确实点名锚点时生效：落点列只说「输出格式」的行不受影响。 */
      const landAnchor = landing.match(/铁律[ \t]*(?:第[ \t]*)?([0-9一二三四五六七八九十两]+)/);
      if (landAnchor) {
        const pat = (g.cmd.match(/"([^"]*)"|'([^']*)'/) || [])[1] || (g.cmd.match(/"([^"]*)"|'([^']*)'/) || [])[2] || '';
        const want = numTok(landAnchor[1]);
        const got = [...fold(pat).matchAll(/铁律[ \t]*(?:第[ \t]*)?([0-9一二三四五六七八九十两]+)/g)]
          .map((x) => numTok(x[1]));
        if (!got.includes(want)) {
          r.fails.push(g.loc + '：落点列点名 `铁律' + landAnchor[1] + '`，而核对命令查的是 `' +
            pat + '` —— **声明与核对指的不是同一个对象**');
          continue;
        }
      }
      if (g.expect == null) {
        r.fails.push(g.loc + '：`' + g.cmd + '` **没写期望值** —— 跑出来的数字没有比对对象，等于把这条核对整体关掉');
        continue;
      }
      // ---- ② 执行部分：被测文本是副本时**不判计数**（命令读的是磁盘上的真文件）—— 第三态
      if (TARGET !== MODE) {
        skipped++;
        r.notes.push(g.loc + '：`' + g.cmd + '` **不判计数** —— 被测文本不是磁盘上的 `MODE.md`');
        continue;
      }
      const out = spawnSync('bash', ['-c', g.cmd], { cwd: HOME, encoding: 'utf8' });
      if (out.status !== 0) { r.fails.push(g.loc + '：`' + g.cmd + '` 退出码 ' + out.status); continue; }
      let got = parseInt((out.stdout || '').trim().split('\n').pop().trim(), 10);
      if (path.resolve(HOME, target) === TARGET) {
        const pat = (g.cmd.match(/"([^"]*)"|'([^']*)'/) || [])[1] || '';
        let selfHit = 0;
        try { selfHit = (g.cmd.match(new RegExp(pat, 'g')) || []).length; } catch (e) { selfHit = 0; }
        if (selfHit > 0) {
          /* 【2026-09-15 期 1 修】原来在**全文**里数命令文本出现的次数。
           * 拆文件后命令住在 `refs/D-retro.md`，而它 grep 的是 `MODE.md` ——
           * 命令文本**根本不在被 grep 的那个文件里**，扣 1 就是凭空少 1。
           * 实测：`grep -c "验证强度跟着任务生命周期走" MODE.md` 真值 1，被扣成 0 → **假红**。
           * 现在只在**被 grep 的那个文件的内容**里数。
           * 这是「自指扣减靠推断、不是精确计数」这条 LIMITATIONS 的第一次真实付账。 */
          const seg = SEGS ? SEGS.find((s) => path.resolve(s.file) === TARGET) : null;
          const times = seg
            ? lines.slice(seg.start, seg.start + seg.count).map((L) => L.raw).join('\n').split(g.cmd).length - 1
            : text.split(g.cmd).length - 1;
          got -= times;
          /* 【期 1 修】扣 0 处时原来也打「自指已扣 0 处（命令文本自身会被该模式命中）」——
           * 那句话自相矛盾，而且会让人以为扣减生效了。**扣 0 就要说清为什么不扣。** */
          r.notes.push(times > 0
            ? g.loc + '：自指已扣 ' + times + ' 处（命令文本自身会被该模式命中）'
            : g.loc + '：命令文本不在被 grep 的 `' + target + '` 里 —— 不扣（拆文件后命令与目标可以不同文件）');
        } else r.notes.push(g.loc + '：命令模式**不匹配命令自身** —— 不扣（无条件 -1 会造成假红）');
      }
      if (String(got) !== String(g.expect)) {
        r.fails.push(g.loc + '：`' + g.cmd + '` 期望 ' + g.expect + '，实际 ' + got);
      } else r.notes.push(g.loc + '：' + g.cmd + ' → ' + got + '（期望 ' + g.expect + '）');
    }
    if (skipped) {
      r.state = 'UNVERIFIED';
      r.notes.push('⚠ ' + skipped + ' / ' + greps.length + ' 条核对命令**没跑**（被测文本是副本）—— ' +
        'C8 的计数结论对本次被测文本**不成立**，别把 UNVERIFIED 读成通过');
    }
  });

  return results;
}

function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ---------------------------------------------------------------- 变异测试

const MUTATIONS = [
  { name: '目录里加一行 **7**（正文没有第 7 节）', expect: 'C1',
    edit: t => t.replace('| **6** | 反模式 | 自查 |', '| **6** | 反模式 | 自查 |\n| **7** | 不存在的节 | — |') },
  { name: '正文新增 `## 7. 幽灵章节`（目录没登记）', expect: 'C2',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）', '## 6. 反模式（违反，不是风格问题）\n\n## 7. 幽灵章节\n') },
  { name: '把 C.7 标题的 9 → 5 改成 9 → 4（同量两值）', expect: 'C3',
    edit: t => t.replace('### C.7 文件地图（2026-09-15「清」之后 · 9 → 5）', '### C.7 文件地图（2026-09-15「清」之后 · 9 → 4）') },
  { name: '把 ASK 权威口径改回旧说法「只有 1 次配额」', expect: 'C4',
    edit: t => t.replace('**ASK 总配额 = 2 次**', '**ASK 全程只有 1 次配额**') },
  { name: '活引用指向一个不存在的文件', expect: 'C5',
    edit: t => t.replace('`~/.workbuddy-ai/agents/verifier.md`', '`~/.workbuddy-ai/agents/verifier-typo.md`') },
  { name: '跨文件锚点指向不存在的模板（D6 的原始形态）', expect: 'C6',
    edit: t => t.replace('`agents/dispatcher.md` 的 JOB `VERIFY` 块', '`agents/dispatcher.md` 模板 9z') },
  { name: '在活区加一条没有核对命令的「已落」声明', expect: 'C7',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）', '| 99 | 假声明 | 某处 | **已落** |\n\n## 6. 反模式（违反，不是风格问题）') },
  { name: '把一条核对命令的期望值改错（1 → 9）', expect: 'C8',
    edit: t => t.replace('`grep -c "M1 变异测试" agents/dispatcher.md` → 1', '`grep -c "M1 变异测试" agents/dispatcher.md` → 9') },
  { name: '把核对命令的文件参数删掉（命令从此跑不出结果）', expect: 'C8',
    edit: t => t.replace('`grep -c "M1 变异测试" agents/dispatcher.md` → 1', '`grep -c "M1 变异测试"` → 1') },
  { name: '把核对命令的文件参数换成另一个「含同串同次数」的文件（只比计数就抓不到）', expect: 'C8',
    edit: t => t.replace('`grep -c "M1 变异测试" agents/dispatcher.md` → 1', '`grep -c "M1 变异测试" agents/verifier.md` → 1') },
  { name: '把一条「已落」的核对命令整段删掉（留一条裸的已落）', expect: 'C7',
    edit: t => t.replace('| **已落**（核对：`grep -c "铁律九：" agents/verifier.md` → 1） |', '| **已落** |') },
  { name: '（反向）把一条「已落」显式标成「不可核对：<原因>」→ C7 必须**不**报红', expect: '!C7',
    edit: t => t.replace('| **已落**（核对：`grep -c "铁律九：" agents/verifier.md` → 1） |',
                         '| **已落**（不可核对：原文已被 2026-09-15 的改写覆盖） |') },
  // 【2026-09-15 加】验收代理把它列为「未测项 1」：C5 的「豁免须有覆盖者」自动失效路径
  // 从没被触发过（要删掉附录 A/B/D/E 的标题才走得到）。一条永远不走的路径 = 没测过的代码。
  { name: '删掉 `## 附录 A` 标题（豁免的覆盖者消失 → 豁免必须自动失效并重新报）', expect: 'C5',
    edit: t => t.replace('## 附录 A · 检索源（原 `SOURCES.md`）', '## 检索源（原 `SOURCES.md`）') },
  // 【2026-09-15 加】反向断言：把全文行尾符换成 CRLF，**必须一条都不报红**。
  // 踩过：不规范化时 C1/C2 假红，并误报成「检查器失效」。Windows 编辑器默认就可能写 CRLF。
  { name: '（反向）全文换成 CRLF 行尾符 → 必须**不**报红（校验器要抗 CRLF）', expect: '!C1',
    edit: t => t.replace(/\n/g, '\r\n') },

  // ================= 第三方（独立）变异电池 · 2026-09-15 =================
  // 为什么单独一段：上面 14 条**全是我自己写的** —— 作者写的变异只覆盖作者想到的用法，
  // 于是「14/14 命中」是**自证**。第三方一上来 14 条里只命中 1 条，还是假红。
  // SOUL：**要证明检查器没烂掉，只能拿真实文件去改一处，看它红不红** —— 而且**要别人来改**。
  // 这一段每一条都对应第三方报告里的一个逃逸点，作为**永久回归**。
  { name: '[第三方 E1] 再加一条权威口径 `ASK 总配额 = 3 次`（两条并存）', expect: 'C4',
    edit: t => t.replace('**ASK 总配额 = 2 次**',
      '**ASK 总配额 = 3 次**（新增）\n    - **ASK 总配额 = 2 次**') },
  { name: '[第三方 E2] 权威口径整条改写成旧说法', expect: 'C4',
    edit: t => t.replace('**ASK 总配额 = 2 次**', '**ASK 全程只有 1 次提问配额**') },
  { name: '[第三方 E2b] 权威口径保留，另加一行改写过的旧口径（绕字面量黑名单）', expect: 'C4',
    edit: t => t.replace('**ASK 总配额 = 2 次**',
      '**ASK 总配额 = 2 次**\n    - 旧稿曾写「ASK 全程只有 1 次提问配额」') },
  { name: '[第三方 E3] 「已落」粗体里多一个字符（`**已落 ✅ 2026-09-15**`）且无核对命令', expect: 'C7',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）',
      '| 99 | 假声明 | 某处 | **已落 ✅ 2026-09-15** |\n\n## 6. 反模式（违反，不是风格问题）') },
  { name: '[第三方 E4] 删掉核对命令的期望值（比对能力整体关掉）', expect: 'C8',
    edit: t => t.replace('`grep -c "铁律九：" agents/verifier.md` → 1',
      '`grep -c "铁律九：" agents/verifier.md`') },
  { name: '[第三方 E5] 真声明改成另一个值，并在同一行加否定句（原来整行被跳过）', expect: 'C3',
    edit: t => t.replace('**最终计数**：9 → **5**（', '**最终计数**：9 → **4**（不是 9 → 5。') },
  { name: '[第三方 E6] 声明改成紧凑写法 `9→7`（原来被当成选项专名放行）', expect: 'C3',
    edit: t => t.replace('### C.7 文件地图（2026-09-15「清」之后 · 9 → 5）',
      '### C.7 文件地图（2026-09-15「清」之后 · 9→7）') },
  { name: '[第三方 E7] 模板名用子串骗过 C6（`agents/verifier.md` 模板 铁律）', expect: 'C6',
    edit: t => t.replace('`agents/dispatcher.md` 的 JOB `VERIFY` 块', '`agents/verifier.md` 模板 铁律') },
  { name: '[第三方 E8] 换掉核对命令的文件参数，并在同一行别处提到那个文件（绕身份比对）', expect: 'C8',
    edit: t => t.replace('`grep -c "M1 变异测试" agents/dispatcher.md` → 1）',
      '`grep -c "M1 变异测试" agents/verifier.md` → 1；另见 `agents/verifier.md`）') },
  { name: '[第三方 E9] 活引用指向不存在的**非 .md** 文件（原来 C5 只管 .md）', expect: 'C5',
    edit: t => t.replace('> 现在的执行者就是 `.check/check-protocol.js` 的 C7 + C8。',
      '> 现在的执行者就是 `.check/check-protocol-typo.js` 的 C7 + C8。') },
  { name: '[第三方 E10] 目录行前加一个空格（原来整行不被解析）', expect: 'C1',
    edit: t => t.replace('| **附录 E** | 自决记录（原 `decisions.md`） | 查"上次为什么这么定" |',
      ' | **附录 F** | 幽灵 | — |') },
  { name: '[第三方 E11] 目录登记一个只存在于代码围栏里的章节', expect: 'C1',
    edit: t => t.replace('| **附录 E** | 自决记录（原 `decisions.md`） | 查"上次为什么这么定" |',
      '| **附录 E** | 自决记录（原 `decisions.md`） | 查"上次为什么这么定" |\n| **99** | 围栏里的幽灵 | — |')
      .replace('```\nOK    <一行结论>', '```\n## 99. 围栏里的幽灵\nOK    <一行结论>') },
  { name: '[第三方 E12] 把 7 条「已落」的核对命令全换成万能豁免话术', expect: 'C7',
    edit: t => t.replace(/核对：`grep -c "[^"]+" [^`]+` → \d+/g, '不可核对：历史记录，不改写') },
  { name: '（反向·约定）正文里不带反引号地提到一条不存在的路径 → C5 必须**不**报红（活引用须写成代码跨度）', expect: '!C5',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）',
      '附录 E 记了一条失效引用：~/.workbuddy-ai/skills/hooks 这个路径不存在。\n\n## 6. 反模式（违反，不是风格问题）') },
  { name: '[自指] 记录里**引述**一条不存在的口径（反引号包住 `ASK 总配额 = 3 次`）→ C4 必须**不**报红', expect: '!C4',
    edit: t => t.replace('**ASK 总配额 = 2 次**', '**ASK 总配额 = 2 次**\n  （本轮记录：曾出现 `ASK 总配额 = 3 次` 的变异）') },
  { name: '[自指] 记录里**引述**一条假「已落」（反引号包住）→ C7 必须**不**报红', expect: '!C7',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）',
      '| 记录 | 变异形态 `**已落 ✅ 2026-09-15**` |\n\n## 6. 反模式（违反，不是风格问题）') },
  { name: '[自指] 记录里**引述**一个紧凑写法（反引号包住 `9→7`）→ C3 必须**不**报红', expect: '!C3',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）',
      '| 记录 | 变异形态 `9→7` |\n\n## 6. 反模式（违反，不是风格问题）') },
  { name: '（反向）正文里描述第三方仓库的目录结构（`skills/hooks/xxx`，不带反引号）→ C5 必须**不**报红', expect: '!C5',
    edit: t => t.replace('| 8 | https://github.com/hesreallyhim/awesome-claude-code |',
      '| 8b | https://example.com/x | skills/hooks/工作流精选 |\n| 8 | https://github.com/hesreallyhim/awesome-claude-code |') },
  { name: '[第三方 E13]（反向）新增一个合法附录 F（目录 + 正文都有）→ C2 必须**不**报红', expect: '!C2',
    edit: t => t.replace('| **附录 E** | 自决记录（原 `decisions.md`） | 查"上次为什么这么定" |',
      '| **附录 E** | 自决记录（原 `decisions.md`） | 查"上次为什么这么定" |\n| **附录 F** | 测试用 | 无 |')
      .replace('## 附录 A · 检索源（原 `SOURCES.md`）',
        '## 附录 F · 测试用\n\n## 附录 A · 检索源（原 `SOURCES.md`）') },

  // ============ 第三方-3（第三个独立测试者）变异电池 · 2026-09-15 ============
  // 它写了 62 条，**36 条逃逸 / 5 条假红 / 0 抛错**。这一节把**已修**的那些做成永久回归。
  // 逃逸全部落在同一类：**判据依赖字形**（标题写法 / 数字写法 / 声明写法 / 引述边界）。
  // 假红的 5 条优先修 —— **假红会训练人忽略红色**。

  // ---- C1/C2 标题写法（8 条）
  { name: '[三方-3 M02] `## 6.` 缩进 4 空格（CommonMark 里是代码块，不是标题）', expect: 'C1',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）', '    ## 6. 反模式（违反，不是风格问题）') },
  { name: '[三方-3 M03] `## 6.` 写成 `##6.`（无空格 → 不是标题 → 第 6 节消失）', expect: 'C1',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）', '##6. 反模式（违反，不是风格问题）') },
  { name: '[三方-3 M04] 未登记章节用 TAB：`##\\t7. 幽灵`', expect: 'C2',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）', '##\t7. 幽灵\n\n## 6. 反模式（违反，不是风格问题）') },
  { name: '[三方-3 M05] 未登记章节用不换行空格 U+00A0', expect: 'C2',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）', '##\u00A07. 幽灵\n\n## 6. 反模式（违反，不是风格问题）') },
  { name: '[三方-3 M42] 未登记章节写成列表项 `- ## 7. 幽灵`', expect: 'C2',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）', '- ## 7. 幽灵\n\n## 6. 反模式（违反，不是风格问题）') },
  { name: '[三方-3 M43] 未登记章节用全角空格 U+3000', expect: 'C2',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）', '##\u30007. 幽灵\n\n## 6. 反模式（违反，不是风格问题）') },
  { name: '[三方-3 M55] 未登记章节的标题文字前加零宽字符 U+200B（`## \\u200B7. 幽灵`）', expect: 'C2',
    // 注意：`##\u200B7.`（零宽紧贴 #）按 CommonMark **根本不是标题**，那样变异是空转。
    // 放在空格之后才是真风险：不可见字符不能把一条标题藏起来。
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）', '## \u200B7. 幽灵\n\n## 6. 反模式（违反，不是风格问题）') },
  { name: '[三方-3 M44] 未登记章节写成 setext（`7. 幽灵` + `===`）', expect: 'C2',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）', '7. 幽灵\n===\n\n## 6. 反模式（违反，不是风格问题）') },

  // ---- C3 数字与箭头写法（7 条）
  { name: '[三方-3 M08] 声明用 `9 => 7`（ASCII 双字符箭头）', expect: 'C3',
    edit: t => t.replace('· 9 → 5）', '· 9 => 7）') },
  { name: '[三方-3 M09] 目标值用中文数字 `9 → 七`', expect: 'C3',
    edit: t => t.replace('· 9 → 5）', '· 9 → 七）') },
  { name: '[三方-3 M10] 源值用中文数字 `九 → 7`', expect: 'C3',
    edit: t => t.replace('· 9 → 5）', '· 九 → 7）') },
  { name: '[三方-3 M11] 目标值包反引号 `9 → `7``', expect: 'C3',
    edit: t => t.replace('· 9 → 5）', '· 9 → `7`）') },
  { name: '[三方-3 M12] 换箭头字形 `9 ➜ 7`', expect: 'C3',
    edit: t => t.replace('· 9 → 5）', '· 9 ➜ 7）') },
  { name: '[三方-3 M51] 用约等号 `9 ≈ 7`', expect: 'C3',
    edit: t => t.replace('· 9 → 5）', '· 9 ≈ 7）') },
  { name: '[三方-3 M65]（反向）同一事实**反序**写 `5 ← 9` = `9 → 5` → 必须**不**报红', expect: '!C3',
    edit: t => t.replace('· 9 → 5）', '· 5 ← 9）') },

  // ---- C4 声明写法（4 条）
  { name: '[三方-3 M16] `ASK总配额 = 3 次`（ASK 与「总配额」之间不留空格）', expect: 'C4',
    edit: t => t.replace('**ASK 总配额 = 2 次**', '**ASK总配额 = 3 次**\n    - **ASK 总配额 = 2 次**') },
  { name: '[三方-3 M17] `ASK 总配额数 = 3 次`', expect: 'C4',
    edit: t => t.replace('**ASK 总配额 = 2 次**', '**ASK 总配额数 = 3 次**\n    - **ASK 总配额 = 2 次**') },
  { name: '[三方-3 M18] `ASK 的总配额 = 3 次`', expect: 'C4',
    edit: t => t.replace('**ASK 总配额 = 2 次**', '**ASK 的总配额 = 3 次**\n    - **ASK 总配额 = 2 次**') },
  { name: '[三方-3 M46] `ASK 总配额 = 3`（漏掉「次」）', expect: 'C4',
    edit: t => t.replace('**ASK 总配额 = 2 次**', '**ASK 总配额 = 3**\n    - **ASK 总配额 = 2 次**') },

  // ---- C5 路径形态（3 条）
  { name: '[三方-3 M21] 绝对路径少一个点：`~/workbuddy-ai/agents/verifier.md`', expect: 'C5',
    edit: t => t.replace('`~/.workbuddy-ai/agents/verifier.md`', '`~/workbuddy-ai/agents/verifier-typo.md`') },
  { name: '[三方-3 M25] 换根目录：`~/.workbuddy/agents/verifier.md`', expect: 'C5',
    edit: t => t.replace('`~/.workbuddy-ai/agents/verifier.md`', '`~/.workbuddy/agents/verifier-typo.md`') },
  { name: '[三方-3 M68] 用 markdown 链接写失效路径', expect: 'C5',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）',
      '[verifier](~/.workbuddy-ai/agents/ghost.md)\n\n## 6. 反模式（违反，不是风格问题）') },

  // ---- C6 锚点写法（3 条）
  { name: '[三方-3 M27] 锚点词加粗 `**铁律十二**`', expect: 'C6',
    edit: t => t.replace('`agents/verifier.md` 铁律九 |', '`agents/verifier.md` **铁律十二** |') },
  { name: '[三方-3 M28] 锚点写成描述式 `的第 12 条铁律`', expect: 'C6',
    edit: t => t.replace('`agents/verifier.md` 铁律九 |', '`agents/verifier.md` 的第 12 条铁律 |') },
  { name: '[三方-3 M66] 锚点用圈码 `铁律⑫`', expect: 'C6',
    edit: t => t.replace('`agents/verifier.md` 铁律九 |', '`agents/verifier.md` 铁律⑫ |') },

  // ---- C7 声明写法（4 条）
  { name: '[三方-3 M32] 状态格写 `✅ **已落**` 并删掉核对命令', expect: 'C7',
    edit: t => t.replace('| **已落**（核对：`grep -c "铁律九：" agents/verifier.md` → 1） |', '| ✅ **已落** |') },
  { name: '[三方-3 M33] 状态格写 `**已 落**`（中间一个空格）并删掉命令', expect: 'C7',
    edit: t => t.replace('| **已落**（核对：`grep -c "铁律九：" agents/verifier.md` → 1） |', '| **已 落** |') },
  { name: '[三方-3 M34] 状态格写 `**【已落】**` 并删掉命令', expect: 'C7',
    edit: t => t.replace('| **已落**（核对：`grep -c "铁律九：" agents/verifier.md` → 1） |', '| **【已落】** |') },
  { name: '[三方-3 M54] 状态格写 `**\\u200b已落**`（零宽前缀）并删掉命令', expect: 'C7',
    edit: t => t.replace('| **已落**（核对：`grep -c "铁律九：" agents/verifier.md` → 1） |', '| **\u200B已落** |') },

  // ---- C8（2 条）
  { name: '[三方-3 M41] 两行命令**对调** → 声明与核对指错对象', expect: 'C8',
    edit: t => t.replace('`grep -c "铁律九：" agents/verifier.md`', '`grep -c "铁律十：" agents/verifier.md`') },
  { name: '[三方-3 M36]（反向）期望值箭头写 `=>` —— 解析器认它，且期望值仍等于实际 → 必须**不**报红', expect: '!C8',
    edit: t => t.replace('`grep -c "铁律九：" agents/verifier.md` → 1', '`grep -c "铁律九：" agents/verifier.md` => 1') },

  // ---- 反向断言：**合法写法不许报红**（5 条假红 + 2 条口径边界）
  { name: '[三方-3 M13]（反向）澄清句 `并非 9 → 7，而是 9 → 5` → 必须**不**报红', expect: '!C3',
    edit: t => t.replace('· 9 → 5）', '· 并非 9 → 7，而是 9 → 5）') },
  { name: '[三方-3 M19]（反向）`ASK 总配额不是 1 次，而是 2 次` → 必须**不**报红', expect: '!C4',
    edit: t => t.replace('**ASK 总配额 = 2 次**', '**ASK 总配额不是 1 次，而是 2 次**') },
  { name: '[三方-3 M23]（反向）围栏里放一条失效路径**作反例** → 必须**不**报红', expect: '!C5',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）',
      '```\n反例：`~/.workbuddy-ai/agents/ghost.md` 不存在\n```\n\n## 6. 反模式（违反，不是风格问题）') },
  { name: '[三方-3 M29]（反向）围栏里放一条坏锚点**作反例** → 必须**不**报红', expect: '!C6',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）',
      '```\n反例：`agents/verifier.md` 铁律一百 不存在\n```\n\n## 6. 反模式（违反，不是风格问题）') },
  { name: '[三方-3 M35]（反向）核对命令用**单引号** → 必须**不**报红', expect: '!C7',
    edit: t => t.replace('`grep -c "铁律九：" agents/verifier.md`', "`grep -c '铁律九：' agents/verifier.md`") },
  { name: '[三方-3 M??]（反向）粗体真声明 `9 → **5**` → 必须**不**报红', expect: '!C3',
    edit: t => t.replace('· 9 → 5）', '· 9 → **5**）') },
  { name: '[三方-3 M??b]（反向）合法路径所在行出现「产品」二字 → 必须**不**报红（ATTRIB 已删）', expect: '!C5',
    edit: t => t.replace('**要注入子代理**（设计选择，非产品强制）', '**要注入子代理**（设计选择，产品不强制）') },

  // ============ 第三方-2（第二轮独立）变异电池 · 2026-09-15 ============
  // 它独立写了 41 条，**10 命中 / 31 逃逸**。这一节把**已修**的那些做成永久回归；
  // **未修的（N10/N11/N13/N19/N40）不写成变异** —— 它们明写在 LIMITATIONS 里，
  // 写成"期望报红"的变异会变成一条永远红的断言，那会训练人忽略红色。
  { name: '[第三方-2 N1] 真声明改用 `9 -> 7`（只认 → 字符）', expect: 'C3',
    edit: t => t.replace('### C.7 文件地图（2026-09-15「清」之后 · 9 → 5）',
      '### C.7 文件地图（2026-09-15「清」之后 · 9 -> 7）') },
  { name: '[第三方-2 N2] 真声明写成 `9→ 7`（只在一侧加空格）', expect: 'C3',
    edit: t => t.replace('### C.7 文件地图（2026-09-15「清」之后 · 9 → 5）',
      '### C.7 文件地图（2026-09-15「清」之后 · 9→ 7）') },
  { name: '[第三方-2 N3] 真声明用全角数字 `9 → ７`', expect: 'C3',
    edit: t => t.replace('### C.7 文件地图（2026-09-15「清」之后 · 9 → 5）',
      '### C.7 文件地图（2026-09-15「清」之后 · 9 → ７）') },
  { name: '[第三方-2 N35]（反向）把真声明包进反引号 `9 → 7` → 引述，C3 必须**不**报红', expect: '!C3',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）',
      '| 记录 | 变异形态 `9 → 7` |\n\n## 6. 反模式（违反，不是风格问题）') },
  { name: '[第三方-2 N5] 矛盾口径用中文数字 `ASK 总配额 = 三次`', expect: 'C4',
    edit: t => t.replace('**ASK 总配额 = 2 次**', '**ASK 总配额 = 三次**（新加的）\n    - **ASK 总配额 = 2 次**') },
  { name: '[第三方-2 N22] 矛盾口径用全角冒号 `ASK 总配额：3 次`', expect: 'C4',
    edit: t => t.replace('**ASK 总配额 = 2 次**', '**ASK 总配额：3 次**\n    - **ASK 总配额 = 2 次**') },
  { name: '[第三方-2 N6] 旧口径写成小写 `ask`', expect: 'C4',
    edit: t => t.replace('**ASK 总配额 = 2 次**',
      '**ASK 总配额 = 2 次**\n    - 旧稿：ask 全程只有 1 次提问配额') },
  { name: '[第三方-2 N7] 旧口径行尾补「最多 2 次」洗白（SHIELD 原来只认 总配额|最多）', expect: 'C4',
    edit: t => t.replace('**ASK 总配额 = 2 次**',
      '**ASK 总配额 = 2 次**\n    - ASK 全程只有 1 次提问配额，最多 2 次') },
  { name: '[第三方-2 N8] 活引用用 CJK 文件名（字符类不认 CJK → 截断成父目录）', expect: 'C5',
    edit: t => t.replace('`~/.workbuddy-ai/agents/verifier.md`',
      '`~/.workbuddy-ai/agents/验证器-typo.md`') },
  { name: '[第三方-2 N9] 活引用路径含空格（截断成 `agents/veri`）', expect: 'C5',
    edit: t => t.replace('`~/.workbuddy-ai/agents/verifier.md`',
      '`~/.workbuddy-ai/agents/veri fier.md`') },
  { name: '[第三方-2 N29] 活引用用反斜杠路径（原来完全不进枚举）', expect: 'C5',
    edit: t => t.replace('`~/.workbuddy-ai/agents/verifier.md`',
      '`~/.workbuddy-ai\\agents\\verifier-typo.md`') },
  { name: '[第三方-2 N38] 通配引用指向不存在的形态（原来截断成 `skills/` → 恒存在）', expect: 'C5',
    edit: t => t.replace('`skills/*/SKILL.md`', '`skills/*/SKILL-typo.md`') },
  { name: '[第三方-2 N14] 假已落**不带粗体**（3 列表格行）', expect: 'C7',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）',
      '| 9 | 某处 | 已落 |\n\n## 6. 反模式（违反，不是风格问题）') },
  { name: '[第三方-2 N15] 真已落写成 `** 已落 **`（粗体内前导空格）且删掉核对命令', expect: 'C7',
    edit: t => t.replace('| **已落**（核对：`grep -c "铁律九：" agents/verifier.md` → 1） |',
      '| ** 已落 ** |') },
  { name: '[第三方-2 N16] 假已落用下划线粗体 `__已落__`', expect: 'C7',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）',
      '| 99 | 假声明 | __已落__ |\n\n## 6. 反模式（违反，不是风格问题）') },
  { name: '[第三方-2 N33] 假已落整条包进代码跨度且放在单元格开头', expect: 'C7',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）',
      '| 99 | 假声明 | `**已落 ✅ 2026-09-15**` |\n\n## 6. 反模式（违反，不是风格问题）') },
  { name: '[第三方-2 N26] 豁免原因换成同义万能话术（「原始证据已随合并被覆盖」）', expect: 'C7',
    edit: t => t.replace('| **已落**（核对：`grep -c "铁律九：" agents/verifier.md` → 1） |',
      '| **已落**（不可核对：原始证据已随合并被覆盖） |') },
  { name: '[第三方-2 N17] 删掉紧跟命令的期望值，在行里别处放一个 `→ 1`（第三兜底接住）', expect: 'C8',
    edit: t => t.replace('| **已落**（核对：`grep -c "铁律九：" agents/verifier.md` → 1） |',
      '| **已落**（核对：`grep -c "铁律九：" agents/verifier.md`）另见 → 1 |') },
  { name: '[第三方-2 N18] 3 列表格行 → 落点列=含命令的那一格（自证）', expect: 'C8',
    edit: t => t.replace('| 4 | 验收加**增量规则**（增量验 + 最终全量） | `agents/verifier.md` 铁律九 | **已落**（核对：`grep -c "铁律九：" agents/verifier.md` → 1） |',
      '| 4 | `agents/verifier.md` 铁律九 | **已落**（核对：`grep -c "铁律九：" agents/verifier.md` → 1） |') },
  { name: '[第三方-2 N20] 正文标题前加一个空格（CommonMark 里仍是标题）', expect: 'C2',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）',
      ' ## 8. 幽灵章节\n\n## 6. 反模式（违反，不是风格问题）') },
  { name: '[第三方-2 N21] 目录登记的章节藏在 `~~~` 围栏里（只认三反引号）', expect: 'C1',
    edit: t => t.replace('| **附录 E** | 自决记录（原 `decisions.md`） | 查"上次为什么这么定" |',
      '| **附录 E** | 自决记录（原 `decisions.md`） | 查"上次为什么这么定" |\n| **98** | 围栏里的幽灵 | — |')
      .replace('## 0. 输出契约（最高优先级，先于一切风格偏好）',
        '~~~\n## 98. 围栏里的幽灵\n~~~\n\n## 0. 输出契约（最高优先级，先于一切风格偏好）') },
  { name: '[第三方-2 N28] 铁律锚点写阿拉伯数字 `铁律 15`', expect: 'C6',
    edit: t => t.replace('`agents/verifier.md` 铁律九 |', '`agents/verifier.md` 铁律 15 |') },
  { name: '[补 M38 反向] 权威口径写成中文数字 `两次`（值仍是 2）→ C4 必须**不**报红', expect: '!C4',
    edit: t => t.replace('**ASK 总配额 = 2 次**', '**ASK 总配额 = 两次**') },
  { name: '[补 M38b] 权威口径写成全角数字 `２次`（值仍是 2）→ C4 必须**不**报红', expect: '!C4',
    edit: t => t.replace('**ASK 总配额 = 2 次**', '**ASK 总配额 = ２次**') },
  { name: '[第三方-2 N24]（反向）核对命令用 `^` 锚定，期望值就是真值 → 无条件 -1 会造成假红', expect: '!C8',
    edit: t => t.replace('| **已落**（核对：`grep -c "验证强度跟着任务生命周期走" MODE.md` → 1） |',
      '| **已落**（核对：`grep -c "^## 附录" MODE.md` → 5） |') },
];

/* 【2026-09-15 加】残洞清单 —— **PASS 不等于协议正确。**
 * 为什么必须印出来：第三方-2 独立写了 41 条变异，**31 条逃逸**。
 * 修完 9 项之后仍然有结构性的洞（正则跑在自由文本上）。
 * 如果不印，读的人会把「8/8 PASS」读成「协议是对的」——
 * 那正是 SOUL 说的「用错误的确定性把洞填上」。**要豁免就在众人眼前豁免。** */
const LIMITATIONS = [
  '本检查器是**正则 + 轻量结构解析**，跑在自由文本上。它挡的是**一致性回归**，不证明协议内容正确。',
  'PASS 只表示这 8 类**结构一致性**成立。',
  'C1/C2 · setext 标题**只认 `=` 下划线** —— `-` 下划线在本文档里与分节横线同形，认它会制造假红。',
  'C3 · 连接符认 ASCII 两字符箭头（`->` `=>` `<-` `<=`）与 Unicode 箭头/符号区段；**区段外的自造字形仍会逃**。',
  'C3 · 反向箭头只认 `<-` `<=` 与 6 个左向符号；其余左向字形按右向处理。',
  'C3 · 源值必须等于 9 才当成"这个量"——把源值也改掉（`8 → 5`）会让这条声明对 C3 不可见。',
  'C5 · **不带反引号的路径不判存在性**（活引用须写成代码跨度）—— 明写的放弃项（第三方 N11 / N34）。',
  'C5 · 合并前文件名的豁免**按文件名全局**生效，不限它所在的附录区块（第三方 N10，未修）。',
  'C5 · `docs/` 一律当产品文档命名空间放行 —— 本机若真有 `docs/` 目录，其中的失效引用不会被抓。',
  'C5 · 裸文件名（`MEMORY.md` 这种）只有进了 EXEMPT 表的才被枚举（第三方 N40，未修）。',
  'C6 · 跨文件锚点里的**文件名必须写成代码跨度** —— 不写反引号就完全不被枚举（第三方 N13，明写的放弃项）。',
  'C6 · `模板 X` 的 X 与目标文件里的名字**逐字相同**才算命中（不做同义词归一）。',
  'C7 · 声明必须落在**表格**里才被认到（非表格里的裸「已落」不判，第三方 N19 / N33）。',
  'C7 · 整条包进代码跨度的**真**声明会被当成引述放行（第三方 N35）—— 这是「引述不算声明」的代价。',
  'C8 · 只跑 `grep -c` 形态的命令；其他形态的核对命令不解析。',
  'C8 · 自指扣减靠"命令文本出现在被 grep 的文件里"推断，**不是精确计数**。',
  'C8 · 用 `--file` 跑副本时，核对命令读的仍是磁盘上的真文件 —— 计数结论**对被测文本不成立**（第三态）。',
  'C2 · 附录**内部**的 `##` 级小节会被要求登记 —— 契约是「`##` = 顶层，`###` = 附录内部」，越界即红（第四个测试者 F04/F05/F06 的修复代价）。',
  'C5 · 代码跨度**紧邻**（前后各 6 字）写着「不存在 / 没有 / 未安装 / 未创建 / 未找到 / 缺失 / 已删除 / 不在了 / 无此」时，按**陈述缺席**放行 —— 真实引用旁边恰好写这些词会被放过（第四个测试者 F28 的修复代价，方向认：假红比逃逸贵）。',
  'C5 · `EXEMPT_PATH` 改成**前缀匹配**（`~/.codebuddy/agents` 及其下级全豁免）—— 该目录下任何路径都不判存在性（第四个测试者 F15 的修复代价）。',
  'C6 · 锚点文件名允许 `~/` 开头，按**用户主目录**解析；`~/.workbuddy-ai/…` 按 HOME 解析（第四个测试者 F16）。',
  'C7 · 认声明只看「**「已落」之前有没有字母/数字/汉字**」—— 于是「写法 / 含义」这类**词汇定义表**里的 `| 已落 | … |` 行会被当成声明报红（第四个测试者 F21，**未修**：要区分它与真声明必须读表头语义，而放宽的代价是放过裸声明）。',
  'C7 · `grep -c -e "…" f` 已认；其他选项组合（`-ce` / `--count` / `-F`）仍不被解析（第四个测试者 F24 的**部分**修复，不假装全认）。',
  'C8 · 落点列比对已归一 `./` 前缀；其他等价写法（绝对路径 / `~` / 大小写）仍按字面比（第四个测试者 F23 的**部分**修复）。',
  'C3 · 判据要求源值也等于 9，所以只改**目标值**才可观测。第四个测试者 F07（`9 份 → 4`）**明写为不修** —— 放宽邻接会误伤「9 个文件 → 4 个」，代价是假红。',
  'C7 · **不交叉核对计数声明**（「本附录 7 条「已落」」这类）—— 于是**删掉一整行声明不会被抓**（第四个测试者 F25）。实测：文档里两处计数（本附录 7 条 / 附录 D 里 4 条）指的是**不同范围**，按全局计数比对会造出假红。**先量过再决定不修。**',
  'C4 · 旧口径按**句式**抓。换成不含「配额 / 提问 / 询问」的句子（如「全程可以问 1 次」）仍会逃（第四个测试者 F09）—— 加「问」字会误伤普通句子，明写不修。',
  'C5 · 目录引用（尾斜杠）现在判存在性；**绝对 Windows 路径（`C:\\…`）仍不被枚举**（路径字符类里没有 `:`）。',
  'C5 · 相对 markdown 链接现在判存在性；带协议 / 纯 `#锚点` / 绝对路径的不判（第四个测试者 F12）。',
  'C6 · 文件名与锚点词之间允许「的 / 里 / 中 / 内」（1–2 字）；其他连接词仍不认（第四个测试者 F17）。',
  'C6 · 连接词**只枚举这一份**，不认「上的 / 边的」等（第二轮 G09）。**不修的理由是实测出来的**：把窗口放宽到任意 1–2 汉字，会让「`agents/verifier.md` 中的模板 2b 已删除」被读成锚点引用 → 假红（G07）。**同一条轴上窄了会漏、宽了会假红，我选窄**（假红比逃逸贵）。',
  'C5 · 缺席窗口**在结构边界处截断**（单元格 `|`、句读、行尾）—— 但**同一个小句里语义无关**的缺席词仍会放行（第二轮 G01–G03 的部分修复）。',
  'C5 · 形如域名的首段（`easings.net/`）不当本机路径；链接目标里没有 `/` 的一律不判（第二轮 G04 / G05 的修复代价）。',
  '⚠ **缺席词表是枚举的，天生不完备**（`ABSENT_RE`，六轮里加了两次）。缺席是**语义**概念，我用**词表**近似 —— **这是本检查器的设计天花板，不是待办事项。** 认不出的缺席写法会继续报假红。',
  /* ---- 期 1（拆文件）引入的三条边界 ---- */
  'C1/C2 · **只看 `MODE.md`** —— 附录拆到 `refs/` 之后，`refs/` 里的 `##` 级标题**不登记进目录**。契约是「`##` = MODE.md 顶层，`###` = 附录内部」；在 `refs/` 里写 `##` 不会被 C2 抓。',
  'C3/C5/C6 · 扫的是**文件集**（`MODE.md` + `refs/*.md`，定义在 `.check/fileset.js`）。`refs/` 下新增文件会自动进入检查范围 —— **拆文件不等于内容少了，检查范围必须跟着搬**。',
  'C5/C6 · 行号现在是 **`文件:行`**（如 `refs/D-retro.md:203`）；`--file` 跑副本时退回纯数字。C8 仍用全局行号做算术（`lines[g.line - 1]`），**两者不能合并**。',
  '⚠ **冻结豁免**（`.check/fileset.js` 的 `FROZEN`）：清单里的文件**不进检查范围**，条件是 **md5 不变**。md5 一变豁免自动作废、文件重新进入检查范围并报红 —— 豁免**自己会失效**，不是永久放行。每次运行都印出来。',
  'C8 · **自指扣减只在被 grep 的那个文件的内容里数**（期 1 修）。命令住在 `refs/D-retro.md` 而它 grep `MODE.md` 时，命令文本不在目标文件里 —— 按全文数会**凭空少 1**（实测：真值 1 被扣成 0 → 假红）。',
];

/* 冻结档案的豁免**必须打出来** —— 一个不打印的豁免就是一张裸的允许清单。
 * 「要豁免就在众人眼前豁免。」 */
function printFrozen(t) {
  if (t && t.frozen && t.frozen.length) {
    for (const f of t.frozen) {
      console.log('· 冻结豁免 `refs/' + f.file + '`（md5 ' + f.md5.slice(0, 8) + '… 未变）—— 不进检查范围');
      console.log('  理由：' + f.why);
      console.log('  **改它这个豁免就自动作废**：md5 一变，文件重新进入检查范围并报红。');
    }
  }
  if (t && t.revived && t.revived.length) {
    for (const r of t.revived) {
      console.log('⚠ `refs/' + r.file + '` **被改动过**（期望 md5 ' + r.want.slice(0, 8) +
        '…，实际 ' + r.got.slice(0, 8) + '…）—— 冻结豁免**作废**，本文件已重新进入检查范围。');
      console.log('  要么把它改回冻结版本，要么在 `.check/fileset.js` 的 FROZEN 里重新说明为什么可以豁免。');
    }
  }
}

function printResults(res, title) {
  console.log('=== ' + title + ' ===');
  let fail = 0, unv = 0;
  for (const r of res) {
    const tag = r.state === 'PASS' ? 'PASS      ' : (r.state === 'FAIL' ? 'FAIL      ' : 'UNVERIFIED');
    if (r.state === 'FAIL') fail++;
    if (r.state === 'UNVERIFIED') unv++;
    console.log(tag + ' ' + r.id + '  ' + r.name);
    for (const n of r.notes) console.log('             · ' + n);
    for (const f of r.fails) console.log('             ✗ ' + f);
  }
  const pass = res.length - fail - unv;
  console.log('----');
  console.log('检查项 ' + res.length + '：PASS ' + pass + ' / FAIL ' + fail + ' / UNVERIFIED ' + unv);
  console.log('----');
  console.log('⚠ 这个 PASS 的**边界**（读完再下结论）：');
  for (const L of LIMITATIONS) console.log('   · ' + L);
  return { fail, unv, pass };
}

const argv = process.argv.slice(2);

if (argv.includes('--mutate')) {
  const t0 = readTarget();
  const base = t0.text;
  const baseRes = run(base, t0.file, t0.segs);
  const baseBad = baseRes.filter(r => r.state !== 'PASS').map(r => r.id);
  console.log('基线：' + (baseBad.length ? '非 PASS 的检查项 ' + baseBad.join(',') : '全部 PASS'));
  console.log('（变异测试的前提是基线干净 —— 否则红的原因分不清是变异还是原有缺陷）\n');
  if (baseBad.length) { console.log('FAIL 基线不干净，先修基线再谈变异'); process.exit(2); }
  let hit = 0;
  MUTATIONS.forEach((mu, i) => {
    const mutated = mu.edit(base);
    if (mutated === base) { console.log('FAIL M' + (i + 1) + ' 锚点没匹配上：' + mu.name); return; }
    const res = run(mutated, t0.file, t0.segs);
    const got = res.filter(r => r.state === 'FAIL').map(r => r.id);
    const unv = res.filter(r => r.state === 'UNVERIFIED');
    // expect 以 '!' 开头 = **反向断言**：这一项必须**不**报红。
    // 没有反向断言的话，「显式豁免」这类分支就是没测过的代码 —— 而没测过的分支
    // 与「不存在的分支」在输出上无法区分。
    const neg = mu.expect.charAt(0) === '!';
    const want = neg ? mu.expect.slice(1) : mu.expect;
    const ok = neg ? !got.includes(want) : got.includes(want);
    if (ok) hit++;
    // 【2026-09-15 修】原来只看 FAIL。检查器自己抛错会变成 UNVERIFIED，
    // 在变异测试里显示成「没报红」—— 与「变异没被打中」长得一模一样。
    // 「一个不产生输出的失败，比不跑更危险」：红要红得出来，错也要错得出来。
    console.log((ok ? 'OK  ' : 'FAIL') + ' M' + (i + 1) + ' 期望 ' + (neg ? want + ' **不**报红' : want + ' 报红') + '，实际报红 [' +
      (got.join(',') || '无') + ']' +
      (unv.length ? '  ⚠ UNVERIFIED [' + unv.map(u => u.id + ':' + u.notes.join(';')).join(' | ') + ']' : '') +
      '  ' + mu.name);
  });
  console.log('----');
  console.log('变异 ' + hit + '/' + MUTATIONS.length + ' 命中');
  process.exit(hit === MUTATIONS.length ? 0 : 1);
}

const t = readTarget();
printFrozen(t);
const res = run(t.text, t.file, t.segs);
const { fail, unv } = printResults(res, '协议校验 · ' + t.file + (t.file === MODE ? '' : '（--file 副本）'));
process.exit(fail ? 1 : (unv ? 2 : 0));
