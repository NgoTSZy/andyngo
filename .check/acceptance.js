#!/usr/bin/env node
'use strict';
/* acceptance.js —— 约束模式 · 一条命令跑完全部验收。
 *
 * 为什么要有它：验收清单原来散在 `~/Desktop/约束模式_部署计划.txt` 第 11 节里，
 * 是**靠人逐条手敲**的 6 条。而「能枚举的检查，比依赖注意力的检查可靠」——
 * 人注意不了，所以清单必须变成一条命令。
 *
 * 为什么期望值读 `baseline.json` 而不是写在这里：
 * 期望值写死在**代码或提示词**里，就等于把一份快照当权威 ——
 * 我合法地加一条变异，它也会报 FAIL。而**会随机变红的测试比没有测试更坏**：
 * 它会训练人忽略红色，那等于把所有测试一起废掉。
 * 所以：数字变了报 **DRIFT**（要人明确说「这是我有意改的」），
 *      结构坏了才报 **FAIL**，跑不出来报 **UNVERIFIED**（第三态，不许塞进任何一边）。
 *
 * 四态，**不许合并**：
 *   OK          跑出来了，数字与基线一致
 *   DRIFT       跑出来了，结构正常，但数字变了 —— 要么更新基线，要么查回归
 *   FAIL        结构坏了（检查器报红 / 电池有抛错、锚点失配、假红变多、命中变少）
 *   UNVERIFIED  没跑出来（崩溃、输出为空、解析不出）—— **不是通过**
 *
 * 用法: node .check/acceptance.js
 * 退出码: 0 = 全 OK；1 = 有 FAIL；2 = 有 DRIFT 或 UNVERIFIED
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const HOME = path.resolve(__dirname, '..');
const NODE = process.execPath;
const BASE_PATH = path.join(__dirname, 'baseline.json');
/* 电池判定只此一份（battery-judge.js）。**不在本文件里留副本** ——
 * 两份判据会各自腐烂，而验收绿的是「两份一致」，不是「该判的都判了」。 */
const { judgeBattery } = require('./battery-judge.js');

/* 基线读不到时**不许抛栈**。抛栈的后果是「一行结论都没有」——
 * 而「没有」在账面上会被读成「没有失败」（同族：崩溃兜底必须打一行可解析的结果）。
 * 实测过这个漏洞：mv 走 baseline.json → `Error: ENOENT …` + 栈，EXIT=1，无结论行。
 *
 * 没有基线就无法判定任何一项，所以这里**直接快停**：报 UNVERIFIED，退出码 2。 */
let BASE = null;
let BASE_ERR = null;
try {
  BASE = JSON.parse(fs.readFileSync(BASE_PATH, 'utf8'));
} catch (e) {
  BASE_ERR = e.message || String(e);
}
if (BASE_ERR) {
  console.log('===== 约束模式 · 验收 =====');
  console.log('[ 0] ' + '基线 baseline.json'.padEnd(30) + 'UNVERIFIED'.padEnd(11) +
    '读不到 / 解析不了：' + BASE_ERR);
  console.log('       → 没有基线就无法判定任何一项 —— 这**不是通过，也不是失败**。');
  console.log('       → 期望值的唯一存放处是 ' + BASE_PATH + '，把它修回来再跑。');
  console.log('----');
  console.log('结论：0 OK / 0 FAIL / 0 DRIFT / 1 UNVERIFIED');
  process.exit(2);
}

function sh(args, cwd) {
  const r = spawnSync(NODE, args, { cwd: cwd || HOME, encoding: 'utf8', timeout: 900000 });
  return {
    status: r.status,
    out: ((r.stdout || '') + (r.stderr || '')).trim(),
    spawnErr: r.error ? r.error.message : null,
  };
}

/* 每条检查都返回 { id, title, state, detail, hint }。
 * **解析不出来一律 UNVERIFIED** —— 绝不默认成 0，也绝不默认成通过。
 * （「汇总口径对不上的时候必须报错，不许默认为 0。」） */
const rows = [];
function push(id, title, state, detail, hint) {
  rows.push({ id, title, state, detail: detail || '', hint: hint || '' });
}

// ---- [1] 主检查 ------------------------------------------------------------
{
  const r = sh(['.check/check-protocol.js']);
  const m = r.out.match(/检查项 (\d+)：PASS (\d+) \/ FAIL (\d+) \/ UNVERIFIED (\d+)/);
  if (!m) {
    push(1, '主检查 check-protocol.js', 'UNVERIFIED',
      '输出解析不出（退出码 ' + r.status + '）' + (r.spawnErr ? '，' + r.spawnErr : ''),
      '命令：node .check/check-protocol.js');
  } else {
    const got = { total: +m[1], pass: +m[2], fail: +m[3], unverified: +m[4] };
    const want = BASE.check;
    const bad = got.fail > 0 || got.unverified > 0;
    const same = got.total === want.total && got.fail === want.fail && got.unverified === want.unverified;
    push(1, '主检查 check-protocol.js', bad ? 'FAIL' : (same ? 'OK' : 'DRIFT'),
      'PASS ' + got.pass + ' / FAIL ' + got.fail + ' / UNVERIFIED ' + got.unverified +
      '（基线 FAIL ' + want.fail + ' / UNVERIFIED ' + want.unverified + '）',
      bad ? '看输出的 ✗ 行' : '');
  }
}

