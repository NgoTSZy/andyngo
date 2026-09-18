#!/usr/bin/env node
/* artifacts-index.js —— 產物登記判據（**ISS-141 的另一半**）
 *
 * 由來：用戶 2026-09-17 裁決「**加一條輕量登記（只記 path + 一句理由，不進 eventlog）**」
 * 與「**和 ISS-140 是同一個形狀。要造**」（= 要造判據守着它）。
 * 光把約定寫進規格不算數 —— 「**規格裡寫清楚**」≠「**有東西守着它**」。
 *
 * 判什麼（掃描面 = `artifacts/` 下的**目錄** × `INDEX.md` 的**登記條**）：
 *   R1  每個**目錄**必須有登記  —— 防「產物寫進一個沒人知道的地方」
 *   R2  每條登記必須指向**存在的目錄** —— 防懸空登記（登記指着的東西已經沒了）
 *
 * 退出碼（三態，**不許合併**）：0 通過 · 1 失敗 · 2 拒跑
 *   `2` 的語義是「**沒跑成 ≠ 通過**」：找不到產物目錄或登記檔就拒跑，不報 OK。
 *
 * ★ 邊界（寫在**文件裡**，不只寫在日誌裡）：
 *   本判據只保證「**目錄 ↔ 登記**一一對應」。它**不檢查**那句理由寫得對不對，
 *   也**不檢查**產物本身能不能用。**那兩件事沒有判據守着。**
 *   ★ 掃描面**只含目錄**（`artifacts/<slug>/`）：頂層**檔案**（例如有人把產物直接寫成
 *     `artifacts/foo.html`）**掃不到** ⇒ 不會報 R1。這是**刻意取捨** —— `INDEX.md` 自己
 *     就是頂層檔案，若把檔案納入掃描面，它會被要求登記自己。
 *     ★ 但取捨必須**寫下來**：**掃描面窄於缺陷形狀就會漏**（ISS-132 同族）。
 *
 * 用法：node .check/tests/artifacts-index.js [--inject]
 *   --inject：在**記憶體裡**餵變異輸入，逐條斷言「必須報紅」；最後一條是**假紅守門人**
 *             （無關變異**不得**報紅）。**全程不碰磁碟。**
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/* ---------- 定位（不寫死用戶名） ---------- */
const ARTIFACTS = process.env.ANDY_ARTIFACTS
  || path.join(os.homedir(), 'Documents', 'workbuddy', 'artifacts');
const INDEX = path.join(ARTIFACTS, 'INDEX.md');

/* ---------- 純函數判定體（--inject 直接餵它） ---------- */
function judge(dirs, reg) {
  const fails = [];
  dirs.forEach(d => {
    if (reg.indexOf(d) === -1) fails.push('R1 孤兒目錄（有目錄無登記）: ' + d);
  });
  reg.forEach(r => {
    if (dirs.indexOf(r) === -1) fails.push('R2 懸空登記（有登記無目錄）: ' + r);
  });
  return fails;
}

/* ---------- 讀磁碟 ---------- */
function listDirs() {
  return fs.readdirSync(ARTIFACTS, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();
}

function listRegistered() {
  const txt = fs.readFileSync(INDEX, 'utf8');
  const out = [];
  txt.split('\n').forEach(line => {
    const m = line.match(/^-\s+`([^`]+)`/);
    if (m) out.push(m[1]);
  });
  return out.sort();
}

/* ---------- 拒跑（第三態） ---------- */
function refuse(msg) {
  console.log('REFUSE ' + msg);
  console.log('結論：拒跑（**沒跑成 ≠ 通過**）');
  process.exit(2);
}

if (!fs.existsSync(ARTIFACTS)) refuse('找不到產物目錄: ' + ARTIFACTS);
if (!fs.statSync(ARTIFACTS).isDirectory()) refuse('產物路徑不是目錄: ' + ARTIFACTS);
if (!fs.existsSync(INDEX)) refuse('找不到登記檔: ' + INDEX);

const dirs = listDirs();
const reg = listRegistered();

/* ---------- 反向注入模式 ---------- */
if (process.argv.indexOf('--inject') !== -1) {
  const VECTORS = [
    { name: '剝掉一個目錄的登記', dirs: dirs, reg: reg.filter(x => x !== dirs[0]), mustHit: 'R1' },
    { name: '加一條懸空登記', dirs: dirs, reg: reg.concat(['__ghost_slug__']), mustHit: 'R2' },
    { name: '假紅守門人：兩邊順序顛倒', dirs: dirs.slice().reverse(), reg: reg.slice().reverse(), mustHit: null }
  ];
  console.log('=== 反向注入（每條都必須復現缺陷；守門人必須不報紅）===');
  let bad = 0;
  VECTORS.forEach(v => {
    const f = judge(v.dirs, v.reg);
    if (v.mustHit === null) {
      if (f.length === 0) console.log('  OK   ' + v.name + ' → 如預期**不報紅**');
      else { console.log('  FAIL ' + v.name + ' → 無關變異卻報紅（假紅）: ' + f[0]); bad++; }
    } else {
      const hit = f.some(x => x.indexOf(v.mustHit) === 0);
      if (hit) console.log('  OK   ' + v.name + ' → 如預期報紅: ' + v.mustHit);
      else { console.log('  FAIL ' + v.name + ' → 未復現缺陷（該斷言是假綠）'); bad++; }
    }
  });
  console.log(bad === 0
    ? '反向注入 ' + VECTORS.length + '/' + VECTORS.length + ' 全部符合預期'
    : '反向注入有 ' + bad + ' 條不符合預期');
  process.exit(bad === 0 ? 0 : 1);
}

/* ---------- 正常模式 ---------- */
console.log('產物目錄: ' + ARTIFACTS);
console.log('掃描 ' + dirs.length + ' 個目錄 · 登記 ' + reg.length + ' 條');
const fails = judge(dirs, reg);
fails.forEach(f => console.log('FAIL ' + f));
console.log(fails.length === 0
  ? '結論：OK ' + dirs.length + ' 個產物目錄與登記**一一對應** · 孤兒 0 · 懸空 0'
  : '結論：FAIL ' + fails.length + ' 項');
process.exit(fails.length === 0 ? 0 : 1);
