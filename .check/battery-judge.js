#!/usr/bin/env node
'use strict';
/* battery-judge.js —— 电池验收的**判定逻辑**，只此一份。
 *
 * 为什么单独成文件（照 fileset.js 的先例）：
 *   判定里有两条分支在**真实环境里走不到**——
 *     ① 「名单外的**新**失配」：现在 3 条失配全部已登记，真实跑不出第 4 条；
 *     ② 「失配数 > 已登记数，但跑手没给明细」（self 跑手不输出明细行）。
 *   一条走不到的分支和一条不存在的分支，在验收表上长得一样 —— 都是绿。
 *   抽出来之后，由下面的自测喂样本把这两条**当场打红一次**，证明它会响。
 *
 * 用法：
 *   node .check/battery-judge.js        # 跑自测（毫秒级）
 *   require('./battery-judge.js').judgeBattery(got, want)
 *
 * ⚠ 合成样本只证明**判定逻辑**对，不证明真实环境如何。
 *   真实那一侧由 acceptance.js 的 [3..N] 提供（它跑真电池）。
 */

/* got  : 跑手解析出来的实测值 { total, hit, escape, falsered, crash, miss, missIds }
 * want : 基线里的期望值     { total, hit, escape, falsered, crash, miss, missKnown }
 *
 * 三态（与 acceptance.js 的四态口径一致，UNVERIFIED 由调用方在 got 为空时给）：
 *   FAIL  结构坏了 —— 抛错 / 名单外新失配 / 失配数超过登记数 / 假红变多 / 命中变少
 *   OK    跑出来了，且每个数与基线一致
 *   DRIFT 跑出来了，结构正常，但数字变了 —— 要么更新基线，要么查回归
 */
function judgeBattery(got, want) {
  const known = want.missKnown || [];
  const missIds = got.missIds || [];
  const newMiss = missIds.filter((id) => !known.includes(id));
  const goneMiss = known.filter((id) => !missIds.includes(id));

  /* `got.miss > known.length` 这一条是**堵假绿**：
   * self 跑手不输出失配明细 → missIds 恒为空 → 只靠 newMiss 判的话，
   * 它的失配**永远不会红**（「读不到」被读成「没问题」）。
   * 加上「失配数超过已登记数即红」后：self 电池 missKnown 为空，任何失配都红。 */
  const structural = got.crash > 0 || newMiss.length > 0 ||
    got.miss > known.length ||
    got.falsered > want.falsered || got.hit < want.hit;

  const same = got.total === want.total && got.hit === want.hit && got.escape === want.escape &&
    got.falsered === want.falsered && got.crash === want.crash && got.miss === want.miss;

  const missTxt = '锚点失配 ' + got.miss +
    (missIds.length ? '（' + (newMiss.length
      ? '**新失配 ' + newMiss.join(',') + '**'
      : '已登记 ' + missIds.join(',')) + '）' : '');

  const hint = newMiss.length
    ? '**名单外的新失配** = 又有一条变异根本没跑（已登记 ' + (known.join(',') || '无') + '）'
    : got.miss > known.length
      ? '失配数 ' + got.miss + ' > 已登记 ' + known.length + ' 条，且跑手没给出 ID 明细 —— 不猜是哪几条，先去看跑手'
      : got.miss > 0
        ? '锚点失配 ' + got.miss + ' 条**已在基线登记**（快照锚点随文档改动失效，非回归）；每改一次文档都要重看这份名单'
        : goneMiss.length
          ? '已登记的失配 ' + goneMiss.join(',') + ' **这次没出现** —— 锚点又对上了？去核对，别让名单腐烂'
          : got.falsered > want.falsered ? '假红变多：合法改动被报成缺陷'
            : '';

  return {
    state: structural ? 'FAIL' : (same ? 'OK' : 'DRIFT'),
    newMiss, goneMiss, known, missIds, missTxt, hint,
  };
}

module.exports = { judgeBattery };

// ---- 自测：只在本文件被直接运行时跑 -----------------------------------------
if (require.main === module) {
  const K = ['N36', 'N38', 'N40'];
  const base = { total: 41, hit: 29, escape: 9, falsered: 0, crash: 0, miss: 3, missKnown: K };
  const g = (o) => Object.assign({}, base, o);

  const cases = [
    // [名称, got, want, 期望状态, 期望 newMiss, 是不是"守门人"（必须能报红）]
    ['已登记失配全中 → 不判红', g({ missIds: K }), base, 'OK', [], false],
    ['★名单外新失配 N42 → 必须红', g({ miss: 4, missIds: K.concat('N42') }), base, 'FAIL', ['N42'], true],
    ['★self 跑手：失配 1 但没有 ID 明细 → 必须红', g({ miss: 1, missIds: [] }),
      { total: 14, hit: 13, escape: 1, falsered: 0, crash: 0, miss: 0, missKnown: [] }, 'FAIL', [], true],
    ['★已登记 3 条，实测失配 ID 换了一条 → 必须红', g({ missIds: ['N36', 'N38', 'N99'] }),
      base, 'FAIL', ['N99'], true],
    /* 用例自己踩过一次：这里 want 若仍用 base（hit29/esc9/miss3），
     * got 换成 hit30/esc11/miss0 → 判 DRIFT 是**对的**，是用例的期望值写错了。
     * 教训：自测的「期望」也要被当成断言来核对，否则它只会证明我抄了两遍同样的错。 */
    ['无失配、数字全对 → OK', g({ miss: 0, missIds: [], hit: 30, escape: 11 }),
      Object.assign({}, base, { hit: 30, escape: 11, miss: 0, missKnown: [] }), 'OK', [], false],
    ['命中掉 1 → 红', g({ hit: 28, missIds: K }), base, 'FAIL', [], true],
    ['假红变多 → 红', g({ falsered: 2, missIds: K }), base, 'FAIL', [], true],
    ['检查器抛错 → 红', g({ crash: 1, missIds: K }), base, 'FAIL', [], true],
    ['结构正常但逃逸 +1 → DRIFT（不是红）', g({ escape: 10, missIds: K }), base, 'DRIFT', [], false],
    ['已登记失配这次没出现（锚点回来了）→ DRIFT，且提示名单要重核',
      g({ miss: 2, missIds: ['N36', 'N38'] }), base, 'DRIFT', [], false],
  ];

  let hit = 0;
  const bad = [];
  for (const [name, got, want, expState, expNewMiss, isGuard] of cases) {
    const r = judgeBattery(got, want);
    const ok = r.state === expState && r.newMiss.join(',') === expNewMiss.join(',');
    if (ok) hit++; else bad.push('  FAIL ' + name + ' → 实得 ' + r.state +
      ' newMiss[' + r.newMiss.join(',') + ']，期望 ' + expState + ' newMiss[' + expNewMiss.join(',') + ']');
  }
  const guards = cases.filter((c) => c[5]).length;
  console.log(bad.join('\n'));
  console.log('判定自测 ' + cases.length + ' 条：命中 ' + hit + ' / 失败 ' + (cases.length - hit) +
    '（其中**守门人 ' + guards + ' 条** —— 它们必须报红，报绿就是判据死了）');
  process.exit(bad.length ? 1 : 0);
}