// ---- [2] 内置变异 ----------------------------------------------------------
{
  const r = sh(['.check/check-protocol.js', '--mutate']);
  const m = r.out.match(/变异 (\d+)\/(\d+) 命中/);
  if (!m) {
    push(2, '内置变异 --mutate', 'UNVERIFIED', '输出解析不出（退出码 ' + r.status + '）',
      '命令：node .check/check-protocol.js --mutate');
  } else {
    const hit = +m[1], total = +m[2];
    const want = BASE.mutate;
    const state = hit < want.hit ? 'FAIL' : (hit === want.hit && total === want.total ? 'OK' : 'DRIFT');
    push(2, '内置变异 --mutate', state, '命中 ' + hit + ' / 共 ' + total +
      '（基线 ' + want.hit + '/' + want.total + '）',
      hit < want.hit ? '命中数掉了 = 有变异不再被抓到' : '');
  }
}

// ---- [3..N] 外部电池 -------------------------------------------------------
const batteries = Object.keys(BASE.batteries);
let bi = 3;
for (const name of batteries) {
  const want = BASE.batteries[name];
  const args = want.runner === 'self'
    ? ['.check/' + name]
    : ['.check/run-battery.js', '.check/' + name];
  const r = sh(args);
  /* 【2026-09-15 加】把跑手的 `⚠` 警告**透出来**。
   * 实测：`run-battery.js` 收尾会 unlink 一个临时文件，删不掉时它**打了警告**，
   * 但这里只按正则抽汇总数字，警告被吞了 —— 而它的产物是 `.check/` 里一个
   * 2234 行、**已过期**的 MODE.md 副本。留一个会腐烂的副本，正是这套系统最怕的形状。
   * **不产生输出的失败，比不跑更危险**：抽数字的地方必须把警告一起带出来。 */
  const warn = (r.out.match(/^⚠[^\n]*/gm) || []);
  let got = null;
  if (want.runner === 'self') {
    const m = r.out.match(/变异 (\d+) 条，命中 (\d+)，逃逸 (\d+)/);
    if (m) {
      const miss = (r.out.match(/锚点未命中 (\d+)/) || [, '0'])[1];
      got = { total: +m[1], hit: +m[2], escape: +m[3], falsered: 0, crash: 0, miss: +miss };
    }
  } else {
    const m = r.out.match(/电池 (\d+) 条：命中 (\d+) \/ 逃逸 (\d+) \/ 假红 (\d+) \/ 抛错 (\d+) \/ 锚点失配 (\d+)/);
    if (m) got = { total: +m[1], hit: +m[2], escape: +m[3], falsered: +m[4], crash: +m[5], miss: +m[6] };
    /* 【2026-09-15 加】这里只做**跑手输出的解析**（形状随跑手走）；
     * 判定全部交给 judgeBattery() —— 判据只此一份，见 battery-judge.js。
     * 为什么失配要**报 ID 不只报个数**：见该文件头部与 baseline 的 missKnown_why。 */
    const dm = r.out.match(/锚点失配明细 (\S+)/);
    got.missIds = dm ? dm[1].split(',').filter(Boolean) : [];
  }
  /* 【2026-09-15 加】字段兜底 —— 修的是**形状**，不是这一条分支。
   * 实测踩到：missIds 只加在 run-battery 分支上，而 mutations-independent.js 走 self 分支
   * → 判定里读 got.missIds 当场 TypeError、验收整个崩（**一行结论都打不出来**）。
   * 这和上一轮「提成函数后忘在 require 里加 findHookTrace」是**同一个形状**：
   * **改动只落在一条路径上，另一条路径照旧用**。所以兜底放在分支之外，任何 runner 都安全。 */
  if (got) got.missIds = got.missIds || [];
  const cmd = 'node ' + args.join(' ');
  if (!got) {
    /* 关键：自备跑手在基线不干净时会 print 后 exit(2)、**一条变异都不跑**。
     * 那种输出解析不出上面任何一个数 —— 必须落进 UNVERIFIED，不许当通过。
     * 实测踩过：它只打「基线不干净，先停」，而汇总里看不见。 */
    push(bi++, '电池 ' + name, 'UNVERIFIED',
      '输出解析不出（退出码 ' + r.status + '）' + (r.spawnErr ? '，' + r.spawnErr : '') +
      '：' + r.out.split('\n').slice(-2).join(' / ').slice(0, 80),
      '命令：' + cmd);
  } else {
    /* 判定**不在这份文件里** —— 见 battery-judge.js（只此一份，且自带自测）。
     * 本文件只做三件事：解析跑手输出 → 交给判据 → 打印。
     * 分家的理由：判据里「新失配 → 红」这条分支**真实环境走不到**（现在没有新失配），
     * 而走不到的分支和不存在的分支在验收表上长得一样 —— 都是绿。 */
    const j = judgeBattery(got, want);
    push(bi++, '电池 ' + name, j.state,
      '命中 ' + got.hit + ' / 逃逸 ' + got.escape + ' / 假红 ' + got.falsered +
      ' / 抛错 ' + got.crash + ' / ' + j.missTxt + '（共 ' + got.total + ' 条）' +
      (warn.length ? ' · **' + warn[0].replace(/^⚠\s*/, '').slice(0, 70) + '**' : ''),
      j.hint || (warn.length ? '跑手报了警告（见明细）—— 数字可能仍然对，但**它的产物没清干净**，去查' : ''));
  }
}

