'use strict';
/* andyngo-integrity.js —— 事件流完整性校验
 *
 * 出处：规格 `references/andyngo-event-protocol.md` 的「完整性校验（AUDIT 的一部分）」
 * 与 `references/andyngo-record.md` 的同名小节。规格把它列为 AUDIT 的组成部分，
 * 但**没有给出可执行载体** —— 本文件补上那个载体。
 *
 * 判据（逐条，各自独立报）：
 *   I1 字段数：每行必须是 `EVT <seq> <ts> <wave> <job> <status> <art> <ev>` = 8 个字段，
 *              且**不得出现非 EVT 开头的非空行**（污染即 FAIL，v3.2 修 W9 F3）
 *   I2 seq 连续：001..N，无缺号、无重复
 *   I3 evidence_ptr 存在：`--` 放行，其余必须真实存在（规格 event-protocol.md:14/24 原文即此）
 *              （v3.8 撤回 v3.7 的 `isFile` —— 那是我在同一个改动里犯的同一个错，见实现处注释）
 *   I4 ts 形状合规（YYYY-MM-DDThh:mm:ss[.sss](Z|+00:00)）**且数值合法**（日期/时间真实存在）
 *              且单调递增：非降序
 *              （v3.2 修 W9 F2：先校验格式 —— 只有格式统一，字符串比较才等价于时间比较；
 *                v3.6 修 W9 N1：恢复格式维度，去掉对 `Date.parse` 的裸依赖；
 *                v3.7 修 W9 第四轮 F-A/F-A2：加数值域回验，NaN 显式计入、跳过的比较组计数打印）
 *   I5 事件行 ↔ 作业留证 双向单射（v3.2）
 *      定义：「派发」= 一次有合规留证的作业（用户裁决 2026-09-15，见 DEC-007）
 *      取代 v1 的「事件数 == 派发数」—— 后者分母无处可查，恒为 UNVERIFIED
 *      （实测：事件流自身同源、宿主 tasks/ 同源且陈旧、宿主对话日志不记 Agent 调用、
 *        宿主主线程日志不可按会话定位、audit-log 是文件安全审批 —— 五条路全断）
 *      D1 无留证 · D2 孤儿/重复引用 · D3 命名合规或逐条豁免 · D4 wave/job 绑定
 *      **D5 留证必须是「非空文件」**（v3.8 精确化：零字节 / 是目录 / 不是普通文件，三标签分开）
 *      D6 留证必须直接位于本记录根的留证目录内
 *   I6 status 取值合法：必须在 {OK, FAIL, ASK, PROGRESS, BLOCK} 内
 *              ★ **枚举出处与冲突**：`event-protocol.md:12/26` 只写三态 `OK/FAIL/BLOCK`，
 *              而 `SKILL.md:60/61` 写五态（且明文用 `PROGRESS`）—— **规格内部不一致**，
 *              按 DEC-006「取超集、不删名字」处置；收紧会让明文授权的值变假红（见 ISS-035）。
 *   I7 artifact_ptr 存在：`--` 放行，其余必须真实存在**且是文件或目录**（v3.6 新增，v3.7 定稿）
 *      目录引用**逐条点名打印**；规格原文只说「产物路径」，未限制为文件（见实现处注释）
 *      I6/I7 的由来：8 个字段里 `status` 与 `artifact_ptr` **原先没有任何判据看它们** ——
 *      「字段数正确」被当成了「每个字段被检查过」（入规见 DEC-017）。
 *
 * 检查面自述（v3.8，修 W9 第四轮 F-D）：I1–I7 覆盖事件行的全部 8 列 ——
 *   seq→I2 · ts→I4 · wave/job→I5-D4 · status→I6 · artifact_ptr→I7 · evidence_ptr→I3/I5 · 行数→I1。
 *   **改动判据时，这份自述必须同步改**（否则又是一次「改动只落在一条路径上」）。
 *
 * 用法: node .check/andyngo-integrity.js [eventlog路径...]
 *       不带参数则校验 .check/record/eventlog/ 下**全部** .txt
 *       （2026-09-16 前是「只查今天」—— 跨天后昨天的日志会退出检查面，已修）
 * 退出码: 0 = 全 OK；1 = 有 FAIL；2 = 只有 UNVERIFIED 或读不到文件
 */
const fs = require('fs');
const path = require('path');

const HOME = path.resolve(__dirname, '..');
const RECORD = path.join(HOME, '.check', 'record');
const exPrints = [];

function today() {
  return new Date().toISOString().slice(0, 10);
}

let targets = process.argv.slice(2);
if (!targets.length) {
  /* 【2026-09-16 修】不带参数时校验 eventlog/ 下**全部**日志，而不是只查「今天」。
   * 原写法只查 `today()+'.txt'` —— 跨天后，昨天那份日志**不再被任何一次 AUDIT 检查**。
   * 实测（9/16 08:11）：`[I0] UNVERIFIED 文件不存在: …/eventlog/2026-09-16.txt`，
   * 而 9/15 那份 12 行日志从此无人再看。
   * 事件流是 append-only 的历史，**历史不该因为日历翻页而退出检查面**。
   * 目录为空时回退到「今天」（报 I0 UNVERIFIED，而不是静默通过）。 */
  const dir = path.join(RECORD, 'eventlog');
  const all = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((n) => n.endsWith('.txt')).sort().map((n) => path.join(dir, n))
    : [];
  targets = all.length ? all : [path.join(dir, today() + '.txt')];
}

