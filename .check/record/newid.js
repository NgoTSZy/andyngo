#!/usr/bin/env node
/* 记录层「原子取号 + 追加」的唯一实现。
 *
 * ── 为什么需要它（2026-09-16 实测，不是推测）──────────────────────────────
 * 同一天两个会话写同一批记录文件，结果是：
 *
 *   issues.md    ISS-035 / ISS-036 / ISS-037   各有两行，**内容完全不同**
 *   decisions.md DEC-021 / DEC-022             各有两行，**内容完全不同**
 *   changes.md   （无）
 *
 * 而**两种写法都返回了成功**：一方用 `>>` 追加、另一方用「锚点插入」。
 * **一个字节都没丢、行数只增不减、每一行都读得通** —— 坏掉的不是数据，
 * 是「编号 → 内容」这个映射的**唯一性**。所以它比 ISS-011（并行 Edit 互相覆盖、
 * 会丢改动）更难发现：**「没丢东西」不等于「没坏」。**
 *
 * ── 根因不是「并发」，是「取号是两次操作」──────────────────────────────
 * 「先读最大号，再另行追加」中间那段时间里，另一个写者可以插队。
 * 无论谁先谁后，两次操作之间的窗口永远存在 —— 窗口只会变小，不会消失。
 *
 * 所以：**取号与追加必须在同一次命令里完成，并且互斥。**
 * 互斥用 `open(..., 'wx')`（O_EXCL）—— `wx` 是**原子创建**：文件已存在就抛
 * EEXIST，两个进程不可能同时拿到锁。不用「检查是否存在再创建」那种两段式写法，
 * 那正是本文件要修掉的形状。
 *
 * ── 用法 ────────────────────────────────────────────────────────────
 *   node .check/record/newid.js <文件> <前缀> <分隔符> <正文|@正文文件>
 *
 *   node .check/record/newid.js .check/record/issues.md ISS - "正文…"
 *   node .check/record/newid.js .check/record/issues.md ISS - @/tmp/body.txt   ← 推荐：正文含反引号/引号/长文本时
 *   node .check/record/newid.js .check/record/decisions.md DEC - "正文…"
 *   node .check/record/newid.js .check/record/changes.md CHG - "正文…"
 *   node .check/record/newid.js .check/record/eventlog/2026-09-16.txt EVT ' ' "2026-… W17 J1 OK …"
 *
 *   node .check/record/newid.js --check              # 扫默认记录根，不写任何东西
 *   node .check/record/newid.js --check <记录根>      # 扫指定记录根（**给夹具用**）
 *   node .check/record/newid.js --inject             # 三个检测器的**双向测**（尺子），不写任何东西
 *                                                    #   第一组 = `suspectHits`（shell 吃片段）
 *                                                    #   第二组 = `bodyStartsWithId`（正文不得以号开头）
 *                                                    #   第三组 = `prefixForms`（分隔符盲扫，ISS-113）
 *
 * 成功时 **stdout 只打印一行** `ALLOC <号>`（好让调用方把拿到的号写进留证）。
 *
 * ── 退出码（三态分开，同 DEC-013）────────────────────────────────────
 *   0  成功写入 / `--check` 编号唯一（或只剩**已逐条登记**的历史撞号）/ `--inject` 全过
 *   1  `--inject` 有向量不符期望（**断言**不符：检测器的行为与钉住的期望不同）——
 *      与全仓库 `1` = 「命中 / 不合格」同口径，且它**不代表写入有任何问题**
 *   3  锁超时 —— **没有写入**（「没跑成」，不是「跑了且不合格」）
 *   4  参数错 / **路径错** / **正文以号开头**（`bodyStartsWithId` 守卫，ISS-085）/
 *      **分隔符可能传错**（`prefixForms` 守卫，ISS-113：文件里已有该前缀的记录、
 *      但按 `前缀+分隔符` 扫到 0 条 → 会从 001 重开）—— **一律没有写入**
 *      （给原生 node.exe 传了 POSIX 路径也走这里）
 *   5  `--check` 发现**未登记**的重复号（这是「跑了且不合格」）
 *   6  `--check` 发现**悬空豁免**（登记了却找不到对应撞号）
 *
 * ── ★ 本文件前两版自己的三个缺陷（**全部是跑出来的，没有一个是审出来的**）──
 *   ① 第一版把「锁创建失败」一律归到退出码 3「锁超时」，而真因是路径不存在
 *      （`mktemp -d` 的 `/tmp/...` 被原生 node.exe 解析成 `C:\tmp\...`，ISS-003 第 5 次）
 *      → 归因错位。已修：非 EEXIST 归 4，并打出两条路径。见 ISS-045。
 *   ② 第二版 `--check` 把历史撞号**永远**报红 → 一条**永远红的断言**，
 *      而永远红的断言会被训练成忽略（DEC-019）。已修：逐条豁免表 + 悬空豁免检测。
 *   ③ 第二版 `--check` **不接受记录根参数**，于是它自己的红分支（exit 5）
 *      **指向不了夹具 = 永远测不到**（同 ISS-034 的空断言、W9-F-H3 的不可达分支）。
 *      已修：加第 2 个**位置参数**。**用位置参数而不是环境变量** ——
 *      环境变量是「外部可设的开关」，同时就是「让检查不跑的开关」（DEC-023）；
 *      位置参数必须显式给出，给的人是**有意**的（同 ISS-039 的 `--no-nest`）。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const PAD = 3;          // 号一律 3 位（EVT seq / ISS / DEC / CHG 都是这个约定）
const LOCK_TRIES = 200; // 200 × 25ms = 5s 上限
const LOCK_WAIT_MS = 25;

/* 记录根。默认 = **本文件所在目录**（`.check/record`）——
 * 写成 `path.join(__dirname, '..', 'record')` 是绕远路（自己指自己），这里直说。 */
