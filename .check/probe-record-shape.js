#!/usr/bin/env node
/* probe-record-shape.js —— 记录层「逐行形状」的**判据 + 双向测**（ISS-050）
 *
 * 规则实现在 `.check/record-shape.js`（**唯一一份**），本文件只做三件事：
 *   `--scan`   判定真记录（判据；有命中 exit 1）
 *   `--inject` 双向测：畸形行**必须**被抓、合法行**不得**被抓、已知边界**确认抓不住**
 *   `--holes`  被否决的那族规则单独打印（附量化误伤数）—— 留给「想顺手加空括号检查」的人
 *
 * ---- 为什么判据在这里，而不在 `andyngo-integrity.js`（I8/I9/I10）---------------
 * 第一版我确实加进了 `andyngo-integrity.js`，跑出 `17 OK / 0 FAIL`，**然后回退了**。
 * 理由：该文件当时是 **W9 第六轮独立复验的冻结件**（`e8d1386e…` · 537 行 · 结论未回）。
 * 在复验进行中改被测件，会让复验结论**落在已经不存在的版本上** ——
 * 本仓库**已经吃过一次**这个亏：CHG-061 记着「双向测第 1 次**因被测件被第三方改写而整次作废**」。
 * **不改冻结件不是洁癖，是因为改了以后「验证过了」这句话就没有指称对象了。**
 * 回退后实测 md5 复原为 `e8d1386e91e983c4961f5796a2486558`（逐字节一致），复验继续有效。
 * 新判据放在**新文件**里 —— 新文件不在任何待复验面上，没有这个问题。
 *
 * ---- 为什么要独立成判据（ISS-050 的问题陈述）-------------------------------
 * `issues.md` / `decisions.md` / `changes.md` 的**行**从来没有被任何判据解析过：
 * I1–I7 只解析 `eventlog/`。ISS-048 那一行三个片段被 shell 吃掉、留下空洞，
 * 而**全部判据都报绿**（实测：`newid.js --check` exit 0 · `andyngo-integrity.js` 14 OK / 0 FAIL）。
 * 记录层既是「判据的输入」也是「人的读物」—— **一行读不通的记录不会触发任何红灯**，
 * 却会让依据它的判断出错（同族 ISS-026：那条是「文件看不见」，这条是「行看不出来」）。
 *
 * 退出码：0 = 干净 / 全部向量符合预期 · 1 = 有命中或向量不符合预期 · 4 = 参数错
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { SPEC, hints, classify, checkLine, scanText, CHG_FIELD_BASELINE, chgShiftBad,
  ISS_FIELD_BASELINE, DEC_FIELD_BASELINE, issFieldBad, decFieldBad, DUP_BASELINE, dupGroups } =
  require('./record-shape.js');

const HOME = path.resolve(__dirname, '..');
const RECORD = path.join(HOME, '.check', 'record');
const MIN = {}; for (const s of SPEC) MIN[s.prefix] = s.min;

/* 规则 ⑦ 需要**全文件视野**，`checkLine` 是单行函数、结构上测不到它 ——
 * 所以它的向量是**文本级**的，而「谁算记录行」这一步由本函数独立重收一遍
 * （与 `scanText` 共用 `dupGroups` 判法本体，但**不共用**输入收集 —— 口径同 ⑤/⑥）。 */
function collectRecs(text, prefix) {
  const recs = [];
  const idRe = new RegExp('^' + prefix + '-(\\d+) ');
  let inBody = false;
  text.replace(/\r\n/g, '\n').split('\n').forEach((l, i) => {
    const k = classify(l, prefix, inBody);
    if (k === 'rule') inBody = true;
    if (k !== 'record') return;
    const nm = idRe.exec(l);
    recs.push({ no: i + 1, num: nm ? +nm[1] : 0, id: l.slice(0, 12), body: l.replace(idRe, '') });
  });
  return recs;
}
/* ⑦ 的命中条数 —— **单独数**，好把 ⑦ 的贡献从其它规则的贡献里剥出来
 * （否则一条向量同时被 ④ 和 ⑦ 抓到，就分不清是谁抓的）。 */
function dupHits(text, prefix) {
  return scanText(text, { prefix: prefix, min: MIN[prefix] }).bad
    .filter((x) => x.why.some((w) => w.indexOf('同体异号') >= 0)).length;
}