// ---- 自测：host-log 的合成用例（覆盖 [99] 在真实环境里等不到的分支） --------
{
  const r = sh(['.check/selftest-host-log.js']);
  const m = r.out.match(/自测 (\d+) 条：命中 (\d+) \/ 失败 (\d+)/);
  if (!m) {
    push(bi++, '自测 selftest-host-log.js', 'UNVERIFIED',
      '输出解析不出（退出码 ' + r.status + '）' + (r.spawnErr ? '，' + r.spawnErr : ''),
      '命令：node .check/selftest-host-log.js');
  } else {
    const total = +m[1], hit = +m[2], bad = +m[3];
    const want = BASE.selftest;
    push(bi++, '自测 selftest-host-log.js',
      bad > 0 ? 'FAIL' : (total === want.total && hit === want.hit ? 'OK' : 'DRIFT'),
      '命中 ' + hit + ' / 失败 ' + bad + '（共 ' + total + ' 条；基线 ' + want.hit + '/' + want.total + '）',
      bad > 0 ? '合成用例失败 = [99] 的判定逻辑坏了（它在真实环境里的 OK 分支等不到）' : '');
  }
}

// ---- 自测：电池判定的合成用例（覆盖 [3..6] 在真实环境里等不到的分支） --------
{
  const r = sh(['.check/battery-judge.js']);
  const m = r.out.match(/判定自测 (\d+) 条：命中 (\d+) \/ 失败 (\d+)/);
  if (!m) {
    push(bi++, '自测 battery-judge.js', 'UNVERIFIED',
      '输出解析不出（退出码 ' + r.status + '）' + (r.spawnErr ? '，' + r.spawnErr : ''),
      '命令：node .check/battery-judge.js');
  } else {
    const total = +m[1], hit = +m[2], bad = +m[3];
    const guards = (r.out.match(/守门人 (\d+) 条/) || [, '0'])[1];
    const want = BASE.judge;
    /* 期望值**不猜**：baseline 里没有 judge 段就报 UNVERIFIED，
     * 而不是在代码里兜一个默认数（那会让「基线丢了」看起来像通过）。 */
    if (!want) {
      push(bi++, '自测 battery-judge.js', 'UNVERIFIED',
        '跑了 ' + total + ' 条，但 baseline.json 里没有 judge 段 —— **不猜期望值**',
        '在 baseline.json 加 "judge": { "total": ' + total + ', "hit": ' + hit + ' }');
    } else {
      push(bi++, '自测 battery-judge.js',
        bad > 0 ? 'FAIL' : (total === want.total && hit === want.hit ? 'OK' : 'DRIFT'),
        '命中 ' + hit + ' / 失败 ' + bad + '（共 ' + total + ' 条；守门人 ' + guards +
        ' 条必须报红；基线 ' + want.hit + '/' + want.total + '）',
        bad > 0 ? '电池判定逻辑坏了 —— [3..6] 里「名单外新失配 → 红」那条分支在真实环境等不到，这里坏了不会有人发现' : '');
    }
  }
}

// ---- 自测：C5「同一路径被引用 N 处」的计数（MUTATIONS 测不到输出文本） -------
{
  const r = sh(['.check/selftest-c5-count.js']);
  const m = r.out.match(/C5 计数自测 (\d+) 条：命中 (\d+) \/ 失败 (\d+)/);
  if (!m) {
    push(bi++, '自测 selftest-c5-count.js', 'UNVERIFIED',
      '输出解析不出（退出码 ' + r.status + '）' + (r.spawnErr ? '，' + r.spawnErr : ''),
      '命令：node .check/selftest-c5-count.js');
  } else {
    const total = +m[1], hit = +m[2], bad = +m[3];
    const want = BASE.c5count;
    if (!want) {
      push(bi++, '自测 selftest-c5-count.js', 'UNVERIFIED',
        '跑了 ' + total + ' 条，但 baseline.json 里没有 c5count 段 —— **不猜期望值**',
        '在 baseline.json 加 "c5count": { "total": ' + total + ', "hit": ' + hit + ' }');
    } else {
      push(bi++, '自测 selftest-c5-count.js',
        bad > 0 ? 'FAIL' : (total === want.total && hit === want.hit ? 'OK' : 'DRIFT'),
        '命中 ' + hit + ' / 失败 ' + bad + '（共 ' + total + ' 条；基线 ' + want.hit + '/' + want.total + '）',
        bad > 0 ? 'C5 不再报「同一路径被引用 N 处」—— 报告会退回「只说 1 条」，人会修完第一处就以为干净' : '');
    }
  }
}