function rootOf(arg) {
  return arg ? path.resolve(arg) : __dirname;
}
/* `--check` 的扫描面：三份记录 + eventlog 下**全部** .txt
 * （与 `andyngo-integrity.js` 的「不带参数就查全部日志」同口径，同 DEC-012）。 */
function checkTargets(root) {
  const out = [
    path.join(root, 'issues.md'),
    path.join(root, 'decisions.md'),
    path.join(root, 'changes.md'),
  ];
  const evDir = path.join(root, 'eventlog');
  try {
    for (const n of fs.readdirSync(evDir).filter((n) => n.endsWith('.txt')).sort()) {
      out.push(path.join(evDir, n));
    }
  } catch (e) { /* 没有 eventlog 目录就不查它 */ }
  return out;
}

/* 历史撞号必须**逐条登记**才能放行。
 *
 * ★ 为什么：撞号的处置是「追加勘误、不删行、不重编号」（DEC-026），
 * 所以那几行**永远**留在文件里。若判据把它们**永远**报红，
 * 它就成了一条「**永远红的断言**」—— 而永远红的断言会被看见、然后被**训练成忽略**
 * （DEC-019 的同族；本文件第二版就是这么写的，写完五分钟自己撞上）。
 * 但也不能区域级放行 —— 那等于没有判据。
 * 故只认**逐条**登记，且**登记了却找不到对应撞号的按缺陷报**
 * （同 I5 的 `exDangling`：防止登记表变成单方面清单，见 ISS-010 / CHG-023）。 */
function loadExempt(root) {
  const map = new Map();
  let s = '';
  try { s = fs.readFileSync(path.join(root, 'id-collision-exemptions.md'), 'utf8'); }
  catch (e) { return map; }
  for (const raw of s.split('\n')) {
    const line = raw.trim();
    const m = /^EX-ID-(\d+)\s+(ISS|DEC|CHG|EVT)-(\d+)\s*[×x](\d+)/.exec(line);
    if (m) map.set(m[2] + '-' + m[3], { n: Number(m[4]), note: line.slice(0, 200) });
  }
  return map;
}

/* 返回 `{missing:true}` = 读不到文件；否则 `{dups:[{id,n,ex}]}`。
 * `ex` = 该撞号是否已被逐条登记。 */
function classify(file, ex) {
  let s;
  try { s = fs.readFileSync(file, 'utf8'); } catch (e) { return { missing: true }; }
  const seen = new Map();
  for (const m of s.matchAll(/^(EVT|ISS|DEC|CHG)[- ](\d+)/gm)) {
    const id = m[1] + '-' + m[2];
    seen.set(id, (seen.get(id) || 0) + 1);
  }
  const dups = [...seen].filter(([, n]) => n > 1).map(([id, n]) => ({ id, n, ex: ex.has(id) }));
  return { dups };
}

/* ── 写入时刻的「疑似被 shell 吃掉片段」检测（**纯函数**，判定与双向测共用）────
 * 抽成纯函数而不是内联进下面的 WARN —— 理由与 `record-shape.js` 文件头同一条：
 * **规则若各写一份，判定与它的尺子会静默分叉**，于是「测过了」与「真的会响」
 * 变成两件事（同 ISS-007：同源判据不算两个判据）。
 *
 * 返回命中的分支名（空数组 = 不报）。**它只回答「像不像」，不回答「是不是」** ——
 * 这正是它属于启发式而不属于判据的原因：判据要能机械判定，启发式只要值得一看。
 *
 * ★ 2026-09-16 W23 J14 的三处收窄（ISS-092）。依据是**测量**，不是推理 ——
 *   修前实测：全记录语料 **353 行命中 41 处**，而真正的阳性**只有 1 处**（ISS-048 本身）。
 *   ① **`fromFile` 为真直接返回空** —— 正文来自 `@文件` 时**根本没经过 shell**，
 *      「被 shell 吃掉」按构造不可能为真。这不是「可能误报」，是**这句话本身不成立**。
 *      而 `@文件` 恰是唯一被认可的写入路径（`alloc.sh:36` 直接拒绝内联正文，理由即 ISS-048）
 *      → 修之前，这个 WARN 在**全部正常写入**上都响。
 *      附带一处自相矛盾也一并消失：它原先会对 `@文件` 路径说「改用 @正文文件 重写这一条」
 *      —— **建议改用你已经在用的那个形式**（ISS-092 的复现正是这么撞上的）。
 *   ② **`()` 支收窄**：前面不是标识符字符、且后面不是零参箭头函数。
 *      实测 `()` 支命中 **30 处，30 处全是函数名**（`seed()` / `x5()` / `main()`），
 *      而本仓库正文**经常**提到函数名 → 这是一整类系统性假阳性。
 *   ③ **去掉 `""` 支**：实测 4 处全是**代码里的空字符串**（`bash ""`），
 *      且它对 ISS-048 的形状**没有真阳性机制** —— 那次留下的空洞来自**反引号片段被吃掉**
 *      （反引号包着的号 → 空），留下的是**括号对**，不是半角双引号对。
 *
 * **`  `（连续两空格）支保留**，而且它是最该留的一条 —— 它是全语料里**唯一**
 * 抓到 ISS-048 真身的分支（`（同族 ISS-046 的  ）`：被吃掉的片段留下的空格）。
 * ISS-058 判它「区分度 0」是就**判据**（拦截 / 报红）说的；本处只提醒不拦，代价是一行 stderr。
 * **一条经常误报的 WARN 会被训练成忽略（DEC-019 家族，从「红」降级成「黄」，机制不变）** ——
 * 所以收窄不是「顺手优化」，是这个 WARN 能不能活下去的前提。 */