/* ---- 注入向量：畸形行**必须**被抓 ------------------------------------------ */
const INJECT = [
  { why: '整段被吃：字段数塌到下限以下',
    line: 'ISS-901 open 2026-09-16T00:00Z' },
  { why: '编号丢了前导零',
    line: 'ISS-92 open 2026-09-16T00:00Z 2026-09-16T00:00Z low 描述 EVT 900' },
  { why: '前缀被整段吃掉（该行落在记录区里却没有前缀）',
    line: '901 open 2026-09-16T00:00Z 2026-09-16T00:00Z low 描述 EVT 900',
    as: 'ISS', by: 'stray' },
  { why: 'CHG 掉了一整列（md5 对消失）→ 必须按 CHG 的 9 字段下限判',
    line: 'CHG-904 2026-09-16T00:00Z 某文件 -- -- 10 10 DEC-900' },
  { why: '制表符混进正文',
    line: 'ISS-908 open 2026-09-16T00:00Z\t2026-09-16T00:00Z low 描述 EVT 900' },
  { why: '号重复：正文文件里又写了一遍号 → 行首成了 `ISS-910 ISS-910 …`（ISS-085）',
    line: 'ISS-910 ISS-910 open 2026-09-16T00:00Z 2026-09-16T00:00Z low 描述 EVT 900' },
  /* ★ 规则 ⑥ 的**真阳性族**（ISS-112 要求 ≥6 条）—— 前 5 条各钉一栏。
   * 第 6 条（「右移一位的 `ISS-082` 形状」）**不在这里**：它在基线内 → 归 BOUNDARY
   * （ISS-112 原文要求「必须写明确：是判据要抓、还是按已登记豁免放行」→ 答案是**后者**）。 */
  { why: '前导字段被吃掉：状态整段缺失、描述上来了 → **字段数反而更多**，规则 ② 看不见（ISS-112）',
    line: 'ISS-915 【新发现】状态整段缺失 描述里带空格 会让字段数 远超下限 规则二 看不见 它 EVT 900',
    exact: 4 },   // f2/f3/f4/f5 四栏全报（整行右移一位）
  { why: '字段 2 是 `【**…`（真实例 ISS-105/106/107 的形态）',
    line: 'ISS-916 【**「守门人与被守的规则不在同一个文件」 描述 够长 让字段数 超过 下限 EVT 900' },
  { why: '字段 3（首现）不是 ts —— 字段数 **9 ≥ 下限 7**，规则 ② 看不见（ISS-112 ③）',
    line: 'ISS-917 open 不是时间 2026-09-16T00:00Z medium 描述 够长 EVT 900', exact: 1 },
  { why: '字段 4（最后更新）不是 ts（ISS-112 ④）',
    line: 'ISS-918 open 2026-09-16T00:00Z 也不是时间 medium 描述 够长 EVT 900', exact: 1 },
  { why: '字段 5（严重度）**被换成别的词** —— 字段数**不变**，规则 ② 抓不住（ISS-112 ⑤）',
    line: 'ISS-919 open 2026-09-16T00:00Z 2026-09-16T00:00Z 中 描述 够长 EVT 900', exact: 1 },
  { why: 'DEC 字段 2 是描述开头 → 整行右移（真实例 DEC-029/030）',
    line: 'DEC-931 立规：**写下「不可回溯」 依据：实测 替代方案：无 后果：无 EVT 900', exact: 1 },
  /* ★ ISS-090 的原始签名：**第 3 字段（文件路径）含空格 → 后面所有字段整体左移一位**。
   * 实测（CHG-106）：f4 变成路径的第二段、**f5 变成「改前 md5」**（X5 本意取改后）。
   * 这一条是**规则 ⑤** 存在的唯一理由 —— 没有它，字段数变多，② 看不见。 */
  { why: 'CHG 第 3 字段含空格 → 字段整体左移（ISS-090；f4 变成路径第二段、f5 变成改前 md5）',
    line: 'CHG-912 2026-09-16T00:00Z C:/Users/x/Desktop/andyngo build.md.txt 11111111111111111111111111111111 22222222222222222222222222222222 1222 1224 记项目外文件 DEC-900' },
  /* ★ 规则 ⑥ 的两族基线已于 2026-09-17（W23 J18）**降为 0** —— 原「`≤ ISS-107` / `≤ DEC-30`
   * 的历史行刻意不判」那两条边界随之**撤销**，向量从 `BOUNDARY` **移到本数组**：
   * 现在**任何号**的字段身份违规都必须抓。（号仍用原基线内的 `ISS-105` / `DEC-029`，
   * 正是为了钉住「旧基线不再有任何豁免含义」这件事本身。） */
  { why: '**原基线内**的 ISS 行（号 `ISS-105`）字段身份违规 —— 基线降 0 后**必须抓**（该向量原在 BOUNDARY）',
    line: 'ISS-105 【新发现】构造行：号在**旧**基线内 → 规则 ⑥ **现在要判** 描述够长 让字段数 超过下限 EVT 900' },
  { why: '**原基线内**的 DEC 行（号 `DEC-029`）字段 2 不是 ts —— 基线降 0 后**必须抓**（该向量原在 BOUNDARY）',
    line: 'DEC-029 立规：**写下「不可回溯 依据：实测 替代方案：无 后果：无 EVT 900' },
];

