#!/usr/bin/env node
'use strict';
/* 文件历史取回器 —— **只读**。
 *
 * ── 为什么存在（2026-09-16 实测，不是推测）────────────────────────────
 * 我在 ISS-054 里写过一个结论：「改前版本不可回溯，因为本仓库不是 git 仓库」。
 * **那个结论是错的。** 真因是我只查了 `git rev-parse`，**没去查产品自带的
 * `file-history/`** —— 拿「一个机制的缺失」去否定「另一个机制的存在」。
 *
 * 产品一直在留版本，规则（由两对 md5 交叉核对反推，命中 2/2）：
 *
 *     <HOME>/file-history/<conversationId>/<sha256(绝对路径·反斜杠原样)[:16]>@v<N>
 *
 * 实测样本（`.check/host-log.js`）：
 *   hash = sha256("C:\Users\<user>\.workbuddy-ai\.check\host-log.js")[:16]
 *        = bc8a8f6310d6c715          ← 与磁盘上的目录名**逐字符相同**
 *   [34b3b3a5] @v1=677 行(a1a68b4b…) @v2=816 行(3f3192d5…) @v3=868 行(22ffe4d0…)
 *   [423df6fe] @v2…@v13 共 12 版，65 → 87 → 216 → … → 677 行 —— **整个演化史都在**
 *
 * 所以「改前是什么样」是**可算、可取**的，不是「没留」。
 *
 * ── 用法 ────────────────────────────────────────────────────────────
 *   node .check/file-history.js --list <路径>        # 列版本链（版本/md5/行数/块时间）
 *   node .check/file-history.js --get  <路径> <vN> [--conv <会话前缀>]   # 打印第 N 版内容到 stdout
 *   node .check/file-history.js --hash <路径>        # 只打印历史 hash
 *
 * **★ `--list` 的 `vN` 与 `--get` 的 `<vN>` 不是同一套编号。**
 * 版本块按**会话**分开存：同一份文件在会话 A 有 v1…v3、在会话 B 也有 v1…v13。
 * `--list` 打印的是**块内编号**；`--get <n>` 是跨会话按 `(v, 会话)` 排序取块。
 * 所以同名 `vN` 可能有多块 —— 此时 `--get` **拒跑**（rc=2）并列出候选，
 * 用 `--conv <会话前缀>` 消歧。**这是 2026-09-16 实测踩出来的**（ISS-059）：
 * 我照 `--list` 的编号去归档，归档文件**静默是错的** —— 没有报错，只有 md5 对不上才知道。
 * **分不清的两件事不许猜成一件**（DEC-007 / DEC-029）。
 *
 * <路径> 可为相对（相对本仓库根）或绝对。`--get` **只打印，绝不写文件** ——
 * 要不要落盘由调用方自己重定向决定（同 DEC-023：不留「让检查不跑」的开关）。
 *
 * ── 退出码（三态分开，同 DEC-013）────────────────────────────────────
 *   0  成功（找到了链 / 打印了内容）
 *   1  该路径**没有**任何历史块（可能从未被工具写过）/ 该版本号不存在
 *   2  **拒跑**：同名版本号有多块，`--conv` 没给或给了也不唯一 —— **不猜**
 *   4  参数错 / 路径错
 * 只读，不写任何文件。
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const HOME = path.dirname(__dirname);          /* …\.workbuddy-ai */
const FH = path.join(HOME, 'file-history');

function usage(code) {
  console.error('用法: node .check/file-history.js --list|--get|--hash <路径> [vN]');
  process.exit(code);
}

