#!/usr/bin/env node
'use strict';
/* run-battery.js —— 跑一个**外部**变异电池（别人写的，或另一个文件里的）。
 *
 * 为什么要有它：内置的 `--mutate` 只认 check-protocol.js 里的 MUTATIONS 数组。
 * 别人写的电池（第三方测试者、历史存档）没有跑手 —— 上一轮那个测试者只能自己写
 * 9.4KB 的抽取胶水，而那层胶水出 bug 会被归因到**检查器**头上。
 *
 * 四态分开报，**不许合并**：
 *   命中   变异被抓到
 *   逃逸   该报红没报红
 *   假红   合法改动被报成缺陷（优先级最高：假红会训练人忽略红色）
 *   抛错   检查器自己崩了（比逃逸更严重）
 * 另加「锚点失配」：edit 没改动文本 = 这条变异**根本没跑**，与"逃逸"完全不是一回事。
 *
 * ⚠ 用 `--file` 跑时 C8 永远是 UNVERIFIED（核对命令读的是磁盘上的真 MODE.md）——
 *   所以**只期望 C8 报红**的变异在这里必然记成"逃逸"，那是入口的限制，不是检查器的结论。
 *   反向断言 `!C8` 在这里也**必然成立**，等于没测 —— 两种情况都打出来。
 *
 * 用法: node .check/run-battery.js <battery.js>   （电池模块须导出 {id,name,expect,edit} 数组）
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const HOME = path.resolve(__dirname, '..');
const MODE = path.join(HOME, 'MODE.md');
const CHECK = path.join(__dirname, 'check-protocol.js');
/* 【2026-09-15 期 1】原来只读 MODE.md —— 附录拆到 refs/ 之后，
 * 锚在附录正文上的变异全部「锚点没匹配上」= **根本没跑**。
 * 实测：三套电池一次跑出 36 条锚点失配（14 + 14 + 8），
 * 而汇总行只显示命中数下降 —— 看起来像检查器退步，其实是**变异没跑**。
 * 「不产生输出的失败，比不跑更危险。」文件集的定义在 fileset.js，只此一份。 */
const { buildFileSet } = require('./fileset.js');

const arg = process.argv[2];
if (!arg) { console.error('用法: node .check/run-battery.js <battery.js>'); process.exit(2); }
const M = require(path.resolve(arg));
if (!Array.isArray(M)) { console.error('FAIL 电池没有导出数组'); process.exit(2); }

/* ★ `--base <file>`（2026-09-17 加，ISS-122）—— **只为测试**。
 * 为什么必须有它：ISS-122 的修法是「相对基底判」，而它的现场是**基底自带一处红**
 *   （`~/Desktop/reply-to-B.cmd` 被删 → C5 基底红）。要**端到端**验证这个修法，
 *   就得能喂一个「基底本来就红」的文本 —— 而正常路径一律走 `buildFileSet()`（磁盘真文件），
 *   不可能为了测试去改真文件。
 * **行为不变**：不传 `--base` 时逐字走原来那一行。 */
const baseArgIdx = process.argv.indexOf('--base');
const base = baseArgIdx > 0 ? fs.readFileSync(process.argv[baseArgIdx + 1], 'utf8') : buildFileSet().text;
/* 【2026-09-17 加】临时文件名**必须带 pid**。原来写死 `.check/_battery-tmp.md`：
 * 两套电池**并行**跑时互相覆盖同一个文件，读到的红/绿是**对方那条变异**的 ——
 * 实测（W23 J18，同一套 `mutations-fourth.js`）：
 *   并行 `node run-battery.js fourth & node run-battery.js fourth2` → 命中 18 / 逃逸 6 / 假红 3
 *   串行                                                          → 命中 21 / 逃逸 3 / 假红 3
 * **计数错了却不报错**，正是本文件头部最贵的一类缺陷（会把人送去查检查器）。
 * 判据：并行跑任意两套电池，每套的读数必须与它单独跑时逐字相同。 */
const tmp = path.join(__dirname, '_battery-tmp.' + process.pid + '.md');
/* `na` = **不适用**（ISS-122 加的第四态）：期望码在基底上本来就红 ⇒ 这条变异这次测不了。
 * 它**不计入** hit/esc/fr，也**不进**退出码（`process.exit` 只看 esc+fr+crash+miss）——
 * 因为它既不是「测到了」也不是「没测到」，而是「这一轮**没法测**」。 */
let hit = 0, esc = 0, fr = 0, crash = 0, miss = 0, na = 0;
const out = [];