/* ---- 反向向量：合法行**不得**被抓（假红守门人）------------------------------ */
const INJECT_OK = [
  { why: '合法 ISS 行（含中文引号、括号里**有**内容）',
    line: 'ISS-905 open 2026-09-16T00:00Z 2026-09-16T00:00Z low 描述里有（正常括号）与「正常引号」 EVT 900' },
  { why: '合法 ISS 行：**引用代码**，空括号与空方括号是代码常态（这正是 HOLES 被否决的原因）',
    line: 'ISS-909 resolved 2026-09-16T00:00Z 2026-09-16T00:00Z low 实测 `Array.isArray(f1)` 与 `f1[0]` 都对 EVT 900' },
  /* ★ 规则 ⑥ 的反向守门人（ISS-112 要求 4 条真阴性）——
   * 没有这三条，规则 ⑥ 很容易被写成「字段 2 只能是 open/resolved」或「ts 必须带秒」→ 合法行全红。 */
  { why: '合法 ISS 行：状态是**分支值** `wontfix`（状态机图里的 `↘`）—— 漏了它合法行会被判红（ISS-112）',
    line: 'ISS-926 wontfix 2026-09-16T00:00Z 2026-09-16T00:00Z info 描述 EVT 900' },
  { why: '合法 ISS 行：ts **不带秒**（`hh:mmZ`）—— ISS-107 的两套口径，只收一种就是制造假红',
    line: 'ISS-927 open 2026-09-16T00:00Z 2026-09-16T00:00Z low 描述 EVT 900' },
  { why: '合法 ISS 行：首现带分、最后更新**带秒**（实测 3 行如此）—— 两栏精度**互不影响**',
    line: 'ISS-928 verified 2026-09-16T00:00Z 2026-09-16T00:00:33Z critical 描述 EVT 900' },
  { why: '合法 CHG 行（9 字段下限，实际远超）',
    line: 'CHG-906 2026-09-16T00:00Z a/b.js 11111111111111111111111111111111 22222222222222222222222222222222 10 20 原因写在这里 DEC-900' },
  { why: '合法 DEC 行',
    line: 'DEC-907 2026-09-16T00:00Z 决策 依据：实测 替代方案：无 后果：无 EVT 900' },
  { why: '表头行（`---` 之前）不是记录，不得算「形状不明」',
    line: '格式：`ISS-<序号> <状态> <首现> <最后更新> <严重度> <描述> <关联事件>`', as: 'ISS', header: true },
  { why: '**合法自指**：正文里引用自己的号（ISS-063 的「补充」形态）—— 不得判成「号重复」',
    line: 'ISS-911 open 2026-09-16T00:00Z 2026-09-16T00:00Z low 【补充 ISS-911：已复现】描述 EVT 900' },
  /* ★ 规则 ⑤ 的反向守门人：CHG 有两种**合法**的「非 md5」形态，误伤它们就是假红。
   * 没有这两条，规则 ⑤ 很容易被写成「f4/f5 必须是 md5」→ 新建文件与勘误全红。 */
  { why: '合法 CHG 行：**新建文件**（md5前=`新增` · 行数前=0，先例 CHG-006）',
    line: 'CHG-913 2026-09-16T00:00Z .check/x.js 新增 33333333333333333333333333333333 0 12 新建文件 DEC-900' },
  { why: '合法 CHG 行：**勘误**（文件字段写被更正的那份 · md5/行数全 `--`，先例 CHG-039/043/154/158）',
    line: 'CHG-914 2026-09-16T00:00Z .check/record/issues.md -- -- -- -- 勘误：更正某行的字段 DEC-900' },
];

/* ---- 已知边界（**不是通过**）：显式钉住「本判据抓不住什么」------------------
 * ISS-048 的**原始签名**是「反引号被 shell 当命令替换 → 留下空括号」。它抓不住，
 * 而且**不应**去抓 —— 理由见 `record-shape.js` 文件头（会假红 35 次）。
 * 断言它 **MISSED** 的作用与 ISS-055 里那条 `node -e "require(<路径>)"` 一样：
 * **「假装已覆盖」比「承认没覆盖」危险。**
 * 哪天有人把空括号规则加进 **`record-shape.js`**，这一条会立刻 FAIL ——
 * 那是**提醒他先看 --holes 的量化误伤**。
 *
 * ★ 2026-09-16 W23 J14 更正：**这句原先漏了「加进 `record-shape.js`」这个限定**，
 *   读起来像「本仓库只要出现空括号规则就会被这条绊线抓到」—— **不成立**。
 *   实测：那条规则**早已存在**，在 `newid.js` 的写入时刻 WARN（`suspectHits()`）里，
 *   而绊线钉的是本文件 `checkLine` 的行为，**结构上看不见它** → 从不报 FAIL。
 *   **守门人与被守的规则不在同一个文件 = 守门人永远不响**，而它看起来是武装着的
 *   （同族：ISS-026「隐形文件」· W23 J13「存在 ≠ 可达」）。
 *   那条 WARN 是**启发式不是判据**，与 `record-shape.js` **分工不重复**：
 *   本文件管「已落盘的行」，它管「写入那一刻的正文」。
 *   它的尺子在 `node .check/record/newid.js --inject`（载体第 9 段）。 */