/* 归一化：绝对路径 → 反斜杠原样（盘符保持大写）。**规则就靠这一条，改了它等于改判据。** */
function histHash(p) {
  const abs = path.resolve(HOME, p).replace(/\//g, '\\');
  return { abs, hash: crypto.createHash('sha256').update(abs, 'utf8').digest('hex').slice(0, 16) };
}

/* 扫所有会话目录，收集该 hash 的版本块。 */
function chainOf(hash) {
  const out = [];
  let convs;
  try { convs = fs.readdirSync(FH); } catch (e) { return out; }
  for (const conv of convs) {
    const dir = path.join(FH, conv);
    let names;
    try { names = fs.readdirSync(dir); } catch (e) { continue; }
    for (const n of names) {
      if (!n.startsWith(hash + '@v')) continue;
      const v = +n.split('@v')[1];
      if (!Number.isFinite(v)) continue;
      out.push({ conv, v, file: path.join(dir, n), name: n });
    }
  }
  out.sort((a, b) => (a.v - b.v) || a.conv.localeCompare(b.conv));
  return out;
}

const argv = process.argv.slice(2);
const mode = argv[0];
if (mode !== '--list' && mode !== '--get' && mode !== '--hash') usage(4);
const target = argv[1];
if (!target) usage(4);

const { abs, hash } = histHash(target);

if (mode === '--hash') {
  console.log(hash);
  process.exit(0);
}

const chain = chainOf(hash);
if (!chain.length) {
  console.log('NO-HISTORY  ' + abs);
  console.log('  hash=' + hash + ' —— file-history 下没有任何该 hash 的块。');
  console.log('  （可能：该文件从未被文件工具写过；或 hash 规则变了 —— 规则见本文件头部。）');
  process.exit(1);
}

if (mode === '--get') {
  const want = +argv[2];
  if (!Number.isFinite(want)) usage(4);
  /* 【2026-09-16 修 · ISS-059】`--get` 原先**在同名版本号有多块时静默取最后一块**。
   *
   * 版本块是**按会话分开存的**：同一份文件在会话 A 有 v1…v3、在会话 B 也有 v1…v13。
   * `--list` 打印的 `vN` 是**块内编号**，而 `--get <n>` 是**跨会话按 (v, 会话) 排序取最后一块** ——
   * **两套编号不是一回事**。实测：`--get .check/host-log.js 3` 返回的是**另一个会话**的 v3
   * （86 行早期版），而列表里 `v3 / 34b3b3a5 / 22ffe4d0… / 868 行` 才是要的那一版。
   * 我照 `--list` 的编号去归档，**归档文件静默是错的** —— 没有报错、没有提示、md5 不对才知道。
   * 这与本项目反复踩的形状同族：**分不清的两件事不许猜成一件**（DEC-007 / DEC-029）。
   *
   * 现在：多块时**拒跑**（rc=2，同 DEC-013 的「拒跑」语义），把候选逐条打印出来
   * （版本 / 会话 / md5 / 行数），并用 `--conv <会话前缀>` 显式消歧。
   * **不用「取最新 mtime」这种猜测来消歧** —— 那还是猜，只是猜得好看一点。 */
  let hit = chain.filter((c) => c.v === want);
  const convIdx = argv.indexOf('--conv');
  const convWant = convIdx >= 0 ? argv[convIdx + 1] : null;
  if (convWant) hit = hit.filter((c) => c.conv.startsWith(convWant));

  if (!hit.length) {
    console.error('NO-SUCH-VERSION v' + want + '（该 hash 下有 v' + chain.map((c) => c.v).join(',') + '）' +
      (convWant ? '；会话前缀 ' + convWant + ' 下没有 v' + want : ''));
    process.exit(1);
  }
  if (hit.length > 1) {
    console.error('AMBIGUOUS v' + want + ' —— 有 ' + hit.length + ' 块同名版本（**拒跑，不猜**）：');
    for (const c of hit) {
      const buf = fs.readFileSync(c.file);
      console.error('  v' + want + '  会话 ' + c.conv.slice(0, 8) + '  md5=' +
        crypto.createHash('md5').update(buf).digest('hex') + '  ' +
        (buf.toString('utf8').split('\n').length - 1) + ' 行');
    }
    console.error('  消歧：加 `--conv <会话前缀>`（例如 --conv ' + hit[0].conv.slice(0, 8) + '）');
    process.exit(2);
  }
  process.stdout.write(fs.readFileSync(hit[0].file));
  process.exit(0);
}

/* --list */
let diskMd5 = null;
try { diskMd5 = crypto.createHash('md5').update(fs.readFileSync(abs)).digest('hex'); }
catch (e) { diskMd5 = null; }

console.log('PATH  ' + abs);
console.log('HASH  ' + hash);
console.log('DISK  md5=' + (diskMd5 || '(读不到)'));
console.log('版本  会话        md5                              行数   块时间                 与磁盘');
for (const c of chain) {
  const buf = fs.readFileSync(c.file);
  const md5 = crypto.createHash('md5').update(buf).digest('hex');
  const lines = buf.toString('utf8').split('\n').length - 1;
  const mt = fs.statSync(c.file).mtime.toISOString().replace('T', ' ').slice(0, 19);
  const same = md5 === diskMd5 ? '**相同**' : '';
  console.log(
    ('v' + c.v).padEnd(5) + ' ' + c.conv.slice(0, 8) + '  ' + md5 + '  ' +
    String(lines).padStart(4) + '   ' + mt + '  ' + same
  );
}
console.log('共 ' + chain.length + ' 个版本块（跨 ' + new Set(chain.map((c) => c.conv)).size + ' 个会话）');
