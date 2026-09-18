#!/usr/bin/env node
'use strict';
/* battery-relative.js —— 电池四态的**判定体**（纯函数），只此一份。
 * 2026-09-17 W23 J18 从 `run-battery.js` 里抽出来（**ISS-122 根治**）。
 *
 * ── 为什么必须独立成文件 ────────────────────────────────────────────────────
 * `run-battery.js` 是**纯脚本**（顶层全是执行代码）—— `require` 它会把**整套电池跑一遍**。
 * 所以尺子**没法单独 require 它的函数**。而「把判定抽出来，由自测喂样本把走不到的分支
 * 当场打红一次」是本仓库已立的模式（`battery-judge.js` 的先例）。
 * 抽成独立文件后，跑手与尺子**引用同一份实现** —— 不会像「复制一份到尺子里」那样
 * **静默分叉**（同 `newid.js` 的 `flattenBody`：ISS-125 的修法）。
 *
 * ── 它修的是什么（ISS-122 的现场，实测不是推测）────────────────────────────
 * 原来两条判定都**不问「这红是不是这条变异弄出来的」**：
 *   · 负向探针（期望 `!Cx`）判「**整份文档**有没有 Cx 红」；
 *   · 正向变异判「Cx 在不在红名单里」。
 * 于是**基底自带一处 Cx 红**时（实测：`~/Desktop/reply-to-B.cmd` 被删 → C5 基底红）：
 *   所有 `!Cx` 探针**集体变假红**、所有期望 `Cx` 的变异**集体变「命中」** ——
 *   报出来的四态**不是变异的效果，是基底的**。而**三套电池的变异一行没改**，
 *   读数却是 `[4] 假红 1→3` · `[5] 假红 0→3` · `[6] 命中 29→32`。
 *
 * ── 修法：加第四态 `na`（不适用）──────────────────────────────────────────
 * **期望码在基底上本来就红** ⇒ 这条变异**这一轮没法测**，单列一态、**不计入命中/逃逸/假红**。
 *
 * ★ **为什么两个方向都必须改**（这是本条的重点，不是「顺便」）：
 *   · 只改假红方向 → 「命中」那半边仍是**假绿**（变异没生效也记成命中）；
 *   · 只改命中方向 → 假红那半边仍是**误报**（会训练人忽略红色）。
 *   **假绿更贵**：它把「**没测到**」卖成「**测到了**」—— 误报看得见，假绿看不见。
 *
 * ★ **`na` 的代价（如实记）**：基底红时，一条**真的失效了**的变异也会被记成「不适用」→ 漏报。
 *   所以 `na` 必须**三层可见**：① 明细行 `NA <id>`；② 汇总行的「· **不适用 N**」；
 *   ③ `BASE-RED` 那一行明写「先去看 [1] 主检查」。
 *   而且**基底红本身就是一个必须处理的信号** —— 它不该被任何一态吸收掉。
 *
 * 用法：
 *   node .check/battery-relative.js          # 跑自测（毫秒级）
 *   require('./battery-relative.js').judgeOne(red, unv, expect, baseRedSet)
 */

/* red / unv : 变异后报红 / UNVERIFIED 的 Cx 集合（数组）
 * expect    : 该变异的期望（`C5` 或 `!C5`）
 * baseRedSet: **基底（未变异）**本来就报红的 Cx 集合（Set）
 * 返回 { state, want, unvHit? }，state ∈ { na, hit, falsered, escape } */
function judgeOne(red, unv, expect, baseRedSet) {
  const neg = String(expect).charAt(0) === '!';
  const want = neg ? String(expect).slice(1) : String(expect);
  /* ★ 第四态：期望码在**基底**上本来就红 ⇒ 不适用（**先于** hit/falsered 判定）。 */
  if (baseRedSet.has(want)) return { state: 'na', want };
  const ok = neg ? !red.includes(want) : red.includes(want);
  if (ok) return { state: 'hit', want, unvHit: neg && unv.includes(want) };
  return { state: neg ? 'falsered' : 'escape', want };
}

module.exports = { judgeOne };

/* ── 自测 ────────────────────────────────────────────────────────────────────
 * **成对**（同 `ruler-callpoint.js` / `x1-freshness-test.sh` 的纪律）：
 * 每一组都既测「基底红时必须降级」，**也**测「基底绿时**不得**降级」——
 * 否则一个「**一律降级**」的坏实现会让降级那几条**全过**。
 * 退出码：0 全过 · 1 有断言不符。 */