const BOUNDARY = [
  { why: 'ISS-048 原形（空括号族）—— **本判据不覆盖**，不可机械判定',
    line: 'ISS-900 resolved 2026-09-16T00:00Z 2026-09-16T00:00Z low 修 （） 与 （） 两处 EVT 900' },
  /* ★ 规则 ⑤ 的**基线**也是已知边界：`≤ CHG-116` 的历史行**刻意不判**（append-only 改不了）。
   * 这一条用**真实的 CHG-106** 钉住 —— 它是 ISS-090 的现场，也是「基线生效」的证据。
   * 钉住它的作用：哪天有人把基线删掉（想让规则更严），这一条会立刻 FAIL，
   * 提醒他「那 16 行历史会一起变红，而它们改不了」。 */
  { why: '**历史 CHG 行（≤ CHG-116）** 第 3 字段含空格 —— 规则 ⑤ **刻意不判**（append-only · 口径同 X4）',
    line: 'CHG-106 2026-09-16T07:27Z <项目外文件> e31bb2f1bcf29297f4458caf1cec9df3 e612175054331cf7aad93ca4911e0a90 1222 1224 记项目外文件 DEC-900' },
  /* ★ 规则 ⑥ 的两条**基线边界**（`≤ ISS-107` / `≤ DEC-30` 刻意不判）**已于 2026-09-17
   * （W23 J18）随两族基线降为 0 而撤销** —— 那两条向量已**移入 `INJECT`**（改为「必须抓」）。
   * 移走的理由：基线降 0 后「号落在旧基线内」不再有任何豁免含义，留在这里会**永久 FAIL**。
   * 它们原样钉住的形状（字段 2 是描述开头）**仍然**被 `INJECT` 里的两条构造向量覆盖 ——
   * 所以**覆盖没有减少**，只是方向从「刻意不判」翻成「必须判」。 */
];

/* ---- 规则 ⑦ 的向量（**文本级** —— 跨行规则只能在整份文本上测）---------------
 * 每条向量钉三样东西，每一样都对应这条规则最容易写错的地方：
 *   `dup`     ⑦ **恰好报几条** —— 不报（0）看起来像「干净」，正是 ISS-100 描述的现状；
 *             三行同体若报 3 条，就是一个事件被数了三次。
 *   `exact`   `bad` **合计**几条 —— 顺带钉住「⑦ 没有挤掉/重复别的规则」。
 *   `reportNo`/`names`  报在**哪一行**、组里**都是谁** —— 报错位置等于没报。
 * 文本一律从 `---` 开始（它之前是表头区，一律放行）→ 行号 1 = `---`、2 = 第一行记录，
 * 与 `scanText` 报的 `no` 直接可比。 */
const H = '---\n';
const INJECT_DUP = [
  { why: '同体异号：两行正文**去掉行首 id 后逐字相同**、号不同（ISS-901 ≡ ISS-902）→ ⑦ 必须抓',
    prefix: 'ISS', dup: 1, exact: 1, reportNo: 3, names: 'ISS-901 ≡ ISS-902',
    text: H + 'ISS-901 open 2026-09-16T00:00Z 2026-09-16T00:00Z low 描述 EVT 900\n' +
              'ISS-902 open 2026-09-16T00:00Z 2026-09-16T00:00Z low 描述 EVT 900\n' },
  { why: '**三行**同体（901 ≡ 902 ≡ 903）→ 必须报 **1 条**（一个事件占了三个号，不是三个事件），报在**最后一行**',
    prefix: 'ISS', dup: 1, exact: 1, reportNo: 4, names: 'ISS-901 ≡ ISS-902 ≡ ISS-903',
    text: H + 'ISS-901 open 2026-09-16T00:00Z 2026-09-16T00:00Z low 描述 EVT 900\n' +
              'ISS-902 open 2026-09-16T00:00Z 2026-09-16T00:00Z low 描述 EVT 900\n' +
              'ISS-903 open 2026-09-16T00:00Z 2026-09-16T00:00Z low 描述 EVT 900\n' },
  { why: 'DEC 同体异号（DEC-941 ≡ DEC-942）—— ⑦ **不是 ISS 专属**，三份记录都查',
    prefix: 'DEC', dup: 1, exact: 1, reportNo: 3, names: 'DEC-941 ≡ DEC-942',
    text: H + 'DEC-941 2026-09-16T00:00Z 决策 依据：实测 替代方案：无 后果：无 EVT 900\n' +
              'DEC-942 2026-09-16T00:00Z 决策 依据：实测 替代方案：无 后果：无 EVT 900\n' },
];

/* ---- ⑦ 的反向向量：合法行**不得**被抓 -------------------------------------- */
const INJECT_DUP_OK = [
  { why: '两行**正文不同**（只有末段不同）→ 不得抓',
    prefix: 'ISS', dup: 0, exact: 0,
    text: H + 'ISS-903 open 2026-09-16T00:00Z 2026-09-16T00:00Z low 描述甲 EVT 900\n' +
              'ISS-904 open 2026-09-16T00:00Z 2026-09-16T00:00Z low 描述乙 EVT 900\n' },
  { why: '单行（哪怕它被规则 ④ 抓）→ ⑦ **不得**参与 —— ④ 与 ⑦ 分工不重叠（实测 10 组重叠 0）',
    prefix: 'ISS', dup: 0, exact: 1,
    text: H + 'ISS-001 ISS-001 open 2026-09-16T00:00Z 2026-09-16T00:00Z low 描述 EVT 900\n' },
  { why: '两行**只有正文不同**（同一文件、同一长度）→ 不得抓（防「长度相近就算同体」）',
    prefix: 'CHG', dup: 0, exact: 0,
    text: H + 'CHG-950 2026-09-16T00:00Z a.js 11111111111111111111111111111111 22222222222222222222222222222222 10 20 原因甲 DEC-900\n' +
              'CHG-951 2026-09-16T00:00Z a.js 11111111111111111111111111111111 22222222222222222222222222222222 10 20 原因乙 DEC-900\n' },
];

