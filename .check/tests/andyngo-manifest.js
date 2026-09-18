'use strict';
/* 生成 skills/andyngo 全量 Manifest（md5 + 行数），供 SEAL 步骤使用。
 * 用法: node andyngo-manifest.js <root> <outJson>
 *
 * v2 修正（CHG-012）：v1 用 raw.split(/\r?\n/).length 当行数，
 * 对**以换行结尾**的文件会多算 1 行 → 22 个文件合计多算 22 行
 * （这就是 SEAL §四「880 行」的真正来源；真值 858）。
 * v2 同时给两个口径并打印差异，谁也别再靠记忆判断哪个对：
 *   linesWc  = 换行符个数            ← 与 `wc -l` 一致，判据用这个
 *   linesRaw = split 后的数组长度     ← v1 的错口径，保留以便对账
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* v3 增补（ISS-018）：参数守卫 + **出错点名文件**
 * 原版 `const ROOT = path.resolve(process.argv[2] || '.')` —— **缺参就默认扫当前目录**，
 * 而当前目录通常是整个 `.workbuddy-ai` 仓库（含宿主正在写的日志文件）。实测两种调用
 * （裸跑 / 显式给 `.`）**都**死在
 *     Error: EBUSY: resource busy or locked, read
 *     at Object.readSync …（一串裸栈）
 * **既不说是哪个文件被占、也不说「你给错了根」** —— 归因错误。
 * 同族：ISS-013（C5 在文件集模式下报全局行号、不标来源文件）。判据报错时的
 * 「指向性」和判据本身的正确性一样重要 —— 指向错地方比不报还坏。
 * 修法：① 缺参默认 `skills/andyngo`（本脚本的真正用途），不是 `.`；
 *      ② 根不存在 / 根下无 SKILL.md / 缺输出路径 → **exit 2 拒跑**；
 *      ③ 读取失败时 try/catch **点名文件**，不让人对着裸栈猜。
 */
const REPO = path.resolve(__dirname, '..', '..');
const ROOT = path.resolve(process.argv[2] || path.join(REPO, 'skills', 'andyngo'));
const OUT = process.argv[3];
const die = (msg) => {
  console.error('SKIP ' + msg);
  console.error('     拒绝在错的根上产出一份「看起来很全」的清单');
  process.exit(2);
};
function readOrDie(p) {
  try { return fs.readFileSync(p); }
  catch (e) { die('无法读取 ' + p + '（' + e.code + '）—— 点名文件，不让人对着裸栈猜'); }
}
if (!fs.existsSync(ROOT) || !fs.statSync(ROOT).isDirectory()) die('根目录不存在：' + ROOT);
if (!fs.existsSync(path.join(ROOT, 'SKILL.md'))) die('根下没有 SKILL.md —— 这不像 skills/andyngo：' + ROOT);
if (!OUT) die('缺少输出路径。用法: node andyngo-manifest.js [root] <outJson>');
const md5 = (p) => crypto.createHash('md5').update(readOrDie(p)).digest('hex');

const rows = [];
(function rec(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const q = path.join(d, e.name);
    if (e.isDirectory()) rec(q);
    else {
      const buf = readOrDie(q);
      const raw = buf.toString('utf8');
      const linesWc = (raw.match(/\n/g) || []).length;
      const linesRaw = raw.split(/\r?\n/).length;
      rows.push({
        file: path.relative(ROOT, q).split(path.sep).join('/'),
        bytes: buf.length,
        linesWc,
        linesRaw,
        md5: md5(q),
      });
    }
  }
})(ROOT);
rows.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));

let bytes = 0, linesWc = 0, linesRaw = 0, differ = 0;
for (const r of rows) {
  bytes += r.bytes; linesWc += r.linesWc; linesRaw += r.linesRaw;
  if (r.linesWc !== r.linesRaw) differ++;
}

for (const r of rows) {
  console.log(
    r.file.padEnd(66) +
    String(r.bytes).padStart(7) + 'B  ' +
    String(r.linesWc).padStart(4) + 'L  ' +
    String(r.linesRaw).padStart(4) + 'Lraw  ' +
    r.md5
  );
}
console.log('-'.repeat(126));
console.log('FILES=' + rows.length + '  TOTAL_BYTES=' + bytes);
console.log('TOTAL_LINES(wc 口径)=' + linesWc + '   TOTAL_LINES(split 口径)=' + linesRaw);
console.log('两口径不同的文件数=' + differ + '（每个「以换行结尾」的文件 split 口径多算 1）');
console.log('自检：linesWc + 差异文件数 == linesRaw ? ' +
  (linesWc + differ === linesRaw ? 'YES（口径差可解释）' : 'NO（不可解释，要查）'));

if (OUT) {
  fs.writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    root: ROOT,
    generator: 'andyngo-manifest.js v3（双口径 + 参数守卫）',
    fileCount: rows.length,
    totalBytes: bytes,
    totalLinesWc: linesWc,
    totalLinesRaw: linesRaw,
    filesDifferingBetweenLineCounts: differ,
    files: rows,
  }, null, 2) + '\n', 'utf8');
  console.log('MANIFEST=' + path.resolve(OUT));
}