function suspectHits(body, fromFile) {
  if (fromFile) return [];   /* 见上 ①：不是「大概率误报」，是「按构造不可能」 */
  const h = [];
  /* `(?<!…)` 前面不是标识符字符（`x5()` 不再命中）；
   * `(?!\s*=>)` 后面不是箭头函数的 `=>`（`() => {}` 不再命中）——
   * 两者都只排除**明确合法的代码**，不改变真阳性机制（真阳性形态是 `(` 或 `（` 紧邻空对）。 */
  if (/(?<![A-Za-z0-9_$])\(\)(?!\s*=>)/.test(body)) h.push('半角空括号对 ()');
  for (const [s, why] of [['（）', '中文空括号'], ['「」', '中文空引号'], ['“”', '中文空双引号'], ['【】', '中文空方括号']]) {
    if (body.indexOf(s) >= 0) h.push(why + ' ' + s);
  }
  if (/  /.test(body)) h.push('连续两空格');
  return h;
}

/* ── 写入时刻守卫：正文**不得以号开头**（ISS-085 → 2026-09-16 重犯 11 条）────────
 * 取号器会在正文前面**再加一次**号。若正文文件里已经带了号，行首就成了
 *   `ISS-110 ISS-110 resolved …` / `CHG-138 CHG-138 2026-…`
 * —— 而记录层 **append-only**：那些行要么**永久红**、要么配等量豁免、
 * 要么**改历史**。三条都不是好结果，**而这三条我当天全都面对过**。
 *
 * **判据抓得住**（`probe-record-shape.js` 的 I8/I9/I10 会报「号重复」）——
 * 但它只在**写完之后**抓：抓到的时候行已经躺在文件里了，于是只剩下上面三条路。
 * 所以这里补的是**写入时刻**的拒绝，把「事后补救」变成「根本写不进去」。
 *
 * **为什么是精确形状、不是「正文里出现号就拒」**：ISS-085 实测过宽松口径 ——
 * 「行首号在本行出现 ≥2 次」命中 7 行，其中 **4 行是合法自指**（`ISS-063` 的「补充」形态、
 * `DEC-024` 的「改号登记」），假红率 4/7 = 57% → **该规则不可判红**。
 * 这里只认**正文的第一个 token** 就是 `<前缀><分隔符><数字>`。
 *
 * **同族**：ISS-082/083/084（同形，3 条，已逐条豁免）· ISS-085（分析 + 精确规则）·
 * ISS-110（同一天的另一条「写坏了才发现」）。 */
function bodyStartsWithId(body, pre, sep) {
  const head = pre + sep;
  if (body.slice(0, head.length) !== head) return false;
  return /^\d+(\s|$)/.test(body.slice(head.length));
}

/* ── 分隔符盲扫守卫（ISS-113，2026-09-16 W23 J14 加）──────────────────────────
 * **它守的是什么**：`pre + sep` 这个值被用在**两个**地方 —— ① 构造**扫描已有号**的模式
 * （`^pre+sep+数字`）② 构造**新号**。两个用途共用一个值，而这个值的正确性**没有任何东西检查**。
 * 于是 sep 传错时，扫描模式与文件里既有的号**对不上** → 一条都扫不到 → 计数器从 1 开始。
 *
 * **实测（我自己踩的）**：`… alloc.sh .check/record/issues.md ISS ' ' @…`
 * （`ISS` 的分隔符应是 `-`）→ 输出 `ALLOC ISS 001`，一行 `ISS 001 …` 落盘。
 * 撞号检查**响了**（`WARN … ISS-001×2`），但**是 WARN、写已经发生** —— 而记录层 append-only。
 *
 * **判据形状**：文件里**已经有该前缀的记录**（`prefix` 后跟 `-` 或空白，**任意分隔符形态**），
 * 而按 `prefix + sep` 扫到的记录是 **0** → **拒跑**。
 *
 * **为什么不是「扫到 0 就拒」**：真正的新文件扫到 0 是**正常的**（第一次写 `EVT 001` 就是这个形状）。
 * 本条要区分的是「**文件非空但扫不到**」—— 那只有两种解释：**分隔符传错了**，或**号段形态变了**。
 * 两种都该停下来问人，而不是安静地从 001 重开。
 *
 * **与 `--check` 的分工**：`--check` 判「**已有**的号有没有重复」（事后、看全表）；
 * 本条判「**这次取号**有没有瞎」（事前、看本次参数）—— 同 DEC-037 / DEC-038 家族：
 * **守门人要守在会出事的那个时刻。** */