/* ---- ⑦ 的已知边界（**不是通过**）-------------------------------------------
 * 两条都是**真边界**，不是「以后再说」：它们写明了这条规则**刻意不管**什么。 */
const BOUNDARY_DUP = [
  { why: '**基线内**一组（ISS-060 ≡ ISS-061）→ ⑦ **刻意不判**（append-only · 口径同 ⑤/⑥）· ' +
    '真实例 ISS 7 组 / DEC 1 组 / CHG 2 组，全部是「沙箱 bypass 重跑」产物',
    prefix: 'ISS', dup: 0, exact: 0,
    text: H + 'ISS-060 open 2026-09-16T00:00Z 2026-09-16T00:00Z low 描述 EVT 900\n' +
              'ISS-061 open 2026-09-16T00:00Z 2026-09-16T00:00Z low 描述 EVT 900\n' },
  { why: '正文只差**一个多余空格** → ⑦ **不抓** —— ISS-100 原文明确要求「**不做任何规范化**」；' +
    '规范化会引出「哪些空格算噪声」的无穷判断，而 ⑦ 抓的是**机械复制**（同一份正文被写了两遍），不是「内容相近」',
    prefix: 'ISS', dup: 0, exact: 0,
    text: H + 'ISS-905 open 2026-09-16T00:00Z 2026-09-16T00:00Z low 描述 EVT 900\n' +
              'ISS-906 open 2026-09-16T00:00Z 2026-09-16T00:00Z low 描述  EVT 900\n' },
];

const mode = process.argv[2] || '--scan';

if (mode === '--inject') {
  let ok = true;
  console.log('===== 注入向量：畸形行**必须**被抓 =====');
  for (const v of INJECT) {
    const pre = v.as || v.line.split('-')[0];
    const bad = checkLine(v.line, pre, MIN[pre]);
    const isStray = v.by === 'stray' && classify(v.line, pre, true) === 'stray';
    const caught = bad.length > 0 || isStray;
    console.log((caught ? 'CAUGHT  ' : 'MISSED  ') + v.why);
    if (!caught) { console.log('        规则没抓住：' + v.line); ok = false; }
    else console.log('        → ' + (isStray ? 'STRAY（前缀被吃掉）' : bad.join(' · ')));
    /* `exact` = 「**恰好 N 条规则**抓它」—— 用来钉住「某条规则有**独立**判别力」
     * （不是另一条规则的复制品）。见 INJECT 里那条 ISS-112 向量的注释。 */
    if (v.exact !== undefined && bad.length !== v.exact) {
      console.log('        **断言不符**：期望恰好 ' + v.exact + ' 条规则抓它，实际 ' + bad.length + ' 条');
      ok = false;
    }
  }
  console.log('===== 反向向量：合法行**不得**被抓（假红守门人）=====');
  for (const v of INJECT_OK) {
    const pre = v.as || v.line.split('-')[0];
    const cls = classify(v.line, pre, !v.header);
    const bad = cls === 'record' ? checkLine(v.line, pre, MIN[pre]) : [];
    const clean = bad.length === 0 && cls !== 'stray';
    console.log((clean ? 'CLEAN     ' : 'FALSE-RED ') + v.why + '  [' + cls + ']');
    if (!clean) { console.log('        误伤：' + bad.join(' · ')); ok = false; }
  }
  console.log('===== 已知边界：本判据**抓不住**什么（显式钉住，不假装已覆盖）=====');
  for (const v of BOUNDARY) {
    const pre = v.line.split('-')[0];
    const bad = checkLine(v.line, pre, MIN[pre]);
    const missed = bad.length === 0;
    console.log((missed ? 'BOUNDARY  ' : '**意外抓到了** ') + v.why);
    if (!missed) { console.log('        → ' + bad.join(' · ') + '（若是新加的规则，先看 --holes 的误伤数）'); ok = false; }
  }

  /* ---- 规则 ⑦ 的文本级向量（**跨行规则只能在整份文本上测**）------------------
   * 上面三组循环都只喂 `checkLine`（单行），结构上**测不到 ⑦** ——
   * 所以 ⑦ 单独有这一组：喂一段文本、数 `scanText(...).bad`。
   * **这不是冗余**：⑦ 是本仓库第一条跨行规则，如果它只被 `--scan` 在真记录上「看着像对的」，
   * 那它和 ISS-048 那类「没人解析过」的东西是同一种处境。 */
  const runDup = (v, label) => {
    const sc = scanText(v.text, { prefix: v.prefix, min: MIN[v.prefix] });
    const hits = sc.bad.filter((x) => x.why.some((w) => w.indexOf('同体异号') >= 0));
    const named = !v.names || (hits.length > 0 && hits[0].why.join(' ').indexOf(v.names) >= 0);
    const noOk = v.reportNo === undefined || (hits.length > 0 && hits[0].no === v.reportNo);
    const good = hits.length === v.dup && sc.bad.length === v.exact && named && noOk;
    console.log((good ? label : '**不符** ') + v.why);
    console.log('        → ⑦ 报 ' + hits.length + ' 条（期望 ' + v.dup + '）· bad 合计 ' +
      sc.bad.length + '（期望 ' + v.exact + '）' +
      (v.reportNo !== undefined ? ' · 报在第 ' + (hits[0] ? hits[0].no : '—') + ' 行（期望 ' + v.reportNo + '）' : '') +
      (v.names ? ' · 组内 ' + (named ? '相符' : '**不符**') : ''));
    if (!good) { console.log('        文本：' + JSON.stringify(v.text)); ok = false; }
  };
  console.log('===== 规则 ⑦（同体异号）注入向量：跨行规则只能在整份文本上测 =====');
  for (const v of INJECT_DUP) runDup(v, 'CAUGHT  ');
  console.log('===== ⑦ 反向向量：合法行**不得**被抓 =====');
  for (const v of INJECT_DUP_OK) runDup(v, 'CLEAN     ');
  console.log('===== ⑦ 已知边界：本判据**抓不住**什么（显式钉住，不假装已覆盖）=====');
  for (const v of BOUNDARY_DUP) runDup(v, 'BOUNDARY  ');

  /* ---- 计数自检：**只用于显示的数字，最容易腐烂**（因为它不参与任何判定）----------
   * 第一版 `scanText` 把 `record` 计了两次，打印出「记录行 120」（真值 60）而**没有任何判据会红**。
   * 这里用一份手工可数的小样本把四类计数逐个钉住。 */
  const sample = [
    '# 标题',                    // comment
    '',                          // blank
    '格式：`ISS-<序号> …`',       // header（--- 之前）
    '---',                       // rule → 此后进入正文
    'ISS-001 open 2026-01-01T00:00Z 2026-01-01T00:00Z low 描述 EVT 001',  // record
    'ISS-002 open 2026-01-01T00:00Z 2026-01-01T00:00Z low 描述 EVT 002',  // record
    '第三行没有前缀',             // stray
    'ISS-3 open 2026-01-01T00:00Z 2026-01-01T00:00Z low 描述 EVT 003',    // record + bad（编号 1 位）
  ].join('\n');
  const sc = scanText(sample, { prefix: 'ISS', min: 7 });
  const cntOk = sc.record === 3 && sc.header === 1 && sc.blank === 1 &&
    sc.comment === 1 && sc.rule === 1 && sc.stray.length === 1 && sc.bad.length === 1;
  console.log('===== 计数自检（四类计数 + stray/bad 各一）=====');
  console.log((cntOk ? 'CLEAN     ' : 'FALSE     ') + 'scanText 计数：' +
    JSON.stringify({ record: sc.record, header: sc.header, blank: sc.blank,
      comment: sc.comment, rule: sc.rule, stray: sc.stray.length, bad: sc.bad.length }));
  if (!cntOk) { console.log('        want: {"record":3,"header":1,"blank":1,"comment":1,"rule":1,"stray":1,"bad":1}'); ok = false; }

  console.log('----');
  console.log(ok
    ? '注入 ' + INJECT.length + '/' + INJECT.length + ' 全被抓、反向 ' + INJECT_OK.length + '/' +
      INJECT_OK.length + ' 全干净、已知边界 ' + BOUNDARY.length + '/' + BOUNDARY.length +
      ' 确认抓不住、⑦ 文本级 ' + INJECT_DUP.length + '+' + INJECT_DUP_OK.length + '+' +
      BOUNDARY_DUP.length + ' 全符合预期、计数自检 1/1'
    : '**有向量不符合预期 —— 规则要改**');
  process.exit(ok ? 0 : 1);
}