/* ---- [10] hub 标价一致性 —— 【2026-09-17 整项移除】---------------------------
 * 原第 [10] 项跑 `skills/hub/price.js --check`（路由表标价 ↔ 实测值的一致性）。
 * 按用户裁决「本机只保留 /andyngo」，`skills/hub/` 已移出本机
 * （`.backup-strip-20260917-2232/skills/hub/`）⇒ 这一项**失去被测对象**。
 *
 * **为什么是「整项移除」而不是「改成 SKIP / UNVERIFIED」**：
 * 本文件自己的口径写着「**没跑成 ≠ 通过**」（三态退出码：0 通过 / 1 失败 / 2 拒跑）。
 * 留一个**永远 SKIP** 的项，会让验收**永久停在 rc=2** —— 而一条永远红的断言会被训练成忽略
 * （DEC-019 同族：总是响的警报等于没有警报）。⇒ **如实删掉**，能力下降在记录层登记。
 *
 * **代价（不假装没有）**：本机少一项验收（12 → 11 项），而它原本是**唯一**能发现
 * 「路由表标价腐烂」的东西（那正是 `hub` 存在的理由）。**发布件不受影响** ——
 * 发布副本只含 `skills/andyngo/`，本来就不带 `hub`。 */

/* 宿主日志的唯一读取实现（acceptance 与自测共用 —— 复制两份会静默分叉）。
 * **必须在使用它的 [98] / [99] 之前声明**：实测踩过 —— 放在后面 → TDZ ReferenceError。
 * 配对判定 `pairRunWithLedger` 与账本解析 `parseLedger` 都是**纯函数**，
 * 放在 host-log.js 里就是为了让合成自测能直接 require 它们，不必先跑一遍验收。 */
const { scanHostLogs, parseLedger, pairRunWithLedger,
        findSessionAcceptanceRuns, causalPair, combinePair,
        findHookTrace, crossCheckHookExit, judgeHookTrace, judgeHookRegistry } = require('./host-log.js');
const HOST = scanHostLogs();

/* 覆盖率的显示文本 —— [98] 与 [99] 共用**一份**（复制两份会静默分叉）。
 * 为什么要它：「未扫完」原来是一个**没有量纲的形容词**，人无法判断漏掉的是
 * 1 个小文件还是 1.7 GB。而「否定的强度不能超过证据的覆盖范围」这句话，
 * 前提正是**知道覆盖范围有多大**。 */
function coverageText(cov) {
  if (!cov) return '';
  /* 只列**最大的 3 个**未扫文件 —— 实测踩到：预算耗尽时，未扫清单里混进一堆 0–2 MB 的小文件，
   * 把「跳过 21 个」原样打出来会让人以为漏了 21 个大文件。**报告的形状要指向真正的风险。** */
  const top = (cov.skippedList || []).slice().sort((a, b) => b.mb - a.mb).slice(0, 3);
  return '（' + cov.scanned + '/' + cov.files + ' 个文件 · ' +
    Math.round(cov.scannedBytes / 1048576) + '/' + Math.round(cov.bytes / 1048576) + ' MB' +
    (cov.skipped ? ' · 未扫 ' + cov.skipped + ' 个' +
      (top.length ? '，最大的：' + top.map((s) => s.name.slice(0, 12) + ' ' + s.mb + 'MB').join('、') : '')
      : '') + '）';
}

/* 账本路径只在这里定义一次 —— 读（[98]）和写（收尾）必须同一个文件。
 * 定义两处就是「一个实体两个副本」，会静默分叉。 */
const LEDGER = path.join(__dirname, 'acceptance-ledger.txt');