function esc(x) { return x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* 返回 `{ anyForm, matched }`：
 *   anyForm —— 行首是 `prefix` 后跟 `-` 或空白（**任意分隔符形态**的该前缀记录数）
 *   matched —— 行首是 `prefix + sep` 后跟数字（**本次要用的那一种形态**） */
function prefixForms(src, pre, sep) {
  const any = new RegExp('^' + esc(pre) + '[\\s-]', 'gm');
  const hit = new RegExp('^' + esc(pre) + esc(sep) + '\\d', 'gm');
  return { anyForm: (src.match(any) || []).length, matched: (src.match(hit) || []).length };
}

if (process.argv[2] === '--check') {
  const root = rootOf(process.argv[3]);
  const ex = loadExempt(root);
  const hit = new Set();
  let bad = 0, hist = 0;
  console.log('记录根: ' + root);
  for (const f of checkTargets(root)) {
    const rel = path.relative(root, f);
    const c = classify(f, ex);
    if (c.missing) { console.log('SKIP   ' + rel + ' : 读不到'); continue; }
    if (!c.dups.length) { console.log('OK     ' + rel + ' : 无重复号'); continue; }
    for (const d of c.dups) {
      if (d.ex) { hit.add(d.id); hist++; console.log('EXEMPT ' + rel + ' : ' + d.id + '×' + d.n + '  ← 已逐条登记'); }
      else { bad++; console.log('DUP    ' + rel + ' : ' + d.id + '×' + d.n + '  ← **未登记**'); }
    }
  }
  let dangling = 0;
  for (const [id] of ex) {
    if (!hit.has(id)) { dangling++; console.log('DANGLING 登记了却找不到对应撞号: ' + id + '（登记表不能变成单方面清单）'); }
  }
  console.log('结论: 未登记撞号 ' + bad + ' · 已登记历史撞号 ' + hist + ' · 悬空豁免 ' + dangling +
    ' · 豁免表 ' + (ex.size ? ex.size + ' 条' : '不存在或为空'));
  if (bad) { console.log('→ exit 5：有**未登记**的撞号。按 DEC-026 追加勘误（不删行、不改行、不重编号）。'); process.exit(5); }
  if (dangling) { console.log('→ exit 6：豁免登记了却没有对应撞号 —— 修豁免表，或说明它为何已消失。'); process.exit(6); }
  console.log('→ exit 0：编号唯一，或只剩已逐条登记的历史撞号。');
  process.exit(0);
}

/* ── `--inject`：`suspectHits` 的**双向测**（尺子）────────────────────────────
 * 为什么必须有它（ISS-092 的三条「为什么不顺手改」里，第 ① 条就是这个）：
 * 本仓库的规矩是「**判据与它的双向测必须一起跑**」，而 `newid.js` 此前**没有**
 * 任何双向测 —— 先改就等于又一次「判据没有尺子」（本仓库已因此作废过一次复验，CHG-061）。
 * 所以这一轮是**先给尺子、再改判据**，不是改完补测。
 *
 * **只测纯函数，不写任何文件、不取锁**（尺子不该有副作用）。 */
if (process.argv[2] === '--inject') {
  /* 向量表。`expect:true` = **必须报**（注入真阳性）· `expect:false` = **不得报**（假红守门人）。
   * 每条都写明「它防的是哪个已发生的形状」，而不是造一个想当然的例子。 */
  const V = [
    { why: '全角空括号对（ISS-048 的原形族）', body: '修 （） 与 （） 两处', fromFile: false, expect: true },
    { why: '★ ISS-048 的**真身**：被吃掉的片段留下连续两空格', body: '（同族 ISS-046 的  ）', fromFile: false, expect: true },
    { why: '半角空括号对（前面不是标识符字符）', body: '实测 () 两处', fromFile: false, expect: true },
    { why: '全角空引号对', body: '留了 「」 两处', fromFile: false, expect: true },
    { why: '★ ISS-092 的真身：正文里提到零参函数名 —— **不得**报', body: '实测 x5() 与 main() 都对', fromFile: false, expect: false },
    { why: '零参箭头函数 —— 明确合法的代码，**不得**报', body: 'const f = () => {} 是空参箭头', fromFile: false, expect: false },
    { why: '代码里的空字符串（实测 4 处全是这个）—— **不得**报', body: 'bash "" 与 bash -c "" 都对', fromFile: false, expect: false },
    { why: '记录里合法的代码引用（record-shape.js 已判定属常态）—— **不得**报', body: '实测 Array.isArray(f1) 与 f1[0] 都对', fromFile: false, expect: false },
    { why: '有内容的括号与引号 —— **不得**报', body: '描述里有（正常括号）与「正常引号」', fromFile: false, expect: false },
    /* ★ 下面两条是**同一段正文、两条路径**，结论**必须相反** ——
     * 这一对就是 ISS-092 的修法本身，也是「门是活的」的证明：
     * 门若被写成永远返回空，第一条仍 PASS 而第二条会 FAIL。 */
    { why: '★ 同一正文走 `@文件` 路径 —— **不得**报（按构造不可能被 shell 吃掉）', body: '修 （） 与 连续  两空格 两处', fromFile: true, expect: false },
    { why: '★ 同一正文走**内联**路径 —— **必须**报（与上一条成对，证明门不是死的）', body: '修 （） 与 连续  两空格 两处', fromFile: false, expect: true },
  ];
  console.log('===== newid.js 「疑似被 shell 吃掉片段」检测器 · 双向测 =====');
  let fail = 0;
  for (const v of V) {
    const got = suspectHits(v.body, v.fromFile).length > 0;
    const ok = got === v.expect;
    if (!ok) fail++;
    console.log((ok ? 'PASS  ' : 'FAIL  ') + (got ? 'CAUGHT' : 'MISSED') + '  ' + v.why +
      (ok ? '' : '   ← 期望 ' + (v.expect ? 'CAUGHT' : 'MISSED')));
  }
  console.log('结论: ' + (V.length - fail) + '/' + V.length + ' 条符合期望');

  /* ── 第二组：`bodyStartsWithId` 的双向测（ISS-085 / ISS-111，2026-09-16 加）────
   * 为什么它也必须有：本仓库的规矩是「**加规则必须连尺子一起加**」，
   * 而这一条规则正是被「重犯 11 条」逼出来的 —— 没有尺子的规则会静默分叉。 */
  const V2 = [
    { why: '★ 真阳性：正文文件被写成了 `ISS-110 resolved …`（号写进了正文）', body: 'ISS-110 resolved 2026-09-16T12:10Z …', pre: 'ISS', sep: '-', expect: true },
    { why: '★ 真阳性：CHG 同形（当天重犯 8 条的就是这个）', body: 'CHG-138 2026-09-16T12:10Z a.md -- -- 1 2 原因', pre: 'CHG', sep: '-', expect: true },
    { why: '★ 真阳性：EVT 的分隔符是**空格**（与 `-` 不同）', body: 'EVT 040 2026-09-16T12:10:11Z W23 J14 OK a b', pre: 'EVT', sep: ' ', expect: true },
    { why: '正确写法：正文从状态字段开始（ISS-081 的形态）—— **不得**报', body: 'resolved 2026-09-16T04:12Z 2026-09-16T04:12Z medium …', pre: 'ISS', sep: '-', expect: false },
    { why: '合法自指：号出现在正文**中间**（ISS-063 的「补充」形态）—— **不得**报', body: '补充 ISS-063：已复现（第二次）', pre: 'ISS', sep: '-', expect: false },
    { why: '别的前缀不算（`DEC-038` 出现在 ISS 正文里）—— **不得**报', body: 'DEC-038 引用了它', pre: 'ISS', sep: '-', expect: false },
    { why: '正文以别的字段开头（时间戳）—— **不得**报', body: '2026-09-16T12:10Z W23 J14 OK a b', pre: 'EVT', sep: ' ', expect: false },
    /* ★ 已知边界（显式钉住，不假装已覆盖）：下面这条**会被拒**，而它未必是错的 ——
     * 正文第一个 token 是**别的记录的号**（引用另一个 ID）。判定与「正文带了本行的号」
     * 在字面上无法区分（两者都是 `<前缀><分隔符><数字>` 开头）。
     * **为什么接受这个假阳性**：拒绝是**响亮**的（rc=4 + 四行说明），作者改写即可；
     * 而放过的代价是**已实测**的 —— 2026-09-16 一天内落 11 条，之后只剩
     * 「配等量豁免」或「改历史」两条路（append-only）。**两害相权取响亮的那条。** */
    { why: '★ 已知假阳性：正文第一个 token 是**别的记录的号**（`ISS-063 的补充：…`）—— 会被拒', body: 'ISS-063 的补充：已复现（第二次）', pre: 'ISS', sep: '-', expect: true },
  ];
  let fail2 = 0;
  console.log('');
  console.log('===== 「正文不得以号开头」守卫 · 双向测（ISS-085 / ISS-111）=====');
  for (const v of V2) {
    const got = bodyStartsWithId(v.body, v.pre, v.sep);
    const ok = got === v.expect;
    if (!ok) fail2++;
    console.log((ok ? 'PASS  ' : 'FAIL  ') + (got ? 'CAUGHT' : 'MISSED') + '  ' + v.why +
      (ok ? '' : '   ← 期望 ' + (v.expect ? 'CAUGHT' : 'MISSED')));
  }
  console.log('结论（第二组）: ' + (V2.length - fail2) + '/' + V2.length + ' 条符合期望');
  fail += fail2;

  /* ── 第三组：`prefixForms` 的双向测（ISS-113，2026-09-16 加）──────────────
   * 这条守卫的**失效方式很安静**：若被写成永远返回 `{anyForm:0}`，它就永不拒跑 ——
   * 而「永不拒跑」在正常使用下**完全看不出来**（只有传错分隔符时才该响）。
   * 所以真阳性向量里**必须有一条就是那个错**（ISS-113 的实测形状），否则尺子测不出它哑了。 */
  const V3 = [
    { why: '★ 真阳性：ISS-113 的**实测形状** —— 文件里是 `ISS-001`，本次 sep 传成空格', src: 'ISS-001 open …\nISS-002 open …\n', pre: 'ISS', sep: ' ', expect: true },
    { why: '★ 真阳性：反方向 —— 文件里是 `EVT 040`，本次 sep 传成 `-`', src: 'EVT 040 2026-09-16T12:00:00Z …\n', pre: 'EVT', sep: '-', expect: true },
    { why: '真阴性：文件里是 `ISS-001`，sep 传对（`-`）—— **不得**拒', src: 'ISS-001 open …\nISS-002 open …\n', pre: 'ISS', sep: '-', expect: false },
    { why: '真阴性：文件里是 `EVT 040`，sep 传对（**空格**）—— **不得**拒', src: 'EVT 040 2026-09-16T12:00:00Z …\n', pre: 'EVT', sep: ' ', expect: false },
    { why: '真阴性：**空文件**（真正的新记录 —— 第一次写 `EVT 001` 就是这个形状）—— **不得**拒', src: '', pre: 'EVT', sep: ' ', expect: false },
    { why: '真阴性：只有表头/散文、没有任何该前缀的**行首**记录（新文件带格式说明）—— **不得**拒', src: '# 变更记录\n\n格式：`CHG-<序号> …`\n\n序号从 001 起。\n', pre: 'CHG', sep: '-', expect: false },
    { why: '真阴性：该前缀**只在正文中间**出现（不是行首，同 `--inject` 第二组的合法自指）—— **不得**拒', src: '补充 ISS-063：已复现\n见 CHG-136 的说明\n', pre: 'ISS', sep: '-', expect: false },
  ];
  let fail3 = 0;
  console.log('');
  console.log('===== 「分隔符盲扫」守卫 · 双向测（ISS-113）=====');
  for (const v of V3) {
    const pf = prefixForms(v.src, v.pre, v.sep);
    const got = pf.anyForm > 0 && pf.matched === 0;
    const ok = got === v.expect;
    if (!ok) fail3++;
    console.log((ok ? 'PASS  ' : 'FAIL  ') + (got ? 'REFUSE' : 'ALLOW ') + '  ' + v.why +
      (ok ? '' : '   ← 期望 ' + (v.expect ? 'REFUSE' : 'ALLOW')));
  }
  console.log('结论（第三组）: ' + (V3.length - fail3) + '/' + V3.length + ' 条符合期望');
  fail += fail3;

  /* 端到端负向控制：**真目标文件 + 真分隔符，一个都不得被拒**。
   * 上面 7 条都是合成小样本；只有这条跑**真语料** —— 它防的是「守卫太宽」，
   * 即某份真文件的表头/散文恰好让 `anyForm > 0` 而 `matched === 0`。
   * （与 `--inject` 第一组那句「只测纯函数」不冲突：这里也只读、不写、不取锁。） */
  const REALPAIR = { 'issues.md': ['ISS', '-'], 'decisions.md': ['DEC', '-'], 'changes.md': ['CHG', '-'] };
  let realBad = 0, realN = 0;
  for (const f of checkTargets(__dirname)) {
    const base = path.basename(f);
    const pair = REALPAIR[base] || (base.endsWith('.txt') ? ['EVT', ' '] : null);
    if (!pair) continue;
    let s = '';
    try { s = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
    const pf = prefixForms(s, pair[0], pair[1]);
    realN++;
    if (pf.anyForm > 0 && pf.matched === 0) {
      realBad++;
      console.log('FAIL  REAL  ' + path.relative(__dirname, f) + '  会被误拒（anyForm=' + pf.anyForm +
        ' matched=0）← **真语料上的假阳性**');
    }
  }
  console.log('PASS  REAL  ' + realN + ' 个真目标文件 + 真分隔符：' +
    (realBad ? realBad + ' 个被误拒' : '一个都没被拒'));
  fail += realBad;

  /* 顺带把「假阳性面有多大」变成**活的数字**，而不是注释里一个会腐烂的死数 ——
   * 用意同 `record-shape.js --holes`：留给下一个想动这个正则的人。
   * **只报告、不判定**（否则它就是一条永远红的断言，DEC-019）。
   * 口径取「内联」——那是本检测器**唯一**适用的路径（见 `suspectHits` ①）。 */
  let lines = 0, hit = 0;
  for (const f of checkTargets(__dirname)) {
    let s = '';
    try { s = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
    for (const ln of s.split('\n')) { lines++; if (suspectHits(ln, false).length) hit++; }
  }
  console.log('附（只报告，不判定）: 现记录语料 ' + lines + ' 行 · 内联口径下会响 ' + hit + ' 处。' +
    '真正被 shell 吃掉的片段在本仓库应由 `@文件` 机制消除（`alloc.sh:36` 直接拒绝内联正文），' +
    '故此数越高说明本启发式越钝 —— 修前实测 41 处，其中真阳性 1 处。');
  process.exit(fail ? 1 : 0);
}

/* ── `--flatten`：把正文折成**落盘时的那一个形态**（给 `alloc.sh` 的查重复用，ISS-125）──
 * 为什么要有它：`newid.js` 落盘前会把换行折成空格，而 `alloc.sh` 的查重拿的是**原始**正文
 *   —— **两边口径不同**。实测（2026-09-17）的后果**不是** ISS-125 原文写的「重复追加」，
 *   而是更坏的「**静默丢记录**」：`grep -qF -- "$BODY"` 里 `$BODY` **含换行**时，
 *   grep 按「**多行模式 = OR**」处理 → 正文里**任意一行**在文件中出现就判「已写过」→
 *   `rc=0` 跳过 → **一条全新记录消失**，而且**行数不变、没有任何红**。
 *   （实测复现：正文第 2 行 `已有的记录` 恰好是文件里某行的子串 → 全新记录被 SKIP 掉。）
 * 为什么是「一份口径两处用」而不是在 bash 里再写一遍 `tr '\n' ' '`：**复制会静默分叉** ——
 *   落盘口径将来再改一次（ISS-124 就改过一次），第二份实现不会跟着改，
 *   于是「查重」与「写入」又对不上，而**两边都看起来是对的**（本文件头已为这件事写过一次）。
 * 用法：`node newid.js --flatten @<正文文件>` → stdout 打印**折行后的那一行**（**不写任何东西**）
 * 退出码：0 成功 · 4 参数错 / 读不到文件（与主路径同码） */
if (process.argv[2] === '--flatten') {
  const src = process.argv[3];
  if (!src || src.charAt(0) !== '@') {
    console.error('用法: node newid.js --flatten <@正文文件>');
    process.exit(4);
  }
  let t;
  try { t = fs.readFileSync(src.slice(1), 'utf8'); }
  catch (e) {
    console.error('ALLOC-FAIL 读不到正文文件（' + e.code + '）: ' + src.slice(1));
    process.exit(4);
  }
  process.stdout.write(flattenBody(t) + '\n');
  process.exit(0);
}

/* ★ 折行规则**只此一份**（ISS-124 定形态 · ISS-125 抽成函数给 `--flatten` 复用）：
 *   **只折换行**（`\r\n` 连成一片也只折成**一个**空格），**不动空格** ——
 *   第一版写成 `replace(/\s+/g, ' ')` 时顺手压掉了**连续空格** = **静默改写数据**。 */
function flattenBody(s) {
  return s.replace(/[\r\n]+/g, ' ').trim();
}

let [file, pre, sep, body] = process.argv.slice(2);
if (!file || !pre || sep === undefined || body === undefined) {
  console.error('用法: node newid.js <文件> <前缀> <分隔符> <正文|@正文文件>   |   node newid.js --check [<记录根>]   |   node newid.js --inject');
  process.exit(4);
}
/* ★ `@文件` 形式：正文从文件读。
 *
 * 为什么要有这一条 —— **实测教训（ISS-048）**：我把正文写在**双引号**里，
 * bash 把其中的**反引号**当成了命令替换去执行 → 三个片段（`w17-j1` / `CHG-062` / `[98]`）
 * 被**静默吃掉**，写进 `issues.md` 的那一行带着空洞，而 **I1–I7 与 `--check` 全都看不见它**
 * （I1–I7 只解析事件流，`--check` 只看编号）。
 * **「记得用对引号」是纪律，纪律会失效；`@文件` 是机制** —— 正文不再经过 shell 解析。
 * 长正文、含反引号 / 引号 / `$` / 换行的正文，**一律用 `@文件`**。 */
let fromFile = false;   /* ★ 正文是否来自 `@文件` —— 决定下面的 WARN 适不适用（理由见 `suspectHits` ①） */
if (body.charAt(0) === '@') {
  fromFile = true;
  const bf = body.slice(1);
  try { body = fs.readFileSync(bf, 'utf8'); }
  catch (e) {
    console.error('ALLOC-FAIL 读不到正文文件（' + e.code + '），未写入: ' + bf);
    process.exit(4);
  }
  /* 记录格式是**一行一条** —— 正文里的换行必须折成空格，否则会把一条记录劈成多行，
   * 而任何「按行解析」的判据都会把它看成多条。
   *
   * ★ 2026-09-17 修（ISS-124）：这里原来是 `replace(/\s+/g, ' ')` —— `\s` **包含空格**，
   *   于是它顺手把正文里的**连续空格压成一个**。两个后果，都是实测出来的：
   *     ① **静默改写数据**：写 `[週二 15/09/2026  8:40:52.38]`（`%date%` + 空格 + `%time%`，
   *        而 `%time%` 自带前导空格 → 双空格）落盘变成单空格 —— 对一个把「逐字留证」当命的
   *        记录层，这是**内容损坏**，而且**没有任何判据看得见它**。
   *     ② **幂等失效**：`alloc.sh` 的查重是 `grep -qF -- "$BODY"`，`$BODY` 是**原始**正文，
   *        而文件里存的是**压缩后**的形态 → 对任何含连续空格的正文，查重**永远命中不了** →
   *        同一条命令被执行两次就**重复追加**。实测已产生一条**逐字重复**行（CHG-240 ≡ CHG-236）。
   *   ★ 更刺眼的是**同一件事两种口径**：上面的 `suspectHits` 明写「`@文件` 路径的连续空格
   *     是合法的、不必报」（理由正是「这条路径根本没经过 shell」），**而下一行就把它改掉了**。
   *   **修法**：只折**换行**，不动空格 —— 这才是上面注释里写的那个意图。
   *   **残余（ISS-125）**：含**换行**的正文会让查重失效（文件里存的是折行后的形态）。
   *     ★ **2026-09-17 修**：折行规则已抽成 `flattenBody()`，并加 `--flatten` 给 `alloc.sh` 复用
   *       （**一份口径两处用**）。实测的后果**不是**「重复追加」，是「**静默丢记录**」——
   *       `grep -qF` 拿到含换行的正文时按「多行 = OR」处理，正文里**任意一行**在文件中
   *       出现就判「已写过」→ `rc=0` 跳过。完整理由写在上面 `--flatten` 那一段的注释里。 */
  body = flattenBody(body);
}
/* ★ 写入时刻守卫：正文不得以号开头 —— 判定见 `bodyStartsWithId` 的文件头（ISS-085 / ISS-111）。
 * **放在取锁之前**：拒写必须是「根本没写」，不是「写完才发现不对」。 */
if (bodyStartsWithId(body, pre, sep)) {
  console.error('ALLOC-FAIL 正文**以号开头**（`' + pre + sep + '…`），未写入。');
  console.error('  取号器会在正文前面**再加一次**号 → 行首会变成 `' + pre + sep + '### ' + pre + sep + '### …`');
  console.error('  而记录层 append-only：那样写出来的行**永久不合规**（ISS-085 / ISS-082/083/084）。');
  console.error('  修法：正文文件里**不要写号**，只写号后面的内容（例如从状态字段 `resolved …` 开始）。');
  process.exit(4);
}
/* 启发式 WARN（**不是判据**）：被 shell 吃掉的片段通常留下**空括号对**或**连续两空格**。
 * 只提醒不拦 —— 它是启发式，误报会拦住正当写入；而漏报只损失一次提示。
 *
 * ★ 2026-09-16 W23 J14（ISS-092）：检测逻辑已抽到上面的 `suspectHits()` 并**收窄三处**，
 *   且**限定在内联路径** —— 原先它对 `@文件` 路径也响，而那条路径的正文**根本没经过 shell**，
 *   所以它不是「可能误报」而是「**这句话本身不成立**」，还附带建议改用**你已经在用**的形式。
 *   逐分支的实测数字与理由写在 `suspectHits` 的文件头；尺子在 `node newid.js --inject`。 */
const sus = suspectHits(body, fromFile);
if (sus.length) {
  console.error('WARN 正文里有「' + sus.join(' · ') + '」—— 可能被 shell 吃掉了片段（ISS-048 的形状）。' +
    '如不确定，改用 @正文文件 重写这一条（`bash .check/record/alloc.sh <记录文件> <前缀> <分隔符> @正文文件`）。');
}
const re = new RegExp('^' + esc(pre) + esc(sep) + '(\\d+)', 'gm');

/* ★ 分隔符盲扫守卫（ISS-113）—— **放在取锁之前**：拒跑必须是「根本没写」。
 * 判定函数是 `prefixForms`（文件头有完整理由与实测数字）。 */
{
  let s0 = '';
  try { s0 = fs.readFileSync(file, 'utf8'); } catch (e) { s0 = ''; }
  const pf = prefixForms(s0, pre, sep);
  if (pf.anyForm > 0 && pf.matched === 0) {
    console.error('ALLOC-FAIL **分隔符可能传错**：文件里已有 ' + pf.anyForm + ' 行以 `' + pre + '` 开头的记录，');
    console.error('  但按 `' + pre + sep + '` 扫到 **0** 条 —— 本次会从 001 重新开始，落盘一个**重复的号**。');
    console.error('  目标文件: ' + file);
    console.error('  提示: ISS / DEC / CHG 的分隔符是 `-`，EVT 是**空格**（照抄 `alloc.sh` 用法示例那一行）。');
    process.exit(4);
  }
}

const lock = file + '.lock';
let got = false;
for (let i = 0; i < LOCK_TRIES; i++) {
  try { fs.closeSync(fs.openSync(lock, 'wx')); got = true; break; }
  catch (e) {
    /* ★ 「锁被占」与「路径根本不存在」必须分开报 —— 本文件第一版把两者都归到
     * 退出码 3「锁超时」，而实测第一次跑就撞上了后者：Git Bash 的 `mktemp -d`
     * 给出 `/tmp/tmp.XXXX`，原样传给原生 node.exe 会被解析成 `C:\tmp\...`
     * （本项目第 5 次踩，见 ISS-003）。当时 stderr 只写了「锁创建失败（非占用）」，
     * 而退出码 3 的文档含义是「锁超时」—— **归因指向了错的地方**。
     * 现在：非 EEXIST 一律归到 4「参数/路径错」，并把**路径本身**打出来。 */
    if (e.code !== 'EEXIST') {
      console.error('ALLOC-FAIL 不是锁占用（' + e.code + '），未写入');
      console.error('  目标文件: ' + file);
      console.error('  锁文件:   ' + lock);
      console.error('  提示: 给原生 node.exe 传路径必须是 Windows 形式（Git Bash 下先 cygpath -m）');
      process.exit(4);
    }
    /* Atomics.wait 在 node 主线程**可用**（浏览器主线程才禁止）。
     * 用同步等待而不是 setTimeout：本进程必须在拿到锁之前**不往下走**。 */
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_WAIT_MS);
  }
}
if (!got) { console.error('ALLOC-FAIL 锁超时（' + (LOCK_TRIES * LOCK_WAIT_MS / 1000) + 's），未写入'); process.exit(3); }

try {
  let s = '';
  try { s = fs.readFileSync(file, 'utf8'); } catch (e) { s = ''; }
  let mx = 0, m;
  while ((m = re.exec(s)) !== null) mx = Math.max(mx, Number(m[1]));
  const id = pre + sep + String(mx + 1).padStart(PAD, '0');
  fs.appendFileSync(file, id + ' ' + body + '\n');
  /* 写完**当场复核**：锁只保证「这次取号没被插队」，
   * 保证不了「之前已有的重复号」—— 那属于历史，要靠勘误 + 逐条登记修，不靠锁。 */
  const c = classify(file, loadExempt(path.dirname(file)));
  const fresh = (c.dups || []).filter((d) => !d.ex);
  if (fresh.length) {
    console.error('WARN 写入成功，但该文件有**未登记**的重复号: ' +
      fresh.map((d) => d.id + '×' + d.n).join(', ') + '（按 DEC-026 追加勘误）');
  }
  console.log('ALLOC ' + id);
} finally {
  try { fs.unlinkSync(lock); } catch (e) { /* 锁已不在就算了 */ }
}