if (mode === '--holes') {
  /* 被否决的那族规则单独打印 —— 想看时看，**不参与判定**。
   * 留着它的理由：哪天有人想「顺手加个空括号检查」，先看这里有多少误伤。 */
  console.log('===== 被否决的规则：空括号/空引号族（**不参与判定**）=====');
  let n = 0;
  for (const s of SPEC) {
    const p = path.join(RECORD, s.file);
    if (!fs.existsSync(p)) continue;
    fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n').split('\n').forEach((l, i) => {
      if (classify(l, s.prefix, true) !== 'record') return;
      const h = hints(l);
      if (h.length) { n++; console.log('  ' + s.file + ':' + (i + 1) + '  ' + h.join(' · ')); }
    });
  }
  console.log('----');
  console.log('若这一族参与判定，会假红 ' + n + ' 次 —— **这就是它被否决的量化理由**');
  process.exit(0);
}

if (mode !== '--scan') {
  console.log('用法：node .check/probe-record-shape.js [--scan|--inject|--holes]');
  process.exit(4);
}

/* ---- 豁免表（**逐条登记**，口径同 `newid.js --check`）------------------------
 * 为什么需要：ISS-082/083/084 三行的「号重复」是**已发生的历史**，而记录层 **append-only**
 * —— 不能改行、不能删行。没有豁免表，规则一上线就**永久红**；而永远红的断言会被训练成忽略
 * （DEC-019）—— **那比没有判据更坏**。
 *
 * **粒度是「(id, 规则)」，不是「整行」** —— 豁免整行会连该行的其它问题一起掩盖
 * （比如同一行还字段数不足）。所以只过滤「号重复」这一类。
 *
 * **不得为了让检查变绿而新增豁免**（DEC-026 家族）。每条必须写原因，且**逐条打印**；
 * 登记了却没命中的，报成**悬空豁免**（同 `newid.js --check` 的 rc=6）。
 * 区域级豁免 = 裸的允许清单，禁止。 */