// ---- [98] automation 到底跑过没有、有没有产出 --------------------------------
/* 判据同样在**宿主那一侧**：`daemon.log` 里
 * `[AutomationRecords] terminal run record written automationId=…, status=…`。
 *
 * 为什么需要这一项：2026-09-15 我实测过 —— 建一条一次性 automation（4 分钟后触发），
 * 宿主日志出现 `accepted=true, success=true, status=ACCEPTED`，且对话池里
 * `createdBy:"automation"` 的新会话被建出来。**机制是通的。**
 * 但在此之前，「automation 定义了 ≠ 会跑」在记录里挂了一整天，只是一句注记。
 * **注记会腐烂，检查项不会。**
 *
 * 【2026-09-15 第二版：光有运行记录只够回答「触发了」，不够回答「有产出」】
 * 「触发过」≠「有产出」是同一枚硬币的另一面（同「调用成功」≠「结果可用」）。
 * 宿主不存产出文本，所以判据由**程序**生产：`acceptance.js` 每次跑完自己往
 * `.check/acceptance-ledger.txt` 追加一行，automation 执行那条命令就是它的副作用。
 * 判定逻辑是纯函数 `pairRunWithLedger`（在 `.check/host-log.js`），
 * **它的 OK / FAIL 两个分支在真实环境里等不到**，由 `.check/selftest-host-log.js`
 * 的合成 fixture 覆盖 —— 合成用例只证明判定逻辑对，不证明真实环境如何。
 *
 * 状态枚举我没查全，所以**认不出的一律报 DRIFT，不报 OK** ——
 * 「无法确证的样本一律按未确证处理，不猜成真的」。 */
{
  const want = BASE.automation;
  const anyN = HOST.autoRuns.length;
  const mine = HOST.autoRuns.filter((r) => r.id === want.id);
  /* 【2026-09-16 · ISS-046】**「正在跑」必须可见。**
   * 在这之前 `[98]` 只数**终态**记录，于是「本轮 IN_PROGRESS」和「从未触发」
   * 打印出来一模一样（都是 0 次 + 「未到点」），而 SEAL 正文据此写过
   * 「宿主日志窗口内**没有**本 automation 的运行记录」—— **它有**，只是还没结束。
   * **正确的说法是「没有终态记录」，不是「没有运行记录」。**
   * `autoStarts` 只用于**展示**，不参与判定（判定只该看终态：把起点混进配对逻辑
   * 会让「跑了一半」被当成「跑完了」）。 */
  const myStarts = (HOST.autoStarts || []).filter((r) => r.id === want.id);

  let lines = [];
  try { lines = parseLedger(fs.readFileSync(LEDGER, 'utf8')); }
  catch (e) { /* 首次运行没有账本 —— 下面按 0 行报 */ }

  const tail = lines.length ? lines[lines.length - 1] : null;
  const ledTxt = '账本 ' + lines.length + ' 行' +
    (tail ? '（最近 ' + new Date(tail.t).toISOString() + ' exit=' + tail.exit +
      ' ok=' + tail.ok + '）' : '');
  /* `anyN` 打出来只为**有数可看**，不参与判定 —— 它是**日志窗口内**的计数，
   * 而日志按 10 MiB 滚动，这个数有硬上限。拿它当门就是「拿计数增长当断言」
   * 那个坑：日志一滚，闸门自己就误报「机制未验证」。 */
  const txt = '日志窗口内共 ' + anyN + ' 条 automation 运行记录（**不是留存总量**，日志按 10 MiB 滚动）· ' +
    '本条日报（' + want.id.slice(0, 8) + '…）：start ' + myStarts.length + ' 条 / 终态 ' +
    mine.length + ' 条' + (myStarts.length > mine.length ? '（**差 ' + (myStarts.length - mine.length) +
      ' = 正在跑**，不是「未到点」）' : '') + ' · ' + ledTxt +
    ' · 扫描覆盖 ' + coverageText(HOST.coverage);

  if (!HOST.ok) {
    push(98, 'automation 上次运行有产出吗', 'UNVERIFIED', '宿主日志读不到：' + HOST.why,
      '读不到宿主日志就没法判定 —— **不是通过，也不是失败**');
  } else {
    /* 判定整个交给纯函数 —— 它的 OK / FAIL 两个分支真实环境里等不到，
     * 由 `.check/selftest-host-log.js` 的合成 fixture 覆盖（第 11–17、19–21 条）。
     * `scanComplete` 必须传：扫不完时「没有运行记录」推不出「没跑」。 */
    const p = pairRunWithLedger(HOST.autoRuns, lines, want.id,
      { scanComplete: HOST.complete, starts: HOST.autoStarts });

    /* **因果链**（2026-09-15 加）：时间窗口只能证明「那一刻有人跑过」，
     * 证明不了「是这一轮 automation 跑的」。宿主把 `sessionId` 写进了运行记录，
     * 那一轮的会话日志里记着它执行过的命令 —— 拿这个把「同时发生」升级成「就是它」。
     * 读不到会话日志时**退回**时间窗口配对，并在明细里写明「因果未确认」。
     * 合成展示层在 `combinePair`（纯函数，自测覆盖）—— 这一段只有等日报真的跑过
     * 一次才会被执行到，**没跑过的代码崩起来是一行结论都没有**。 */
    let q = null;
    if (p.run) {
      const cmds = findSessionAcceptanceRuns(path.join(HOME, 'logs'), HOST.day,
        p.run.sessionId, p.run.t);
      q = causalPair(p.run, cmds, lines);
    }
    const cb = combinePair(p, q);
    push(98, 'automation 上次运行有产出吗', cb.state, txt + cb.pairTxt + cb.causalTxt, cb.why);
  }
}

// ---- 最后一个：hook 到底有没有被宿主调用 -----------------------------------
/* 【2026-09-15 第四版 · 第三版的判据方向对，但**认错了形状**，把 129 次读成 0 次】
 *
 * 第三版读宿主日志 `[HookExecutor] spawn` 行里有没有 `.check/`。两个毛病，都在**否定方向**上：
 *   ① **分隔符写死**：Windows spawn 出来的命令是 `.check\immunity-hook.js`（反斜杠），
 *      正则只认 `.check/`（正斜杠）→ **129 次全部漏掉**，报成「宿主从未 spawn 过它」。
 *      **漏判比误判贵**：误判报红会被查，漏判报「没有」会被**信** ——
 *      而那句「hook 不生效」已经被写进 SOUL / MEMORY / VERIFY 三处当结论用。
 *   ② **自述落点写死**：读 `.check/hook.log`，可 `immunity-hook.js` **根本不写这个文件**
 *      （它只写脚本里 TRACE 指向的 host-hook-spawns.log）→ 永远 0 行 → 永远「没发生」。
 *      形状与 `src=host` 那次一样：**拿「读不到」当「没发生」**。
 *
 * 第四版：判据改成**分隔符无关**的 `/\.check[\\/]/`；自述落点走**指针链**
 *   settings.json → hook 命令里指向 `.check/` 的 .js → 脚本里的 `TRACE = '…'`
 * （硬规则二十七：权威放「会自己失效」的地方，路径不写死）。
 *
 * **自述是佐证，不是判据**（硬规则二十八）：TRACE 也是 hook 自己写的，能被伪造。
 * 它能**加强**结论（spawn 了 ≠ 跑成了，得看有没有产出、rc 是多少），
 * 不能**单独支撑**结论 —— 所以「两侧打架」一律信宿主。
 *
 * 第二版的两个毛病仍然成立，一并留着：`src=host` 可被伪造（我亲手造过 4 行），
 * hook 自己写的任何东西都不是判据。 */