const results = [];
/* v3.6（修 W9 N3）：每条结果记住它**来自哪份日志**。
 * 原写法只打印 `[id] name state detail`，不带 file —— 裸跑两份日志时输出两个 `[I1]` 块，
 * FAIL 行不说是哪份，只能靠 `目标:` 的先后顺序推断。**那是归因错误**，
 * 同族于 ISS-013（`check-protocol.js` 的 C5 报全局行号、不标来源文件）与 ISS-018（EBUSY 裸栈）。
 * 判据报错时的「指向性」和判据本身的正确性一样重要。 */
let curSrc = '';
function add(id, name, state, detail) {
  results.push({ id, name, state, detail, src: curSrc });
}

for (const file of targets) {
  curSrc = path.basename(file);
  if (!fs.existsSync(file)) {
    add('I0', '读事件流', 'UNVERIFIED', '文件不存在: ' + file);
    continue;
  }
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const lines = raw.split('\n').filter((l) => l.length > 0);
  const evtLines = lines.filter((l) => l.startsWith('EVT '));
  const stray = lines.filter((l) => !l.startsWith('EVT '));

  const NAMES = {
    I1: '字段数 = 8（无非 EVT 行）', I2: 'seq 连续', I3: 'evidence_ptr 存在',
    I4: 'ts 格式规范且单调递增', I5: '事件行 ↔ 作业留证 双向单射',
    I6: 'status 取值合法', I7: 'artifact_ptr 存在',
  };

  // 空判据守门人（全局）：空事件流下「每一行都合规」恒真 —— I1–I5 全都会报绿，那是假绿。
  // 一条判据若在「没有东西可判」时报 OK，它证明的不是对象合规，是它自己不会说话。
  //
  // v3.6（修 W9 N2）：**守门人不能把「全是污染」判成「空」**。
  //   原写法 `if (evtLines.length === 0)` 排在 stray 计算**之后但判断之前**，
  //   于是「0 条 EVT + N 条垃圾」永远走不到 I1，5 条全报 UNVERIFIED 且提示语写
  //   「事件流为空（0 行）」—— 而那份日志明明有 N 行、且**全是污染**。
  //   **提示语与事实相反，比不报还坏**（它会让人以为「今天还没干活」，实际是「记录被弄脏了」）。
  //   同族：UTF-8 BOM 让首行不以 `EVT ` 开头 → 同样被误判成「空」。
  //   修法：先分流，三种情况各说各的话 ——
  //     · 0 行            → 全 UNVERIFIED「文件为空」（真·没东西可判）
  //     · 0 EVT + N 污染  → **I1 FAIL**（污染是判得出来的事实，不许降级成「判不了」），其余 UNVERIFIED
  //     · 有 EVT 行       → 照常走完（I1 自己会报 stray）
  if (evtLines.length === 0) {
    if (stray.length === 0) {
      for (const id of ['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7']) {
        add(id, NAMES[id], 'UNVERIFIED', '文件为空（0 行）—— 判据空转，不报 OK');
      }
    } else {
      add('I1', NAMES.I1, 'FAIL',
        '另有 ' + stray.length + ' 行不以 EVT 开头，且**整份日志没有任何 EVT 行**（全是污染）: ' +
        stray.slice(0, 3).map((s) => JSON.stringify(s.slice(0, 40))).join(', '));
      for (const id of ['I2', 'I3', 'I4', 'I5', 'I6', 'I7']) {
        add(id, NAMES[id], 'UNVERIFIED', '没有 EVT 行（' + stray.length + ' 行全是污染）—— 判据空转');
      }
    }
    continue;
  }

  // I1 字段数 + 事件流纯净性
  //   v3.2（修 W9 F3）：非 EVT 开头的**非空行** = 事件流被污染，必须报 FAIL。
  //   原先只在 OK 的附注里提一句「另有 N 行不以 EVT 开头」—— 状态仍是 OK = 假绿。
  //   W9 复现：插一行 `GARBAGE …` → 仍报 OK。
  const bad = [];
  for (let i = 0; i < evtLines.length; i++) {
    const f = evtLines[i].split(/\s+/);
    if (f.length !== 8) bad.push({ no: i + 1, n: f.length, text: evtLines[i].slice(0, 70) });
  }
  const i1detail = [
    bad.length ? '共 ' + bad.length + ' 行字段数不对: ' + bad.map((b) => '第' + b.no + '行(' + b.n + '字段)').join(', ') : '',
    stray.length ? '另有 ' + stray.length + ' 行不以 EVT 开头（事件流被污染）: ' + stray.slice(0, 3).map((s) => JSON.stringify(s.slice(0, 40))).join(', ') : '',
  ].filter(Boolean).join('；');
  add('I1', '字段数 = 8（无非 EVT 行）', (bad.length || stray.length) ? 'FAIL' : 'OK',
    i1detail || evtLines.length + ' 行全部 8 字段，且无非 EVT 行');

  // I2 seq 连续
  const seqs = evtLines.map((l) => l.split(/\s+/)[1]);
  const gaps = [], dup = [];
  const seen = new Set();
  for (const s of seqs) {
    if (seen.has(s)) dup.push(s);
    seen.add(s);
  }
  for (let i = 0; i < seqs.length; i++) {
    const want = String(i + 1).padStart(3, '0');
    if (seqs[i] !== want) gaps.push('第' + (i + 1) + '行 seq=' + seqs[i] + '（期望 ' + want + '）');
  }
  add('I2', 'seq 连续', gaps.length || dup.length ? 'FAIL' : 'OK',
    gaps.length ? gaps.join('; ') : (dup.length ? '重复: ' + dup.join(',') : seqs.length + ' 条 seq = ' + seqs.join(' ')));

  /* 【v3.8，修 W9 第五轮 F-H3】**唯一一个「路径是否存在」的探针。**
   * 原先 I3 用 `fs.existsSync`，I7 用 `existsSync` + `statSync` **两段** —— 两个探针在
   * **设备路径上结论相反**：`//./NUL` 的 `existsSync` 返回 false 而 `statSync` 成功
   * → 走进 missing 分支，`oddArt`（「既非文件也非目录」）那条分支**在 Windows 上不可达**。
   * **一个永远不可达的分支 = 一条永远绿的断言**（DEC-019 的同族：绿不会被看见）。
   * 统一成一个 try/catch，返回 stat 或 null。I3 与 I7 共用它 —— 一份实现，两个调用者。 */
  function statOf(p) { try { return fs.statSync(p); } catch (e) { return null; } }

  // I3 evidence_ptr 存在
  //   【v3.8 撤回 isFile —— 修 W9 第五轮 F-H1】
  //   规格原文（references/andyngo-event-protocol.md）：
  //     第 14 行 `| evidence_ptr | 子代理 | 必须真实存在 |`
  //     第 24 行 `2. 证据写磁盘，路径放 evidence_ptr（必须真实存在）`
  //   —— **只说「必须真实存在」，没有说必须是文件。**
  //   v3.7 我为了「与 I7 对称」给它加了 `isFile` —— **那正是我在 F-C 上刚拒绝过的同一个错误**
  //   （判据不得发明规格没有的约束）。**同一个改动里犯了两次：I7 放宽、I3 收紧。**
  //   W9 的探针（p）给了决定性证据：一个**被逐条豁免**的目录留证，D3 因豁免而满足，
  //   **I3 却照样报红** —— 说明 I3 的 isFile 不是从 D3 的命名约定推出来的，
  //   而是一条**独立新增的**、规格里没有的约束；并且它与 D5 构成**双重计数**（同一事实两个标签）。
  //   → 口径归位：**存在性归 I3**（规格原文即此）；
  //     「留证必须是**非空文件**」归 **D5**（那是「证据」这个概念的门槛，不是路径存在性）。
  const missing = [];
  for (const l of evtLines) {
    const ev = l.split(/\s+/)[7];
    if (!ev || ev === '--') continue;
    const p = path.isAbsolute(ev) ? ev : path.join(HOME, ev);
    if (!statOf(p)) missing.push(ev);
  }
  add('I3', 'evidence_ptr 存在', missing.length ? 'FAIL' : 'OK',
    missing.length ? '缺失 ' + missing.length + ' 个: ' + missing.join(', ')
      : '全部 evidence_ptr 真实存在（`--` 已放行）');

  // I4 ts 格式规范且单调递增
  //   v3.2（修 W9 F2）：原判据**直接字符串比较**。ts 小时不补零时（`…T9:00:00Z` 与
  //   `…T13:00:00Z`），字符串比较认为 `'9' > '1'` = 递增，而真实时间**递减** → 假绿。
  //   v3.3（修 W9 G3）：格式白名单**过窄** —— 合法 ISO `…T13:00:00.000Z`（带毫秒）
  //   被判「格式不合」= 假红。改成**直接解析成时间戳再比较**，自动接受一切可解析变体。
  //   v3.6（修 W9 N1）：**那次修法的副作用是「格式」这个维度被整个丢掉了**，
  //   而且判定会**随本机时区变化**。W9 复现三例：
  //     · ts = `2026-09-15`（只有日期）  → `Date.parse` 成功 → 判绿
  //     · ts = `9/15/2026`（非 ISO）     → `Date.parse` 成功 → 判绿
  //     · ts = `…T13:00:00`（**缺 Z**）  → 按**本机时区**解析，再与 `…T13:00:00Z` 比大小
  //                                        → 本机 offset=-480 时判「乱序」；UTC 机器上判「非降」
  //   第三条最严重：**同一份日志的 I4 结论随机器时区变化** —— 判据的结论依赖环境，
  //   等于它其实「不知道」，却照样报出了 OK/FAIL。
  //   修法：**先把格式钉死，再解析比较**。要求 `YYYY-MM-DDThh:mm:ss[.sss](Z|+00:00)` ——
  //   既恢复格式维度（拒绝 date-only / 非 ISO / 缺 Z），又不重开 G3 的假红
  //   （`.000Z` 与 `+00:00` 都在白名单内）。**格式不合与时间乱序分开报，不合并成一个「坏」。**
  //   v3.7（修 W9 第四轮 F-A / F-A2）：
  //     F-A  `TS_RE` 只数位数、**不校验数值域** → `2026-13-45T99:99:99Z` 形状全对，
  //          而 `Date.parse` 返回 NaN → `tsNum[i]` 是 NaN → nonMono 的 `!isNaN` 守门把它跳过
  //          → **报 OK**。这是真假绿：判据对「不存在的日期」说「格式合规」。
  //     F-A2 一个 NaN 会让**相邻两组比较全被跳过** → 单调性在局部根本没被校验，却报「非降」。
  //     修法：① 形状层之后加**数值域回验**（规范化到秒再比对，接住 02-30 滚日 / 25:00 滚时 /
  //            99:99:99 溢出）；② NaN **显式计入格式不合**（不再靠下游守门静默丢弃）；
  //            ③ 因非法 ts 而**跳过的比较组数显式计数并打印** —— 不许「因为已经 FAIL 了，
  //            就当单调性检查过了」。
  //     F-E（保持现状，仅记明理由）：`+08:00` 与小写 `t`/`z` 判 FAIL —— 规格把 ts 钉成
  //            `…Z`（`+00:00` 是等价写法故放行），非 UTC 形式不受理。
  const TS_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|\+00:00)$/;
  // 返回 null = 合法；'形状' = 不匹配 TS_RE；'数值' = 形状对但日期/时间不存在
  function tsCheck(t) {
    const m = TS_RE.exec(t);
    if (!m) return '形状';
    const n = Date.parse(t);
    if (Number.isNaN(n)) return '数值';
    // 回验：ISO 规范化后**比较到秒**。`2026-02-30` 会被滚成 03-02、`T25:00:00Z` 会滚到次日，
    // 规范化结果与原文不一致 → 判「数值」非法。（只比到秒：毫秒以下精度不该被当格式错 ——
    // 那是 G3/N5 那一类「过紧假红」。）
    const norm = new Date(n).toISOString().slice(0, 19);
    const want = m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6];
    return norm === want ? null : '数值';
  }
  const tss = evtLines.map((l) => l.split(/\s+/)[2]);
  const tsInfo = tss.map((t) => ({ t, bad: tsCheck(t) }));
  const badShape = tsInfo.filter((x) => x.bad === '形状');
  const badValue = tsInfo.filter((x) => x.bad === '数值');
  const badFmt = badShape.concat(badValue);
  const tsNum = tsInfo.map((x) => (x.bad ? NaN : Date.parse(x.t)));
  const nonMono = [];
  let skipped = 0;
  for (let i = 1; i < tss.length; i++) {
    if (Number.isNaN(tsNum[i]) || Number.isNaN(tsNum[i - 1])) { skipped++; continue; }
    if (tsNum[i] < tsNum[i - 1]) nonMono.push(tss[i - 1] + ' → ' + tss[i]);
  }
  const uniq = (a) => [...new Set(a.map((x) => x.t))].slice(0, 3).join(', ');
  const i4detail = [
    badShape.length ? '格式不合·形状 ' + badShape.length + ' 条（要求 YYYY-MM-DDThh:mm:ss[.sss]Z，UTC）: ' + uniq(badShape) : '',
    badValue.length ? '格式不合·数值非法 ' + badValue.length + ' 条（形状合规，但日期/时间不存在）: ' + uniq(badValue) : '',
    nonMono.length ? '乱序: ' + nonMono.join('; ') : '',
    skipped ? '因非法 ts 跳过 ' + skipped + ' 组相邻比较（单调性未被完整校验）' : '',
  ].filter(Boolean).join('；');
  add('I4', NAMES.I4, (badFmt.length || nonMono.length) ? 'FAIL' : 'OK',
    i4detail || tss.length + ' 条 ts 形状合规、数值合法且非降');

  // I5 事件行 ↔ 作业留证 双向单射（v3.2）
  //   A = 合规留证集 = <evidenceDir>/ 下 basename 匹配 ^w\d+-j\d+-.+\.txt$ **且非空**（slug 非空）
  //   B = 行引用集   = 各行 evidence_ptr 的 basename（排除 --）
  //   D1 每条行的 evidence_ptr ≠ --                        （记账必须有留证）
  //   D2 A 成员无孤儿；**任一 base 不得被多行引用**（v3.2：查重对全部行，不只对 A 成员）（干活必须记账）
  //   D3 每条行的留证 basename 合规，或被**指名**豁免
  //   D4 留证名里的 w<job>/j<wave> 必须与行的 wave/job 字段一致（真绑定；数字规范化比较）
  //   D5 合规留证必须非空（零字节 = 没留证）
  //   D6 行的留证必须**位于本记录根的留证目录内**（v3.2，修 W9 F1 的根因 ——
  //      A 集扫目录、B 集来自行，两者不在同一空间时双向单射无从谈起）
  //
  // v3 修订（CHG-022）：W9 独立验收亲手复现了 4 处假绿 + 1 处假红，逐条对应修法：
  //   ① A 空集不设防（v2 的守门人只挡「0 行」，挡不住 A=0）→ A.length===0 → UNVERIFIED
  //   ② 零字节文件即算合规                            → D5
  //   ③ 行的 wave/job 与文件名无绑定                   → D4
  //   ④ 豁免按 seq 松匹配（= 万能钥匙）                → 豁免必须**写明该行的 evidence basename**
  //   ⑤ 假红：豁免表用全局固定路径，跑别的日志会伪报悬空豁免 → 豁免表与留证目录**同源推导**
  // v3.1 修订（CHG-023）：v3 自己引入的一处**双重计数**被双向测 R10 抓到 ——
  //   「豁免只写 seq、不写文件名」时，该行同时被 D3 与「悬空豁免」各报一次。
  //   那两条本是同一事实（豁免不生效）的两个标签。按 v3 已为 D1/D3 立下的正交规矩拆开：
  //   exDangling 收窄为「seq 不在事件流」；「行不合规 + 豁免未指名」只由 D3 报并附注；
  //   新增 exInert 补上原先无人报的空档（行本身合规 + 豁免白登记 → 无任何信号 = 假绿）。
  const logBase = path.basename(file, path.extname(file));
  const recordRoot = path.dirname(path.dirname(file)); // <record>/eventlog/x.txt → <record>
  const evDir = path.join(recordRoot, 'evidence', logBase);
  // v3.2（修 W9 F5）：slug 必须非空（`.*` → `.+`）—— `w1-j1-.txt` 无 slug 却计入 A 且判 OK
  const CONF = /^w(\d+)-j(\d+)-.+\.txt$/;

  // 豁免表与留证目录**同源推导** —— 换一份日志就换一份豁免表，不会伪报悬空豁免（修 ⑤）
  // v3.4 补：**必须连「按日志分」也同构**。seq 是**按日志**编号的（每份日志都从 001 开始），
  //   而 v3.1 只把**留证目录**改成按 logBase 推导，豁免表仍是全局单文件 → 跨天后，
  //   昨天登记的 `EVT 005/007` 在今天那份日志里找不到 → 伪报「悬空豁免」（实测 9/16 08:1x 报 FAIL）。
  //   ⚠ 若改成「exDangling 查**全部**日志的 seq」则是**更坏**的修法：今天若也有 seq 005，
  //     昨天针对 005 的豁免会**误豁免今天的 005** —— 那是假绿，比假红危险。
  //   故：豁免表与留证目录**同构**，都按 `<logBase>` 分。
  const exFile = process.env.ANDYNGO_EXEMPTIONS || path.join(recordRoot, 'exemptions', logBase + '.md');
  const exMap = new Map(); // seq -> 登记原文
  const exDup = [];        // 同一 seq 被登记两次 —— 后者静默顶掉前者，登记表自相矛盾
  if (fs.existsSync(exFile)) {
    for (const l of fs.readFileSync(exFile, 'utf8').replace(/\r\n/g, '\n').split('\n')) {
      const m = /^EX-\d+\s+EVT\s+(\d+)\s/.exec(l.trim());
      if (!m) continue;
      const s = m[1].padStart(3, '0');
      if (exMap.has(s)) exDup.push(s);
      exMap.set(s, l.trim());
    }
  }
  // 豁免必须**指名**它豁免的是哪个留证文件（修 ④：按 seq 匹配 = 万能钥匙）
  // v3.1：且必须是**完整 token**，不是子串 —— `indexOf` 会让登记里的 `w1-j1-a.txt.bak`
  //       也「覆盖」`w1-j1-a.txt`，等于豁免被冒领（自测 R12）。
  //       反引号、逗号、括号都不属于 [\w.-]，故 `` `x.txt` `` / `(x.txt)` 里的 x.txt 仍是完整 token。
  const exCovers = (seq, base) => {
    const t = exMap.get(seq);
    return !!t && t.split(/[^\w.-]+/).indexOf(base) >= 0;
  };

  const A = fs.existsSync(evDir)
    ? fs.readdirSync(evDir).filter((n) => CONF.test(n)).sort()
    : [];

  const rows = evtLines.map((l) => {
    const f = l.split(/\s+/);
    return { seq: f[1], wave: f[3], job: f[4], ev: f[7], base: path.basename(f[7] || '--') };
  });
  const cnt = (b) => rows.filter((r) => r.base === b).length;

  const d1 = rows.filter((r) => !r.ev || r.ev === '--').map((r) => 'EVT ' + r.seq);
  const d2orphan = A.filter((a) => cnt(a) === 0);
  // D2 重复引用：**对全部行的 base 查重**，不只对 A 成员。
  //   v3.2（修 W9 F1）：原写法 `A.filter(a => cnt(a) > 1)` 只查留证目录内的文件 ——
  //   行若指向目录外（或别处同名文件），该 base 根本不在 A 里，**两行共用一份留证就查不出来**。
  const d2dup = [...new Set(rows.filter((r) => r.ev && r.ev !== '--').map((r) => r.base))]
    .filter((b) => cnt(b) > 1).sort();
  // D3：命名不合规且未被指名豁免。**排除 `--`** —— 没有留证的行由 D1 单独标签，避免双重计数
  const d3bad = rows.filter((r) => r.ev && r.ev !== '--' && !CONF.test(r.base) && !exCovers(r.seq, r.base));
  // D4：名字像但 wave/job 对不上 —— 只在命名合规时判（不合规的由 D3 接管，避免双重计数）
  //   v3.2（修 W9 F4）：数字**规范化**比较。原写法 `m[1] !== r.wave.replace(/^W/i,'')` 用字符串比，
  //   于是 `w01-j01-x.txt` 被 CONF 收进 A、又被 D4 判为与 `W1 J1` 不一致 → 该文件既入 A 又必成
  //   孤儿 = **口径不一致造成的假红**。规范化后 `01` 与 `1` 视为同一。
  //   v3.3（修 W9 低危）：`Number('')` === 0 —— 行的 wave 字段若写成 `W`（无数字），
  //   会与 `w0-j1-x.txt` 的 `Number('0')` === 0 **等价而漏报**。故先校验字段格式。
  //   v3.6（修 W9 N5）：**字段格式校验过紧，且把两件事混成一个标签**。
  //   原写法要求字段必须形如 `W<n>` / `J<n>`；但本文件 I1 给的格式是
  //   `EVT <seq> <ts> <wave> <job> <status> <art> <ev>` —— **并未要求带 W/J 前缀**。
  //   W9 复现：行写 `1 1`、文件 `w1-j1-a.txt` → 数值一致，却报
  //   「D4 文件名与行的 wave/job **不一致**」—— 而事实是**格式**问题，不是不一致。
  //   修法：前缀**可选**，但必须取得出数字；取不出数字才算格式错（R22 的 `W` 无数字仍 FAIL）。
  //   并把「格式错」与「数值不一致」**分开报** —— 一个标签只能指一件事。
  const num = (s) => {
    const m = /^[WJ]?(\d+)$/i.exec(s || '');
    return m ? Number(m[1]) : null;
  };
  const d4bad = rows.filter((r) => {
    const m = CONF.exec(r.base);
    if (!m) return false;
    const w = num(r.wave), j = num(r.job);
    if (w === null || j === null) return true;        // 格式错：取不出数字
    return w !== Number(m[1]) || j !== Number(m[2]);  // 绑定错：数字对不上
  });
  // D6 留证必须**直接位于本记录根的留证目录内**（v3.2 立，v3.3 修 W9 G1/G2 两个洞）
  //   这是「A 集（扫目录）与 B 集（行引用）处在同一空间」的前提 —— 否则双向单射无从谈起：
  //   行可以指向任何地方，而 A 永远不知道。W9 第一轮复现：两行同指 `<T>/n15/elsewhere/…` → 判 OK。
  //   注意相对路径按 I3 的口径解析（`path.join(HOME, ev)`），与 I3 保持一致。
  //
  //   v3.3 补两个洞（W9 第二轮，**不需要任何特权**即可复现）：
  //     ① G1 子目录走私：A 集是 `readdirSync(evDir)` —— **只扫顶层**。而 v3.2 的 D6 用
  //        `path.relative` 做**纯词法**比较，`evDir/sub/x.txt` 得到 `sub/x.txt`（不以 `..` 开头）
  //        → 判「在目录内」。于是该文件**根本不在 A 里**（不入 A↔B 单射），判据却宣布「单射成立」。
  //        **根因是 D6 与 A 集的定义没对齐**：A 是「顶层」，D6 也必须要求「顶层」。
  //     ② G2 junction 走私：纯词法比较不穿透符号链接/junction。`<evDir>/link` 指向目录外时，
  //        词法上仍「在目录内」→ 需 `realpathSync` 解析真实路径。
  const evDirReal = (() => {
    try { return fs.realpathSync(path.resolve(evDir)); } catch (e) { return path.resolve(evDir); }
  })();
  const d6out = rows.filter((r) => {
    if (!r.ev || r.ev === '--') return false;
    const raw = path.resolve(path.isAbsolute(r.ev) ? r.ev : path.join(HOME, r.ev));
    // ① realpath 穿透链接；不存在时退回词法路径（「不存在」由 I3 负责报，不在这里重复）
    let p = raw;
    try { p = fs.realpathSync(raw); } catch (e) { /* 保持词法路径 */ }
    const rel = path.relative(evDirReal, p);
    // ② 越界：以 `..` 开头 / 是绝对路径（跨盘符时 path.relative 返回绝对路径）/ 含分隔符（非直接子项）
    return rel.startsWith('..') || path.isAbsolute(rel) || rel.includes('/') || rel.includes('\\');
  });
  // D5 合规留证必须是**非空文件**（v3.8 精确化，修 W9 第五轮 F-H1 的「标签错 + 承接约束」）
  //   原写法 `statSync(path.join(evDir,a)).size === 0`，`catch → true`，三个问题：
  //     ① **目录**在 Windows 上 size 也是 0 → 一个名为 `w1-j1-a.txt` 的目录被报成「零字节」——
  //        **标签与事实不符**（它不是零字节，它根本不是文件）。「一个标签只指一件事」。
  //     ② `catch → true` 把「读不到属性」也算成零字节 —— 同一个标签又指了第二件事。
  //     ③ 它现在承接了原先**错放在 I3** 的「必须是文件」这条约束（F-H1 的口径归位）：
  //        A 集成员是**合规命名**的留证（名字已过 D3 门槛），所以这里问的是
  //        「这份留证，是一份**非空的文件**吗？」—— 这是「证据」这个概念的门槛，
  //        不是「路径是否存在」（那是 I3），也不是「是否按约定命名」（那是 D3）。
  const d5bad = A.map((a) => {
    const st = statOf(path.join(evDir, a));
    if (!st) return null;                     // 读不到属性 → 不在这里重复报（存在性归 I3、归属归 D6）
    if (st.isDirectory()) return { a, why: '是目录' };
    if (!st.isFile()) return { a, why: '不是普通文件' };
    if (st.size === 0) return { a, why: '零字节' };
    return null;
  }).filter(Boolean);
  const exUsed = [...new Set(rows.filter((r) => !CONF.test(r.base)).map((r) => r.seq))]
    .filter((s) => exCovers(s, rows.find((r) => r.seq === s).base)).sort();

  // 表侧信号必须与 D1–D5 **正交** —— 同一事实只报一次（v3 已为 D1/D3 立过这条规矩，
  // 这里把 v3 自己漏掉的一处补上）：
  //   exDangling 登记的 seq **不在事件流**          —— 表指向不存在的行
  //   exInert    登记的 seq 在、**该行留证本身合规**、豁免未指名任何一行 —— 登记白费
  //   「行不合规 + 豁免未指名」**不在这里报**，由 D3 报并附注原因（原先两处都报 = 双重计数）
  const allSeqs = new Set(rows.map((r) => r.seq));
  const exDangling = [...exMap.keys()].filter((s) => !allSeqs.has(s)).sort();
  const exInert = [...exMap.keys()].filter((s) => {
    const rs = rows.filter((r) => r.seq === s);
    return rs.length > 0 && rs.every((r) => CONF.test(r.base)) && !rs.some((r) => exCovers(s, r.base));
  }).sort();

  const f5 = [];
  if (!fs.existsSync(evDir)) f5.push('留证目录不存在: ' + path.relative(HOME, evDir).split(path.sep).join('/'));
  if (d1.length) f5.push('D1 无留证的行: ' + d1.join(', '));
  if (d2orphan.length) f5.push('D2 孤儿留证（无行引用）: ' + d2orphan.join(', '));
  if (d2dup.length) f5.push('D2 被重复引用: ' + d2dup.join(', '));
  if (d3bad.length) f5.push('D3 未按约定命名且未被有效豁免: ' + d3bad.map((r) =>
    'EVT ' + r.seq + '(' + r.base + ')' +
    (exMap.has(r.seq) ? '【该 seq 有豁免登记但未指名本文件名 → 登记不生效】' : '')).join(', '));
  if (d4bad.length) f5.push('D4 文件名与行的 wave/job 不符: ' + d4bad.map((r) => {
    const w = num(r.wave), j = num(r.job);
    const why = (w === null || j === null) ? '字段格式错（取不出数字）' : '数值不一致';
    return 'EVT ' + r.seq + '(' + r.wave + ' ' + r.job + ' vs ' + r.base + ' · ' + why + ')';
  }).join(', '));
  if (d5bad.length) f5.push('D5 留证不是非空文件: ' + d5bad.map((x) => x.a + '（' + x.why + '）').join(', '));
  if (d6out.length) f5.push('D6 留证不在本记录根的留证目录内: ' + d6out.map((r) => 'EVT ' + r.seq + '(' + r.ev + ')').join(', '));
  if (exDangling.length) f5.push('悬空豁免（登记的 seq 不在事件流）: ' + exDangling.join(', '));
  if (exInert.length) f5.push('无效豁免（该行留证本身合规，豁免未指名任何留证 → 白登记）: ' + exInert.join(', '));
  if (exDup.length) f5.push('豁免表重复登记同一 seq（后者静默顶掉前者）: ' + [...new Set(exDup)].sort().join(', '));

  const stat5 = 'A=' + A.length + ' B=' + rows.length + ' 豁免=' + exUsed.length;
  // A=0 守门人（修 ①，v3.1 收窄）：A 为空只让 **D2** 不可判（无对可建）；
  // D1/D3/D4/D5 是**行侧**判据，不依赖 A 集，照常判。
  // 故「UNVERIFIED」的准确条件是：A=0 **且行侧一条缺陷都没判出来**（真的没有东西可判）。
  // 若 A=0 而行侧判出了缺陷，那是有东西可判且判出了错 —— 报 FAIL，不是 UNVERIFIED。
  //   （自测 R12/R13 首跑正是被这条过宽的条件盖成 UNVERIFIED 的）
  if (A.length === 0 && f5.length === 0) {
    add('I5', '事件行 ↔ 作业留证 双向单射', 'UNVERIFIED',
      '合规留证集为空（A=0）—— 双向单射无可建立，判据空转，不报 OK ｜ ' + stat5);
  } else if (f5.length) {
    add('I5', '事件行 ↔ 作业留证 双向单射', 'FAIL', f5.join('；') + ' ｜ ' + stat5);
  } else {
    add('I5', '事件行 ↔ 作业留证 双向单射', 'OK', '双向单射成立 · ' + stat5);
  }
  // I6 status 取值合法（v3.6 新增，修 W9 O1；v3.8 写明枚举出处，回应 W9 第五轮 F-H2）
  //   起因：`status` 这一列**从未被任何判据检查过**。W9 复现：把 status 写成 `GARBAGE-STATUS`
  //   → 5 OK / 0 FAIL，全绿。也就是说这一列可以任意乱写而系统毫无反应 ——
  //   **一列没有任何判据的字段，等于一列自由的注释。**
  //
  //   ★ 枚举的**出处与冲突**（v3.8 补，这是 F-H2 的实质）：
  //     · `references/andyngo-event-protocol.md:12` → `OK/FAIL/BLOCK`（**三态**）
  //     · `references/andyngo-event-protocol.md:26` → 「status 三态：OK / FAIL / BLOCK」
  //     · `SKILL.md:60`                             → `OK / FAIL / ASK / PROGRESS / BLOCK`（**五态**）
  //     · `SKILL.md:61`                             → 「PROGRESS 不消耗 ASK 配额」
  //   **两份文档不一致**（定义字段的那份说三态，注册文件说五态）。
  //   按 DEC-006 立下的处置：**规格内部矛盾时取超集，任何名字都不删。**
  //   **为什么不收紧到三态**：收紧会让 `SKILL.md` **明文授权**的 `PROGRESS` / `ASK`
  //   变成 FAIL —— 那是对**合法输入**判红，正是 G3 / N5 / F-C / F-H1 那一类「过紧假红」。
  //   W9 自己给了两个选项（收紧 / 写明出处并说明为何取超集），这里取后者。
  //   **这条枚举不是「不可证伪的过宽」**：R27 已证明它能对 `GARBAGE-STATUS` 报红。
  //   两份文档要不要统一 → 记入 ISS-035，**不由判据单方面决定**。
  const STATUS_OK = new Set(['OK', 'FAIL', 'ASK', 'PROGRESS', 'BLOCK']);
  const badStatus = evtLines
    .map((l, i) => ({ i: i + 1, s: l.split(/\s+/)[5] }))
    .filter((x) => !STATUS_OK.has(x.s));
  add('I6', NAMES.I6, badStatus.length ? 'FAIL' : 'OK',
    badStatus.length
      ? '非法取值 ' + badStatus.length + ' 处: ' +
        badStatus.slice(0, 3).map((x) => '第' + x.i + '行(' + x.s + ')').join(', ') +
        '（合法值来自 SKILL.md 输出形态: ' + [...STATUS_OK].join('/') + '）'
      : '全部 status ∈ {' + [...STATUS_OK].join('/') + '}');

  // I7 artifact_ptr 存在（v3.6 新增，修 W9 O1；v3.7 回应 W9 第四轮 F-C）
  //   规格原文（references/andyngo-event-protocol.md 第 13 行 / 第 23 行）：
  //     `artifact_ptr | 子代理 | 产物路径；无则 --` · `1. 产物写磁盘，路径放 artifact_ptr`
  //   —— **只说「路径」，没有说必须是文件**。一个 wave 的产物可以是一棵目录树
  //   （真盘 EVT 002 的 `skills/andyngo/` 就是实例：W2 产出的是 22 个文件）。
  //
  //   F-C 的**机制观察成立**（`existsSync` 对目录也返回 true），但**结论不成立**
  //   （「目录被当合法」不是缺陷）。判据不得发明规格没有的约束 —— 那正是 G3（`.000Z` 被误判
  //   假红）与 N5（`1 1` 被误判不一致）那一类「过紧假红」的同族。故：
  //     · I7 判「存在」且「必须是文件或目录」（排掉两者皆非的怪类型）；
  //     · **目录引用逐条点名打印** —— 这是对 F-C 的实质回应：不隐藏，让人看得见。
  //   ★ 两个指针口径**故意不同**：I3（evidence_ptr）严格要求 isFile，因为规格的 D3 命名约定
  //     `w<wave>-j<job>-<slug>.txt` 已经强制它是文件；I7 没有这层约定。
  //     **口径由规格决定，不由对称美学决定。**
  const missingArt = [];
  const oddArt = [];
  const dirArt = [];
  for (const l of evtLines) {
    const a = l.split(/\s+/)[6];
    if (!a || a === '--') continue;
    const p = path.isAbsolute(a) ? a : path.join(HOME, a);
    const st = statOf(p);            // 与 I3 **同一个探针**（v3.8，修 F-H3）
    if (!st) { missingArt.push(a); continue; }
    if (st.isDirectory()) dirArt.push(a);
    else if (!st.isFile()) oddArt.push(a);
  }
  const i7bad = missingArt.length || oddArt.length;
  add('I7', NAMES.I7, i7bad ? 'FAIL' : 'OK',
    i7bad
      ? [
        missingArt.length ? '缺失 ' + missingArt.length + ' 个: ' + missingArt.join(', ') : '',
        oddArt.length ? '既非文件也非目录: ' + oddArt.join(', ') : '',
      ].filter(Boolean).join('；')
      : (dirArt.length
        ? '全部 artifact_ptr 存在（`--` 已放行）；其中 ' + dirArt.length + ' 个指向**目录**（规格允许「产物路径」，此处逐条点名）: ' + dirArt.join(', ')
        : '全部 artifact_ptr 真实存在（且都是文件；`--` 已放行）'));

  for (const s of exUsed) exPrints.push('EXEMPT  ' + exMap.get(s));
}