/* 【2026-09-17 收尾加】清理**上一个进程留下的**临时文件（pid 已死的）。
 * 为什么：本文件原来的临时文件名是**写死**的（`.check/_battery-tmp.md`）——
 * 删不掉也**只会残留一个、下次覆盖**，所以「删不掉」从来没有后果。
 * 为修 ISS-121（并行覆盖）改成 `<pid>` 命名之后，`unlinkSync` 在 Windows 上偶发 EBUSY
 * → **每次残留一个、开始堆积**（实测 6 个 × ~152 KB，且载体报告里每套电池多一句「删不掉」）。
 * 这是**「修好一个方向、引入另一个方向的退步」**的实例：CHG-235 的验证只比了
 * 「并行读数 == 串行读数」，**没有看 `.check/` 下的文件数**。
 * 判据用 **pid 是否存活**（`process.kill(pid, 0)`），**不用时间阈值** ——
 * 存活进程的临时文件**必须不碰**（它可能正被另一套电池使用，那是 ISS-121 的现场）。
 * pid 复用会让「已死」误判成「存活」→ **不清理**（方向保守，正确）。 */
for (const f of fs.readdirSync(__dirname)) {
  const mm = /^_battery-tmp\.(\d+)\.md$/.exec(f);
  if (!mm) continue;
  let alive = true;
  try { process.kill(Number(mm[1]), 0); } catch (e) { alive = false; }
  if (!alive) {
    try { fs.rmSync(path.join(__dirname, f), { force: true }); } catch (e) { /* 留到下次 */ }
  }
}

/* 【2026-09-17 加】把**基底自己的报红集合**打出来。
 * 为什么：负向探针（期望 `!Cx`）判的是「整份文档有没有 Cx 红」，**不是**「我这一处改动会不会被误报」；
 * 正向变异判的是「Cx 在不在红名单里」，**也不问 Cx 是不是它弄红的**。
 * 于是基底自带一处 Cx 红时：所有 `!Cx` 探针**集体变假红**、所有期望 Cx 的变异**集体变"命中"** ——
 * 报出来的四态**不是变异的效果，是基底的**。
 * 实测现场（W23 J18）：`~/Desktop/reply-to-B.cmd` 被删 → C5 基底红 →
 *   [4] 假红 1→3 · [5] 假红 0→3 · [6] 命中 29→32，而**三套电池的变异一行没改**。
 * 不把基底读数摆在同一份输出里，读的人只能看到「假红变多 / 命中变少」，会去查检查器 ——
 * 这一轮就是这么误查的。
 *
 * ★ 【2026-09-17 改 · **ISS-122 根治**】`baseRed` **从块里提到外层**，**参与判定**。
 *   原来它只打印、不参与（那是 ISS-122 的「最小缓解」）。现在它是**参照系**：
 *   期望码在基底上本来就红 ⇒ 那条变异**不适用**（判定体见 `judgeOne`）。
 *   于是「基底自带一处红」时**读数不再位移** —— 这正是 ISS-122 的现场
 *   （`~/Desktop/reply-to-B.cmd` 被删 → C5 基底红 → 三套电池集体漂：假红 1→3 / 0→3 · 命中 29→32）。
 *   **为什么不改汇总行格式**：`acceptance.js` 的正则以 `锚点失配 (\d+)` **结尾且无 `$`**，
 *   所以在末尾**追加**「· 不适用 N」不影响解析；而正常情况（基底全绿）`na = 0`
 *   → 那一项**根本不打印** → 三套数字**逐字不变** → `baseline.json` 不用动。
 *   这就是「改契约」被压成「改一个文件」的原因。 */
let baseRed = [];
{
  fs.writeFileSync(tmp, base);
  const br = spawnSync(process.execPath, [CHECK, '--file', tmp], { encoding: 'utf8' });
  baseRed = [...String(br.stdout || '').matchAll(/^FAIL\s+(C\d)/gm)].map((x) => x[1]);
  if (baseRed.length) {
    out.push('  BASE-RED 基底（未变异）**本来就报红**[' + baseRed.join(',') + '] —— ' +
      '期望 `!' + baseRed.join('` / `!') + '` 的探针这次**不适用**（红的是基底，不是变异）；' +
      '期望 ' + baseRed.join('/') + ' 的变异这次"命中"也**不算它的功劳**。先去看 [1] 主检查。');
  }
}
const baseRedSet = new Set(baseRed);

/* ★ 判定体**抽到独立文件** `.check/battery-relative.js`（**一份口径两处用**）。
 * 为什么不是就写在这里：本文件是**纯脚本** —— `require` 它会把**整套电池跑一遍**，
 * 所以尺子**没法单独 require 它的函数**。而「判定抽出来给尺子喂样本」是本仓库已立的模式
 * （`battery-judge.js` 的先例：「把判定抽出来，由自测喂样本把走不到的分支当场打红一次」）。
 * 抽成独立文件后：跑手与尺子**引用同一份实现**，不会像「复制一份」那样**静默分叉**
 * （同 `newid.js` 的 `flattenBody` —— ISS-125 的修法）。 */