/* 实现搬到 `.check/host-log.js` —— 唯一一份（acceptance 与自测共用，复制会静默分叉）。
 * 自测在 `.check/selftest-host-log.js`：用**合成 fixture** 覆盖 [99] 的 OK / FAIL 两个分支，
 * 因为真实环境里「宿主真的调了一次」这一支等不到。
 *
 * **一次扫描，两个计数**：[98] automation 跑没跑、[99] hook 被没被调用，都从同一份
 * 宿主日志里读。宿主日志几十 MB，扫两遍等于把验收时间翻倍。
 * **声明必须在使用它的代码之前** —— 实测踩过：放到 [98] 后面 → TDZ ReferenceError。 */

{
  const host = HOST;
  const tr = findHookTrace(HOME);
  /* 【ISS-114 ① · 2026-09-17】hook **登记表**（门禁的名单）。
   * 读不到就传 null —— `judgeHookRegistry` 会判 **UNVERIFIED**（没测），
   * 而不是「通过」。文件在 `.check/record/hook-registry.md`。 */
  let hookRegText = null;
  try {
    hookRegText = fs.readFileSync(path.join(HOME, '.check', 'record', 'hook-registry.md'), 'utf8');
  } catch (e) { hookRegText = null; }

  /* 【2026-09-15 加】宿主侧的**退出码** —— 它一直在日志里（`spawn` 的下一行），
   * 是我的正则只匹配了 spawn 行、没看下一行。见 `host-log.js` 的 `RE_HOOKEXIT`。 */
  const exitTxt = host.hookExits
    ? '、异常退出 ' + host.hookExits + ' 次（code: ' +
      Object.keys(host.hookExitCodes).sort((a, b) => +a - +b)
        .map((k) => k + '×' + host.hookExitCodes[k]).join(' ') +
      '；宿主定性 `non-blocking` ' + host.nonBlocking + ' 次）'
    : '、无异常退出记录';
  /* 【2026-09-15 加】覆盖率 —— 「未扫完」必须**有量纲**。
   * 「否定的强度不能超过证据的覆盖范围」这句话，前提是**知道覆盖范围有多大**；
   * 原来只说「未扫完」，人无法判断漏掉的是 1 个小文件还是 1.7 GB。 */
  const covTxt = coverageText(host.coverage);
  /* 【2026-09-17 加 · ISS-114】**按 hook 分组**（纯报告，**不判红** —— 理由见 `host-log.js`
   * 扫描循环里那段注释：判红需要一份「应当被 spawn 的名单」，而 DEC-041 已裁决
   * `hook-session-start.js` **不再要求被加载** → 名单要能表达「已知未加载 + 理由」，
   * 那是**改门禁语义（乙类）**，不擅自动；且判红会引入**新的假红面**）。
   * **为什么要有它**：`mine` 只是「含 `.check/` 的总数」—— 任何一个 hook 在跑它就 > 0，
   * 于是「某一个登记在册的 hook 静默失效」**看不见**。分组之后一眼可辨。
   * **只在真的取到分组时才拼**，避免给旧调用方 / 合成 fixture 凭空多出一段。 */
  const hookKeys = host.byHook ? Object.keys(host.byHook) : [];
  const hookTxt = hookKeys.length
    ? '、按 hook 分组 {' + hookKeys.sort((a, b) => host.byHook[b] - host.byHook[a])
        .slice(0, 6).map((k) => k + ' ' + host.byHook[k]).join(' · ') +
      (hookKeys.length > 6 ? ' · …共 ' + hookKeys.length + ' 个' : '') + '}' +
      (host.noHookName ? '、另有 ' + host.noHookName + ' 次取不到脚本名' : '')
    : '';
  const hostTxt = '宿主侧：' + (host.day || '?') +
    /* 【2026-09-17 加 · ISS-116】窗口里**没有宿主 `.log` 文件**时必须说出来 ——
     * 否则「扫了 16 个日志」听起来像扫过了宿主日志，其实那 16 个全是会话记录。 */
    (host.dayHasHostLogs === false ? '（**该日目录没有宿主 `.log` 文件**）' : '') +
    ' 扫 ' + host.files + ' 个日志' +
    (host.complete ? '' : '（**未扫完**）') + covTxt + '、[HookExecutor] spawn ' + host.spawnTotal +
    ' 次、其中指向 `.check/` 的 **' + host.mine + ' 次**' + exitTxt + hookTxt;

  const vkeys = Object.keys(tr.verdicts || {}).sort();
  const vTxt = vkeys.length ? vkeys.map((k) => k + '×' + tr.verdicts[k]).join(' ') : '—';
  const lastTs = tr.last ? (/\bts=(\S+)/.exec(tr.last) || [null, '?'])[1] : null;
  /* **spawn 了 ≠ 跑成了**：行数会骗人（跑了 140 次、每次都失败，行数也是 140）。
   * 所以自述这一侧报三件事：行数、verdict 分布、rc≠0 次数。 */
  const selfTxt = tr.path
    ? '自述产出 ' + tr.n + ' 行（verdict: ' + vTxt + '；rc≠0 ' + tr.rcNonZero + ' 次' +
      (lastTs ? '；末行 ts=' + lastTs : '') + '）'
    : '自述产出读不到：' + (tr.why || '未知');

  if (!host.ok) {
    push(99, 'hook 被宿主调用', 'UNVERIFIED',
      selfTxt + ' · 宿主侧读不到：' + host.why,
      '读不到宿主日志就没法判定 —— **不是通过，也不是失败**');
  } else if (host.mine > 0 && tr.n > 0) {
    /* **交叉核对 + 漏检判定**，两件事都在 `judgeHookTrace` 里（纯函数、自带自测）。
     * 顺序：先判「有没有调用没被检查」（漏检），再判「宿主命中数 ↔ 自述命中数」（账目）。
     * 宿主侧**不经过 hook**（它自己观测子进程退出码），所以账目那一半是真正的独立判据；
     * 打架时按硬规则二十八**信宿主**。 */
    /* 【2026-09-17 加 · ISS-116】**窗口新鲜度前置** —— 两个计数只有在**同一个时间窗口**里才可比。
     * 若扫描窗口里最新的日志**早于** hook 自述的末行 ts，说明自述有内容落在窗口之外 →
     * 这时比「宿主命中数 ↔ 自述行数」是拿两个不同时段的数作比 → **没测**（第三态），
     * 不是 OK 也不是 FAIL。
     *
     * **为什么必须有这一条**（不能只修「扫错目录」）：只把窗口改对，就换来另一个方向的洞 ——
     * 若宿主**真的停了**（不再写日志），窗口会退到很久以前那一天，而那里的旧 spawn 行仍在
     * → `mine > 0` → 判 OK = **假绿**。**假绿比假红坏**（本仓库存在的理由就是这个）。
     * 这一条把「窗口陈旧」显式变成「没测」—— 两个方向都不说谎。
     *
     * **只在两侧都取到值时才判**：`host.newestMtime` 缺（合成 fixture 不提供）或 `lastTs`
     * 解析不出 → **跳过本前置**，行为与加它之前**逐字一致**（不动已有自测）。 */
    const lts = lastTs ? Date.parse(lastTs) : NaN;
    if (host.newestMtime && Number.isFinite(lts) && host.newestMtime < lts) {
      push(99, 'hook 被宿主调用', 'UNVERIFIED', hostTxt + ' · ' + selfTxt,
        '扫描窗口的最新日志（' + new Date(host.newestMtime).toISOString() + '）**早于**自述末行（' +
        lastTs + '）→ 自述有内容落在窗口之外，两个计数**不可比** → 这一项**没测**' +
        '（不是通过，也不是失败）');
    } else {
      const j = judgeHookTrace(host, tr);
      /* 【ISS-114 ① · 2026-09-17】**门禁**：登记为「必须」的 hook 一次都没被 spawn → FAIL。
       * 与 `judgeHookTrace` **并列**（不是替换）—— 两者判同一件事的两面：
       * 前者判「有产出、账目对得上」，后者判「**该跑的 hook 都跑了**」。
       * 取**更坏**的那一态（FAIL > UNVERIFIED > OK）。 */
      const reg = judgeHookRegistry(host.byHook, hookRegText);
      const st = j.state === 'FAIL' || reg.state === 'FAIL' ? 'FAIL'
        : j.state === 'UNVERIFIED' || reg.state === 'UNVERIFIED' ? 'UNVERIFIED' : 'OK';
      push(99, 'hook 被宿主调用', st, hostTxt + ' · ' + selfTxt,
        [j.why, reg.why].filter(Boolean).join(' · ') || (tr.rcNonZero > 0
          ? 'rc≠0 ' + tr.rcNonZero + ' 次 = 命中或扫描错误（不是假绿，是它真的报了）—— 明细看 TRACE'
          : ''));
    }
  } else if (host.mine > 0 && tr.n === 0) {
    push(99, 'hook 被宿主调用', 'FAIL', hostTxt + ' · ' + selfTxt,
      '**spawn 了但没产出** = 钩子跑到写留痕之前就断了（payload 没递到 / 中途崩了）' +
      ' —— 「调了」不等于「生效」');
  } else if (host.mine === 0 && tr.n > 0) {
    /* **两侧打架。** 信宿主 —— 自述能被伪造（2026-09-15 我自己造过 4 行 `src=host`）。 */
    push(99, 'hook 被宿主调用', 'FAIL', hostTxt + ' · ' + selfTxt,
      '自述有 ' + tr.n + ' 行，宿主日志里 0 次 → 自述不可信（或落点被伪造）。信宿主');
  } else {
    /* **扫不完就不许下否定结论。** 「0 次」在扫描不完整时推不出「从未调用」——
     * 命中可能就在没读到的那几个文件里。这是「没测」第三态，不是「没有」。
     * 与 [98] 同一条规矩：**否定的强度不能超过证据的覆盖范围。** */
    push(99, 'hook 被宿主调用', 'UNVERIFIED', hostTxt + ' · ' + selfTxt,
      host.complete
        ? '两侧都是 0，且扫描完整 → hook **没生效**，依赖 hook 的规则目前只是提示词。' +
          '（官方文档 cli/hooks.md：「所有外部修改需在 `/hooks` 面板审核后生效」—— 这一步只能由人做）'
        : '扫描**未完成**（撞预算），所以「0 次」**推不出「从未调用」** —— ' +
          '命中可能就在没读到的文件里。这一项**没测**，不是通过也不是失败');
  }
}

