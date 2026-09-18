#!/usr/bin/env node
/* hardcoded-count.js —— 「寫死的計數」守衛（**ISS-140**）
 *
 * 由來：ISS-140 實測 —— `write-lock-test.sh` 的自測項數**只有一個「真源」**，
 * 而那個真源**本身就是寫死的字面量**（末行 `echo "… 28 項全通過"`）。
 * 我先把「16 項」抄進留證，後來才真去跑一次 → 實測 28。**這類值會腐爛，而且沒有判據守着。**
 * （修法：把末行改成 `$total` = `items + fails`，**算出來的**。）
 *
 * 判什麼（**表驅動**）：表裡列出的位置**禁止出現寫死的計數** —— 應寫成變數或指針。
 *   命中 `re` 的捕獲組 ⇒ FAIL，**不管那個數對不對**
 *   （「寫死且恰好正確」下次加一項就錯 —— 那種綠是**假綠**）。
 *
 * 退出碼（三態，**不許合併**）：0 通過 · 1 失敗 · 2 拒跑
 *   `2` 的語義是「**沒跑成 ≠ 通過**」：表裡任何一個文件讀不到 → 拒跑，不報 OK。
 *
 * ★ 邊界（寫在**文件裡**，不只寫在日誌裡）：
 *   ① 本判據**只守表裡列出的位置** —— 沒列出的地方它**看不見**。
 *      **掃描面窄於缺陷形狀就會漏**（ISS-132 同族）⇒ 發現新的寫死計數就**往表裡加一行**。
 *   ② 它判的是「**這處有沒有寫死**」，**不判**「那個數對不對」 ——
 *      寫死且恰好正確 → 也報 FAIL（**刻意的**：那種值下次一定腐爛）。
 *   ③ 它**不跑**任何工具（無副作用、**不碰鎖**）—— 所以它**不需要**無鎖窗口，
 *      也不會像 `write-lock-test.sh` 那樣在持鎖時 `rc=2` 拒跑。
 *   ④ **歷史記述不進表**：帶日期的「某日實測是 N」、帶「原先寫的是 N」的轉述、
 *      以及 `.check/record/` 下的記錄行與 `evidence/`、`.check/tmp/` 下的一次性工具，
 *      都是**記述**而不是**活斷言** —— 它們**不會腐爛**（某日確實是那個值）。
 *      本判據只守**「會被當成當前值讀走」的位置**。
 *      （2026-09-17 全倉掃過一次：殘留的寫死計數**全部屬於這一類** ⇒ 表維持 2 條。）
 *
 * 用法：node .check/tests/hardcoded-count.js [--inject]
 *   --inject：在**記憶體裡**餵變異，逐條斷言「必須報紅」；最後一條是**假紅守門人**
 *             （無關變異**不得**報紅）。**全程不碰磁碟。**
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

/* ---------- 表（唯一的資料源；加一個新位置 = 加一行） ---------- */
/* 【2026-09-17 删一条】原表第 2 条是 `skills/andy/scripts/andy-audit.sh` 里转述的 write-lock
 * 自测项数。该 skill 已按用户裁决「本机只保留 /andyngo」移出（`.backup-strip-20260917-2232/`），
 * 文件不存在 ⇒ 本判据 `REFUSE 读不到表里的文件` **拒跑 rc=2**。
 * **为什么是「删这一行」而不是「改指向 `andyngo-audit.sh`」**：实测该载体里**没有**
 * `自测：N 项全通过` 这段文字（`grep -c` → 0），改指向会造出一条**永远找不到锚点**的假判据。
 * ⇒ 这个位置**已经不存在**，删掉才是如实描述（同 DEC-026「不假装它被守住了」）。 */
const TABLE = [
  {
    id: 'write-lock-test 自测项数',
    file: '.check/tests/write-lock-test.sh',
    re: /自测：(\d+)\s*项全通过/,
    want: '应写成 `$total`（= `items + fails`，算出来的）'
  }
];

/* ---------- 純函數判定體（--inject 直接餵它） ---------- */
function judge(table, readFn) {
  const fails = [];
  table.forEach(t => {
    const txt = readFn(t.file);
    if (txt === null) { fails.push('R0 读不到文件（' + t.id + '）: ' + t.file); return; }
    const m = txt.match(t.re);
    if (m) fails.push('R1 写死的计数（' + t.id + '）: 命中「' + m[0] + '」—— ' + t.want);
  });
  return fails;
}

/* ---------- 讀磁碟 ---------- */
function readDisk(f) {
  try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return null; }
}

/* ---------- 拒跑（第三態） ---------- */
function refuse(msg) {
  console.log('REFUSE ' + msg);
  console.log('结论：拒跑（**没跑成 ≠ 通过**）');
  process.exit(2);
}

const missing = TABLE.filter(t => readDisk(t.file) === null).map(t => t.file);
if (missing.length) refuse('读不到表里的文件: ' + missing.join(' · '));

/* ---------- 反向注入模式 ---------- */
if (process.argv.indexOf('--inject') !== -1) {
  // ★ 前提：**基线必须全绿**。否则「假红」这个词没有意义 ——
  //   无法区分「无关变异引起的红」与「本来就红」。
  //   （2026-09-17 实测踩到：表里第 2 条本来就红 → 守门人被误判成「假红」2 条。
  //     这不是守门人坏，是**前提没写在文件里**。）
  const base = judge(TABLE, readDisk);
  if (base.length) refuse('基线本身不是全绿（' + base.length + ' 项）—— 先修好基线，再谈假红: ' + base[0]);
  const F = TABLE[0].file;
  const real = readDisk(F);
  if (real === null) refuse('反向注入取不到夹具: ' + F);
  const VECTORS = [
    { name: '把修好的末行改回写死（28）', memo: real.replace('$total 项全通过', '28 项全通过'), mustHit: true },
    { name: '保持修好的写法（$total）', memo: real, mustHit: false },
    { name: '假红守门人：改动无关的注释数字', memo: real.replace('24–28', '24–29'), mustHit: false }
  ];
  console.log('=== 反向注入（每条都必须符合预期；守门人必须不报红）===');
  let bad = 0;
  VECTORS.forEach(v => {
    const readFn = f => (f === F ? v.memo : readDisk(f));
    const f = judge(TABLE, readFn);
    if (v.mustHit) {
      if (f.some(x => x.indexOf('R1') === 0)) console.log('  OK   ' + v.name + ' → 如预期报红');
      else { console.log('  FAIL ' + v.name + ' → 未复现缺陷（该断言是假绿）'); bad++; }
    } else {
      if (f.length === 0) console.log('  OK   ' + v.name + ' → 如预期**不报红**');
      else { console.log('  FAIL ' + v.name + ' → 无关变异却报红（假红）: ' + f[0]); bad++; }
    }
  });
  console.log(bad === 0
    ? '反向注入 ' + VECTORS.length + '/' + VECTORS.length + ' 全部符合预期'
    : '反向注入有 ' + bad + ' 条不符合预期');
  process.exit(bad === 0 ? 0 : 1);
}

/* ---------- 正常模式 ---------- */
console.log('检查 ' + TABLE.length + ' 个位置（禁止写死的计数）');
const fails = judge(TABLE, readDisk);
fails.forEach(f => console.log('FAIL ' + f));
console.log(fails.length === 0
  ? '结论：OK ' + TABLE.length + ' 个位置都没有写死的计数'
  : '结论：FAIL ' + fails.length + ' 项');
process.exit(fails.length === 0 ? 0 : 1);