const { judgeOne } = require('./battery-relative.js');
/* 【2026-09-15 加】失配要**报 ID，不只报个数**。
 * 为什么：锚点失配 = 那条变异根本没跑。只给个数时，验收只能一刀切「miss>0 就 FAIL」，
 * 于是「文档改对了、引用跟着改名」这种**正确改动**会让一条快照电池**永远红灯** ——
 * 而本文件自己写着「永远红的断言会训练人忽略红色」。
 * 给 ID 之后：已登记的失配照常显示但不判红，**新出现的失配**照旧红。 */
const missIds = [];

for (const m of M) {
  const id = m.id || ('#' + (out.length + 1));
  let t;
  try { t = m.edit(base); } catch (e) { crash++; out.push('  THROW-EDIT ' + id + '  edit 自己抛错：' + e.message); continue; }
  if (t === base) { miss++; missIds.push(id); out.push('  MISS ' + id + '  锚点没匹配上（这条变异**没跑**）：' + m.name); continue; }
  fs.writeFileSync(tmp, t);
  const r = spawnSync(process.execPath, [CHECK, '--file', tmp], { encoding: 'utf8' });
  const o = r.stdout || '';
  if (/检查器自身抛错/.test(o)) {
    crash++;
    out.push('  THROW ' + id + '  检查器抛错：' + (o.match(/检查器自身抛错[^\n]*/) || [''])[0] + '  ' + m.name);
    continue;
  }
  const red = [...o.matchAll(/^FAIL\s+(C\d)/gm)].map((x) => x[1]);
  const unv = [...o.matchAll(/^UNVERIFIED\s+(C\d)/gm)].map((x) => x[1]);
  const j = judgeOne(red, unv, m.expect, baseRedSet);
  if (j.state === 'na') {
    /* ★ 相对基底（ISS-122）：**单列一态、不计入三态**。**必须打印** ——
     *   不打印就成了「静默吞掉」，而本文件自己写着「不产生输出的失败，比不跑更危险」。 */
    na++;
    out.push('  NA ' + id + ' 期望' + m.expect + ' —— **不适用**（' + j.want +
      ' 在基底上本来就红：红的是**基底**，不是变异）  ' + m.name);
  } else if (j.state === 'hit') {
    hit++;
    if (j.unvHit) out.push('  ~ ' + id + '  反向断言成立，但 ' + j.want + ' 是 UNVERIFIED（**等于没测**，不是"确认没问题"）');
  } else if (j.state === 'falsered') {
    fr++;
    out.push('  FALSERED ' + id + ' 期望' + m.expect + ' 实际报红[' + (red.join(',') || '无') + ']  ' + m.name);
  } else {
    esc++;
    out.push('  ESC ' + id + ' 期望' + m.expect + ' 实际报红[' + (red.join(',') || '无') + '] UNVERIFIED[' +
      (unv.join(',') || '无') + ']  ' + m.name);
  }
}

/* 【2026-09-17 收尾改】`unlinkSync` → `rmSync` + `maxRetries`。
 * Windows 上子进程句柄偶发未及时释放 → `unlinkSync` 抛 EBUSY；
 * `rmSync` 的 `maxRetries` / `retryDelay` **正是为 EPERM / EBUSY / ENOTEMPTY 设计的重试**。
 * 上面那段「清理 pid 已死的残留」是**兜底**：万一重试也失败，文件不会永久堆积。 */
try {
  fs.rmSync(tmp, { force: true, maxRetries: 5, retryDelay: 100 });
} catch (e) {
  console.log('⚠ 临时文件删不掉：' + tmp + ' —— 这一项是 **UNVERIFIED**，不是通过（沙箱可能拦了删除）');
}

console.log(out.join('\n'));
console.log('----');
/* ★ 「不适用」**只在 `na > 0` 时**才追加 —— 正常情况（基底全绿）那一项**根本不出现**，
 *   所以三套数字与 `baseline.json` **逐字不变**（这就是本修法不必改契约的原因）。
 *   追加位置在**末尾**：`acceptance.js` 的正则以 `锚点失配 (\d+)` 结尾且**无 `$`** → 不受影响。
 * ★ 这一行**漏做过一次**（2026-09-17）：`NA` 明细行打了、汇总行没打 ——
 *   而**两层可见性必须分别验证**才能抓到（只看明细行会以为「已经可见了」）。
 *   抓到它的是端到端验证：喂基底红的文本 → 明细有 `NA`、汇总行却没有「不适用 N」。 */
console.log('电池 ' + M.length + ' 条：命中 ' + hit + ' / 逃逸 ' + esc + ' / 假红 ' + fr +
  ' / 抛错 ' + crash + ' / 锚点失配 ' + miss + (na ? ' · **不适用 ' + na + '**（期望码在基底上本来就红）' : ''));
/* 机器可读的失配 ID 清单（仅 miss>0 时输出，不破坏上面那行现有的正则）。 */
if (missIds.length) console.log('锚点失配明细 ' + missIds.join(','));
console.log('（入口是 --file：**只期望 C8 报红**的变异必然记成逃逸，那是入口限制，不是检查器的结论）');
process.exit((esc + fr + crash + miss) ? 1 : 0);