// ---- 打印 ------------------------------------------------------------------
const MARK = { OK: 'OK', FAIL: 'FAIL', DRIFT: 'DRIFT', UNVERIFIED: 'UNVERIFIED' };
console.log('===== 约束模式 · 验收 =====');
for (const r of rows) {
  console.log('[' + String(r.id).padStart(2) + '] ' + r.title.padEnd(30) + MARK[r.state].padEnd(11) + r.detail);
  if (r.hint && r.state !== 'OK') console.log('       → ' + r.hint);
}

/* 参考量（**不比对**）—— 行数每次改动都会变，拿它当判据就是随机变红。
 * 打出来只为「每次会话真正付的读取量」有个数。 */
try {
  /* 行数口径必须与 `wc -l` 一致（数换行符），否则两个数对不上，
   * 而「同一个文件、两种量法、两个数」本身就是这个项目里踩过的坑。 */
  const rd = (f) => (fs.readFileSync(path.join(HOME, f), 'utf8').match(/\n/g) || []).length;
  const inj = rd('MEMORY.md') + rd('SOUL.md') + rd('IDENTITY.md') + rd('USER.md');
  const refs = fs.readdirSync(path.join(HOME, 'refs')).filter((x) => x.endsWith('.md')).length;
  console.log('参考（不比对）：常驻注入 ' + inj + ' 行 · refs/ ' + refs + ' 个 · MODE.md ' +
    rd('MODE.md') + ' 行 · check-protocol.js ' + rd('.check/check-protocol.js') + ' 行');
} catch (e) { console.log('参考（不比对）：读不到 —— ' + e.message); }

