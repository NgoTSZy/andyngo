'use strict';
/* 口径二：速查卡 ↔ 判事件表 入口覆盖（**独立实现**）
 * 用法: node card-entry-coverage2.js <spec> <SKILL.md>
 * 退出码: 0 = 无缺口 / 1 = 有缺口 / 2 = 判据空转（UNVERIFIED，不报 PASS）
 *
 * 与口径一（card-entry-coverage.sh）**刻意不同**的四点，缺一不可：
 *   ① 语言不同：口径一 bash+grep，本口径 node
 *   ② 定位方式不同：口径一硬编码行号 1185-1207；本口径**按锚点文本**「一页速查卡」+
 *      代码块围栏 ``` 定位 —— 规格增删一行也不会漂
 *   ③ 比较方式不同：口径一 `comm -23` 求差集；本口径 Set 差
 *   ④ 正则宽度不同：本口径 `[a-z][a-z-]*` 明确吃连字符
 * 修订史：v1 与口径一**共用同一行抽取代码**，被独立验收判为「两口径不独立」——
 *         同源判据不算两个判据，已重写（CHG-014）。
 */
const fs = require('fs');
const [, , SPEC, SKILL] = process.argv;

const NAME_RE = /\/andyngo[ \t]+([a-z][a-z-]*)/g;

function die(msg, code) {
  console.log(msg);
  console.log('VERDICT: UNVERIFIED');
  process.exit(code);
}

let specLines, skillText;
try { specLines = fs.readFileSync(SPEC, 'utf8').split(/\r?\n/); }
catch (e) { die('读不到规格: ' + SPEC + ' —— 判据空转，不报 PASS', 2); }
try { skillText = fs.readFileSync(SKILL, 'utf8'); }
catch (e) { die('读不到被测文件: ' + SKILL, 2); }

/* ② 按锚点定位速查卡代码块（不硬编码行号） */
const anchor = specLines.findIndex((l) => l.indexOf('一页速查卡') >= 0);
if (anchor < 0) die('规格里找不到锚点「一页速查卡」—— 判据空转，不报 PASS', 2);

let start = -1, end = -1;
for (let i = anchor; i < specLines.length; i++) {
  if (specLines[i].trim().indexOf('```') === 0) {
    if (start < 0) start = i + 1; else { end = i; break; }
  }
}
if (start < 0 || end < 0) die('锚点后找不到成对的 ``` 代码块围栏 —— 判据空转，不报 PASS', 2);

const card = new Set();
for (let i = start; i < end; i++) {
  let m; NAME_RE.lastIndex = 0;
  while ((m = NAME_RE.exec(specLines[i])) !== null) card.add(m[1]);
}

/* 守门人：解析不出 8 个名字就不许往下走 */
if (card.size < 8) {
  die('速查卡解析出 ' + card.size + ' 个名字（预期 8）—— 判据空转，不报 PASS', 2);
}

/* ③ Set 差 */
const skill = new Set();
let m; NAME_RE.lastIndex = 0;
while ((m = NAME_RE.exec(skillText)) !== null) skill.add(m[1]);

const missing = [...card].filter((n) => !skill.has(n)).sort();

console.log('速查卡承诺(' + card.size + '): ' + [...card].sort().join(' '));
console.log('判事件表接住(' + skill.size + '): ' + [...skill].sort().join(' '));
console.log('缺口(MISSING): ' + missing.join(' '));
console.log('缺口数 = ' + missing.length);

if (missing.length === 0) {
  console.log('VERDICT: PASS（速查卡 ' + card.size + ' 个入口全部被接住）');
  process.exit(0);
}
console.log('VERDICT: FAIL（速查卡有 ' + missing.length + ' 个入口接不住）');
process.exit(1);