const order = { OK: 0, FAIL: 1, UNVERIFIED: 2 };
const tally = { OK: 0, FAIL: 0, UNVERIFIED: 0 };
for (const r of results) tally[r.state]++;

console.log('===== andyngo · 事件流完整性校验 =====');
console.log('目标: ' + targets.map((t) => path.relative(HOME, t).split(path.sep).join('/')).join(', '));
/* v3.6（修 W9 N3）：每条结果带上**来源日志**。
 * 多份日志时，光看 `[I1] … OK` 分不清是哪一份 —— 只能靠 `目标:` 的先后顺序推断。
 * 那是**归因错误**（同族 ISS-013 的 C5 报全局行号 / ISS-018 的 EBUSY 裸栈）。
 * **判据报错时的指向性，和判据本身的正确性一样重要。** */
let shownSrc = null;
for (const r of results) {
  if (r.src !== shownSrc) {
    console.log('--- 日志: ' + (r.src || '(未知)') + ' ---');
    shownSrc = r.src;
  }
  console.log('[' + r.id + '] ' + r.name.padEnd(26) + r.state.padEnd(12) + r.detail);
}
if (exPrints.length) {
  console.log('---- 豁免（逐条打印，SEAL 铁律：豁免必须逐条、必须写原因、必须打印）----');
  for (const p of exPrints) console.log(p);
}
console.log('----');
console.log('结论：' + tally.OK + ' OK / ' + tally.FAIL + ' FAIL / ' + tally.UNVERIFIED + ' UNVERIFIED');
const rc = tally.FAIL ? 1 : tally.UNVERIFIED ? 2 : 0;
console.log('RC=' + rc);
process.exit(rc);