const c = (s) => rows.filter((r) => r.state === s).length;
console.log('----');
console.log('结论：' + c('OK') + ' OK / ' + c('FAIL') + ' FAIL / ' + c('DRIFT') + ' DRIFT / ' +
  c('UNVERIFIED') + ' UNVERIFIED');
const EXIT = c('FAIL') ? 1 : (c('DRIFT') || c('UNVERIFIED') ? 2 : 0);

/* ---- 账本：这次运行的结果由**程序自己**记一行 -------------------------------
 * 它是 [98]「有没有产出」那一半的判据。为什么必须是程序写、不能是 automation 写：
 * automation 的产出是一条它自己写的对话消息，「它说它跑了」不构成证据
 * —— 与 `.check/hook.log` 里那个 `src=host` 同一个形状（我自己伪造过 4 行）。
 * 账本行是 `node .check/acceptance.js` 真的跑到收尾才会有的副作用，说不出来。
 *
 * **残留风险写下来，不藏**：我手动跑一次 acceptance 也会写一行，若恰好落在
 * automation 的运行窗口内，[98] 会配出一条假 OK。[98] 的明细里把两个时间戳都打出来，
 * 所以配对是**可复核的**，不是隐藏假设。账本把「静默无产出」变成「必须主动写假账」——
 * 不是不可伪造，是把成本从 0 提到了「必须动手」。
 *
 * 崩溃时**不写**（写在收尾）—— 于是崩溃在 [98] 里表现为「触发了但没产出」，这是对的。
 * 上限 200 行、从**头部**裁：裁掉的永远是旧的，而 [98] 配的是最近一次运行，
 * 所以裁剪不会让它随机变红（这条是流水表那 200 条上限踩出来的）。 */
try {
  let lines = [];
  try { lines = fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean); }
  catch (e) { /* 首次运行没有账本，正常 */ }
  lines.push(new Date().toISOString() + ' exit=' + EXIT +
    ' ok=' + c('OK') + ' fail=' + c('FAIL') +
    ' drift=' + c('DRIFT') + ' unver=' + c('UNVERIFIED'));
  if (lines.length > 200) lines = lines.slice(lines.length - 200);
  fs.writeFileSync(LEDGER, lines.join('\n') + '\n');
} catch (e) {
  /* 账本写不进去不许影响结论与退出码 —— 但它也不是「没发生」，
   * 打出来，否则 [98] 会永远看不到产出而没人知道原因。 */
  console.log('账本写入失败（不影响结论）：' + e.message);
}

process.exit(EXIT);