const EXEMPT_FILE = path.join(RECORD, 'record-shape-exemptions.md');
function loadExempt() {
  const m = new Map();
  if (!fs.existsSync(EXEMPT_FILE)) return m;
  for (const l of fs.readFileSync(EXEMPT_FILE, 'utf8').replace(/\r\n/g, '\n').split('\n')) {
    const x = /^EXEMPT\s+([A-Z]{3}-\d{3})\s+(.+)$/.exec(l.trim());
    if (x) m.set(x[1], x[2]);
  }
  return m;
}

/* ---- 默认：判定三份真记录 -------------------------------------------------- */
let hits = 0;
let unver = 0;
let exemptUsed = 0;
const exempt = loadExempt();
const exemptSeen = new Set();
console.log('===== 记录层「逐行形状」判据（ISS-050）=====');
for (const s of SPEC) {
  const p = path.join(RECORD, s.file);
  if (!fs.existsSync(p)) { console.log('[' + s.id + '] UNVERIFIED ' + s.file + ' 不存在'); unver++; continue; }
  const text = fs.readFileSync(p, 'utf8');
  const r = scanText(text, s);
  /* 逐条过滤：只豁免「号重复」这一类；过滤后 why 为空 → 该行不再算 bad。 */
  const keep = [];
  for (const x of r.bad) {
    const id = (x.id.match(/^[A-Z]{3}-\d{3}/) || [''])[0];
    const rest = x.why.filter((w) => !(w.indexOf('号重复') >= 0 && exempt.has(id)));
    if (rest.length === 0 && exempt.has(id)) { exemptUsed++; exemptSeen.add(id); }
    else keep.push({ no: x.no, id: x.id, why: rest });
  }
  const bad = r.stray.length + keep.length;
  console.log('[' + s.id + '] ' + s.file.padEnd(14) + (bad ? 'FAIL' : 'OK  ') +
    '  记录行 ' + r.record + ' · 表头 ' + r.header + ' · 形状不明 ' + r.stray.length +
    ' · 形状不符 ' + keep.length + ' · 字段数下限 ' + s.min);
  for (const x of r.stray) console.log('         STRAY  第 ' + x.no + ' 行: ' + x.text);
  for (const x of keep) console.log('         SHAPE  第 ' + x.no + ' 行 ' + x.id + '… : ' + x.why.join(' · '));
  /* ★ 规则 ⑤ 的**检查面度量**（ISS-090）—— 用判法本体 `chgShiftBad` **独立重算**，
   * 不复制逻辑（复制会静默分叉：打印的数与判定的数可以不一致，而两边都像对的）。
   *
   * 为什么要打印这两个数：规则 ⑤ 有两段 —— 基线以下**刻意不判**（append-only 改不了），
   * 基线以上才判。只说「OK」会让人以为「全查过了」。**把豁免数摆出来**，
   * 才看得出「这条规则的检查面到底有多大」，也才看得出基线是不是被偷偷抬高了（DEC-026 家族）。
   * 两个数都从 `chgShiftBad` 来 → 与 `keep` 里真报出来的违规**互为交叉核对**。 */
  if (s.prefix === 'CHG') {
    let inBody = false, hist = 0, above = 0;
    for (const l of text.replace(/\r\n/g, '\n').split('\n')) {
      if (/^-{3,}\s*$/.test(l)) { inBody = true; continue; }
      if (!inBody || classify(l, s.prefix, true) !== 'record') continue;
      const mm = new RegExp('^' + s.prefix + '-(\\d+)').exec(l);
      if (!mm) continue;
      const f = l.split(/\s+/).filter(Boolean);
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/.test(f[1] || '')) continue;  // 缺 ts 归 X4 管
      if (chgShiftBad(l).length === 0) continue;
      if (+mm[1] > CHG_FIELD_BASELINE) above++; else hist++;
    }
    console.log('         [⑤] CHG 字段左移：基线 ≤ CHG-' + CHG_FIELD_BASELINE +
      ' → **历史豁免 ' + hist + ' 行**（append-only，改不了，刻意不判）· 基线以上违规 **' + above + ' 行**');
  }
  /* ★ 规则 ⑥ 的**检查面度量 + 逐条清单**（ISS-112）—— 同 ⑤ 的口径：用判法本体
   * `issFieldBad` / `decFieldBad` **独立重算**（不复制逻辑，复制会静默分叉）。
   *
   * **为什么 ⑤ 只打印数量、⑥ 还要逐条**（这个不对称是刻意的，不是漏了）：
   *   · ⑤ 是 ISS-090 的既有设计，它那 **16 行**的逐条分析已在 ISS-090 的留证与 SEAL 里；
   *   · ⑥ 是本轮新增，而 **ISS-112 点名了 9 个具体的号**（`ISS-055/056/057` · `ISS-082/083/084` ·
   *     `ISS-105/106/107`）—— **一个数字回答不了「豁免了谁、为什么」**，而豁免数正是最容易
   *     腐烂的地方（DEC-026 家族：不得为了让检查变绿而抬高基线）。**逐条是最低限度的可审计。**
   *
   * **原因按形状机械分类，不写死** —— 写死的原因会与事实脱节（那是 ISS-046 的形状：
   * 「只用于显示的文字」最容易腐烂，因为它不参与任何判定）。 */
  if (s.prefix === 'ISS' || s.prefix === 'DEC') {
    const judge = s.prefix === 'ISS' ? issFieldBad : decFieldBad;
    const base = s.prefix === 'ISS' ? ISS_FIELD_BASELINE : DEC_FIELD_BASELINE;
    let inBody = false, hist = 0, above = 0;
    const rows = [];
    for (const l of text.replace(/\r\n/g, '\n').split('\n')) {
      if (/^-{3,}\s*$/.test(l)) { inBody = true; continue; }
      if (!inBody || classify(l, s.prefix, true) !== 'record') continue;
      const mm = new RegExp('^' + s.prefix + '-(\\d+)').exec(l);
      if (!mm) continue;
      if (judge(l).length === 0) continue;
      if (+mm[1] > base) { above++; continue; }
      hist++;
      const f = l.split(/\s+/).filter(Boolean);
      const v = f[1] || '';
      let why;
      if (v === s.prefix + '-' + mm[1]) why = '号重复族 → 整行右移';
      else if (v.indexOf('【') === 0) why = '前导字段缺失（描述以方括号开头）';
      else why = '第 2 字段 = `' + v + '`';
      rows.push(s.prefix + '-' + mm[1] + ' ← ' + why);
    }
    console.log('         [⑥] ' + s.prefix + ' 字段身份：基线 ≤ ' + s.prefix + '-' + base +
      ' → **历史豁免 ' + hist + ' 行**（append-only，改不了，刻意不判）· 基线以上违规 **' + above + ' 行**');
    if (rows.length) console.log('              逐条（' + rows.length + ' 条）：' + rows.join(' · '));
  }
  /* ★ 规则 ⑦ 的**检查面度量 + 逐条清单**（ISS-100）—— 同 ⑤/⑥ 的口径：
   * 用判法本体 `dupGroups` **独立重算**（判法一份、输入由 `collectRecs` 自己重收）。
   *
   * **为什么 ⑦ 也要逐条**（与 ⑤ 刻意不对称，理由同 ⑥）：ISS-100 的整条诉求就是
   * 「**这个形状有没有人看**」。那 10 组是**真阳性但已登记豁免**，**不是抓不住** ——
   * 只报「豁免 7 组」而不列出来，读者就**无法核对它们是否真的都是 bypass 重跑产物**
   * （DEC-026 家族：不得为了让检查变绿而抬高基线）。逐条是最低限度的可审计。 */
  {
    const gs = dupGroups(collectRecs(text, s.prefix), s.prefix);
    const base = DUP_BASELINE[s.prefix] || 0;
    const isHist = (g) => Math.max(...g.nums) <= base;
    const hist = gs.filter(isHist);
    const above = gs.filter((g) => !isHist(g));
    const lines = hist.reduce((n, g) => n + g.nums.length, 0);
    console.log('         [⑦] 同体异号：基线 ≤ ' + s.prefix + '-' + base +
      ' → **历史豁免 ' + hist.length + ' 组（' + lines + ' 行）**（append-only，改不了，刻意不判）' +
      ' · 基线以上违规 **' + above.length + ' 组**');
    if (gs.length) console.log('              逐条（' + gs.length + ' 组）：' +
      gs.map((g) => g.names.join(' ≡ ') + (isHist(g) ? '' : ' **← 基线以上**')).join(' · '));
  }
  hits += bad;
}
console.log('---- 豁免（逐条打印，SEAL 铁律：豁免必须逐条、必须写原因、必须打印）----');
if (exempt.size === 0) console.log('（豁免表为空或不存在：' + EXEMPT_FILE + '）');
for (const [id, why] of exempt) {
  if (exemptSeen.has(id)) console.log('EXEMPT  ' + id + '  ← 已逐条登记：' + why);
  else console.log('**悬空豁免** ' + id + '  ← 登记了但**没有命中**（规则改了？行被改好了？）→ 应删掉这条豁免');
}
const dangling = [...exempt.keys()].filter((k) => !exemptSeen.has(k)).length;
console.log('----');
console.log('说明：本判据**只查**前缀+3位号 / 字段数下限 / 记录区无前缀行 / 制表符 / **号重复** / **CHG 字段左移** / **ISS·DEC 字段身份** / **同体异号**。');
console.log('      **不查空括号对** —— 记录里合法引用代码（`require()` / `f1[0]`），那族规则会假红 35 次。');
console.log('      被否决的规则与已知边界见 `--holes` / `--inject`。');
console.log('结论：' + (hits ? 'FAIL 命中 ' + hits + ' 处' : 'OK 三份记录全部合规') +
  ' · 豁免 ' + exemptUsed + ' 条' + (dangling ? ' · **悬空豁免 ' + dangling + ' 条**' : '') +
  (unver ? ' · UNVERIFIED ' + unver + ' 份' : ''));
process.exit(hits ? 1 : (unver || dangling) ? 2 : 0);