if (require.main === module) {
  const S = (...xs) => new Set(xs);
  const cases = [
    /* 基底全绿（正常情况）—— **一条都不许降级** */
    ['基底绿 · 正向命中', ['C3'], [], 'C3', S(), 'hit'],
    ['基底绿 · 正向没报红 → 逃逸', [], [], 'C3', S(), 'escape'],
    ['基底绿 · 反向成立 → 命中', [], [], '!C3', S(), 'hit'],
    ['基底绿 · 反向却报红 → 假红', ['C3'], [], '!C3', S(), 'falsered'],
    /* 基底自带 C5 红（ISS-122 的现场）—— **两个方向都必须降级** */
    ['★基底红 · 期望 !C5 的探针 → 不适用（**不得记假红**）', ['C5'], [], '!C5', S('C5'), 'na'],
    ['★基底红 · 期望 C5 的变异 → 不适用（**不得记命中**）', ['C5'], [], 'C5', S('C5'), 'na'],
    /* 基底红的**别的**码不受影响 —— 降级必须**精确到码**，不是一刀切 */
    ['基底红 C5 · 期望 C3 的变异照常判', ['C3'], [], 'C3', S('C5'), 'hit'],
    ['基底红 C5 · 期望 !C3 的变异照常判（报红 → 假红）', ['C3'], [], '!C3', S('C5'), 'falsered'],
    ['基底红 C5 · 期望 !C3 的变异照常判（不报 → 命中）', [], [], '!C3', S('C5'), 'hit'],
    /* UNVERIFIED 与不适用是**两件事**：不适用**优先**（它连判都不判） */
    ['基底红 C5 · 期望 !C5 且 C5 是 UNVERIFIED → 仍是 na', [], ['C5'], '!C5', S('C5'), 'na'],
    ['基底绿 · 反向成立但 UNVERIFIED → hit 且带 unvHit 标记', [], ['C3'], '!C3', S(), 'hit'],
  ];
  let ok = 0, bad = 0;
  console.log('=== battery-relative · 判定体自测（ISS-122）===');
  for (const [name, red, unv, expect, baseRedSet, want] of cases) {
    const got = judgeOne(red, unv, expect, baseRedSet).state;
    if (got === want) { ok++; console.log('  ✓ ' + name); }
    else { bad++; console.log('  ✗ ' + name + '  期望 ' + want + ' 实得 ' + got); }
  }
  /* unvHit 单独测：它是「反向成立但 UNVERIFIED」的标记，只在 hit 且 neg 且 unv 含 want 时为真。
   * ★ 第一版第三条断言写的是 `=== undefined` —— **写错了**：正向命中时 `unvHit` 是 `false`
   *   （`neg && …` 短路），不是 `undefined`。**是断言错，不是实现错**（实测 `true/true/false`）。
   *   留着这条注释，因为「断言写错」与「实现写错」在输出上**长得一样**（都是 11/12）。 */
  const uh1 = judgeOne([], ['C3'], '!C3', S()).unvHit === true;
  const uh2 = judgeOne([], [], '!C3', S()).unvHit === false;
  const uh3 = judgeOne(['C3'], [], 'C3', S()).unvHit === false;
  /* ★ 第二条断言错误（同一处的第二次）：我写 `judgeOne([], ['C3'], 'C3', …)` 以为那是「正向命中」，
   *   其实 `red` 为空 ⇒ `escape` 分支 ⇒ **那个分支根本不返回 `unvHit` 字段** ⇒ `undefined`。
   *   要测「正向命中」必须让 `red` 含 `C3`。**两次都是断言错、实现是对的** ——
   *   而两者在输出上长得一样（都是 11/12），只能靠**逐条读实测值**分开。 */
  const uh4 = judgeOne(['C3'], ['C3'], 'C3', S()).unvHit === false;   /* 正向命中：UNVERIFIED 不参与 unvHit */
  if (uh1 && uh2 && uh3 && uh4) { ok++; console.log('  ✓ unvHit 只在「反向成立且 UNVERIFIED」时为真（正向恒为 false）'); }
  else { bad++; console.log('  ✗ unvHit 标记不对：' + [uh1, uh2, uh3, uh4].join('/')); }
  console.log('----');
  console.log('结论: ' + ok + '/' + (ok + bad) + ' 条符合期望');
  process.exit(bad ? 1 : 0);
}
