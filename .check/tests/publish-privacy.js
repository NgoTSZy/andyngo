#!/usr/bin/env node
/* publish-privacy.js —— 「**发布件不得含本机绝对路径**」的判据（ISS-152 的「未落地的建议」结项）
 *
 * 由来：ISS-152 的原文写着 ——「『发布件不得含本机绝对路径』目前**只靠人工脱敏**，**没有判据守着**
 *   —— 可加一条判据扫发布副本 + 载体源码」。用户长期指令的口径：「**丙类 · 根本不该由人判：
 *   应该由判据判的 → 去加判据，不是去问人**」。
 *
 * 判什么（扫描面 = **两处发布件**）：
 *   S1  `skills/` 下所有文本文件 —— 这是 `package_skill.py` 打进 `dist/andyngo.zip` 的那一集
 *   S2  `.check/tmp/publish/`（发布副本，若存在）—— 这是推到 GitHub 的那一集
 *   **R1**：两处都**不得含本机家目录路径**。本机用户名**运行时**从 `os.homedir()` 取，**不写死**
 *          （写死用户名 = 换个用户/换台机器就失效，同 ISS-140「写死的值是腐烂源」）。
 *
 * ★ 为什么判「**真实家目录**」而不是判「**形状**」（**实测教训，不是推测**）：
 *   第一版按**形状**判（`[Cc]:[\\/]+Users[\\/]+[A-Za-z0-9._-]+` 一族）⇒ 在真实树上**假红 34 处**：
 *   发布副本里 **8 个不同匹配串全是占位符**（`C:/Users/x` ×9 · `/c/Users/...` ×11 · `C:\c\Users\...` ×9 …），
 *   **没有一个是真用户名**。判「形状」= 把占位符当泄漏 ⇒ 一个**总是响**的警报（DEC-019）。
 *   改判「**本机真实家目录**的写法」后：真实树命中 **0**。
 *   ★ 纪律：**先量误伤再上线**（本文件头这段就是那次测量的结论）。
 *
 * ★ 五种写法（同一路径在源树里的全部形态；与 `.check/tmp/pub-diff2.py` 的归一化表是同一份知识）：
 *     `C:\Users\<u>` · `C:/Users/<u>` · `/c/Users/<u>` · `C:\\Users\\<u>`（JSON/JS 双反斜杠） · `C:\c\Users\<u>`
 *   （最后一种是 POSIX 路径原样拼给原生 node.exe 的产物）
 *
 * 退出码（三态，**不许合并**）：0 通过 · 1 命中 · 2 拒跑
 *   `2` = 「**没跑成 ≠ 通过**」：`skills/` 不存在 / 取不到本机用户名 / **扫描面为空** ⇒ 拒跑，不报 OK。
 *
 * ★ 已知边界（写在文件里，不假装已覆盖）：
 *   ① 只判**文本**文件（含 NUL 的按二进制跳过）；
 *   ② 只判**本机**家目录路径 —— 别人的机器路径、非 C 盘、`%USERPROFILE%` 这类变量写法**不判**；
 *   ③ **不判**带省略号的占位写法（如注释里的 `C:\c\Users\...`）—— 实测它不是真路径；
 *   ④ 它**不保证发布件「没有隐私」**，只保证「**没有本机家目录路径**」这一件事。
 *
 * 用法：node .check/tests/publish-privacy.js [--inject]
 *   `--inject`：在**内存里**喂变异输入，逐条断言「必须报红」；最后一条是**假红守门人**
 *               （无关变异**不得**报红）。**全程不碰磁盘。**
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');   // .check/tests/ -> 工作区根
const SKILLS = path.join(ROOT, 'skills');
const PUBLISH = path.join(ROOT, '.check', 'tmp', 'publish');
const SKIP_DIRS = ['.git', 'node_modules'];

/* ---------- 取本机用户名（运行时，不写死） ---------- */
function userName() {
  const h = os.homedir().replace(/\\/g, '/');
  const m = h.match(/\/Users\/([^/]+)$/i);
  return m ? m[1] : null;
}

/* ---------- 五种写法（**纯字符串**，不做正则转义 —— 转义正是 mojibake/假空的常见来源） ---------- */
function shapes(u) {
  return [
    ['盘符反斜杠  C:\\Users\\<u>', 'c:\\users\\' + u],
    ['盘符正斜杠  C:/Users/<u>', 'c:/users/' + u],
    ['JSON 双反斜杠 C:\\\\Users\\\\<u>', 'c:\\\\users\\\\' + u],
    ['POSIX 式    /c/Users/<u>', '/c/users/' + u],
    ['C:\\c\\Users\\<u>（node.exe 产物）', 'c:\\c\\users\\' + u],
  ];
}

/* ---------- 纯函数判定体（--inject 直接喂它） ----------
 * items = [{ file, text }]，u = 用户名（小写）
 * 返回命中列表 [{file, shape, line, snip}] */
function judge(items, u) {
  const out = [];
  if (!u) return out;
  const SH = shapes(u);
  items.forEach(it => {
    const low = it.text.toLowerCase();
    SH.forEach(([name, lit]) => {
      let i = low.indexOf(lit);
      if (i === -1) return;
      const line = it.text.slice(0, i).split('\n').length;
      out.push({ file: it.file, shape: name, line: line, snip: it.text.substr(i, lit.length + 12) });
    });
  });
  return out;
}

/* ---------- 拒跑判定（纯函数，便于 --inject 断言） ---------- */
function refuseReason(nFiles, u) {
  if (!u) return '取不到本机用户名（`os.homedir()` 里没有 `/Users/<name>`）⇒ 扫描面无法定义';
  if (nFiles === 0) return '扫描面为空（0 个文本文件）⇒ 「一个都没扫到」不等于「没有泄漏」';
  return null;
}

/* ---------- 读磁盘 ---------- */
function collect(dir, label, out) {
  let n = 0;
  (function walk(d) {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      if (e.isDirectory()) { if (SKIP_DIRS.indexOf(e.name) === -1) walk(path.join(d, e.name)); continue; }
      const p = path.join(d, e.name);
      let buf;
      try { buf = fs.readFileSync(p); } catch (e2) { continue; }
      if (buf.indexOf(0) !== -1) continue;                    // 二进制（含 NUL）跳过
      out.push({ file: label + '/' + path.relative(dir, p).replace(/\\/g, '/'), text: buf.toString('utf8') });
      n++;
    }
  })(dir);
  return n;
}

function refuse(msg) {
  console.log('REFUSE ' + msg);
  console.log('结论：拒跑（**没跑成 ≠ 通过**）');
  process.exit(2);
}

/* ---------- 反向注入 ---------- */
if (process.argv.indexOf('--inject') !== -1) {
  const U = 'someuser';
  const base = [{ file: 'S1/x.sh', text: 'echo hello\n# 无关内容\n' }];
  const V = [
    { name: '真路径 · 盘符反斜杠', items: [{ file: 'S1/a', text: 'p = C:\\Users\\' + U + '\\x' }], hit: true },
    { name: '真路径 · 盘符正斜杠', items: [{ file: 'S1/b', text: 'p = C:/Users/' + U + '/x' }], hit: true },
    { name: '真路径 · JSON 双反斜杠', items: [{ file: 'S1/c', text: '{"p":"C:\\\\Users\\\\' + U + '\\\\x"}' }], hit: true },
    { name: '真路径 · POSIX 式', items: [{ file: 'S1/d', text: 'p = /c/Users/' + U + '/x' }], hit: true },
    { name: '真路径 · C:\\c\\Users（node.exe 产物）', items: [{ file: 'S1/e', text: 'p = C:\\c\\Users\\' + U + '\\x' }], hit: true },
    { name: '真路径 · 大小写混写（Windows 不区分）', items: [{ file: 'S1/f', text: 'p = c:/USERS/' + U.toUpperCase() + '/x' }], hit: true },
    { name: '★ 假红守门人 · 占位符 `C:/Users/x`', items: [{ file: 'S1/g', text: '例：C:/Users/x/foo' }], hit: false },
    { name: '★ 假红守门人 · 省略号 `/c/Users/...`', items: [{ file: 'S1/h', text: '例：/c/Users/.../newid.js' }], hit: false },
    { name: '★ 假红守门人 · 省略号 `C:\\c\\Users\\...`', items: [{ file: 'S1/i', text: "Cannot find module 'C:\\c\\Users\\...\\newid.js'" }], hit: false },
    { name: '★ 假红守门人 · 脱敏占位 `<user>`', items: [{ file: 'S1/j', text: 'p = C:/Users/<user>/x' }], hit: false },
    { name: '★ 假红守门人 · 用户名单独出现（skill 名就是它）', items: [{ file: 'S1/k', text: 'skills/andyngo/scripts/andyngo-audit.sh' }], hit: false },
    { name: '★ 假红守门人 · 无关变异（改别的字符串）', items: base.concat([{ file: 'S1/l', text: 'foo → bar\n' }]), hit: false },
  ];
  console.log('=== 反向注入（每条都必须复现缺陷；守门人必须不报红）===');
  let bad = 0;
  V.forEach(v => {
    const f = judge(v.items, U);
    if (v.hit) {
      if (f.length > 0) console.log('  OK   ' + v.name + ' → 如预期报红: ' + f[0].shape);
      else { console.log('  FAIL ' + v.name + ' → 未复现缺陷（该断言是假绿）'); bad++; }
    } else {
      if (f.length === 0) console.log('  OK   ' + v.name + ' → 如预期**不报红**');
      else { console.log('  FAIL ' + v.name + ' → 无关变异却报红（假红）: ' + f[0].file + ' ' + f[0].shape); bad++; }
    }
  });
  // 空集也要防
  const rr0 = refuseReason(0, U);
  if (rr0) console.log('  OK   空集守门人 → 扫描面为 0 时报拒跑（不是通过）');
  else { console.log('  FAIL 空集守门人 → 扫描面为 0 时没有拒跑'); bad++; }
  const rr1 = refuseReason(5, null);
  if (rr1) console.log('  OK   无用户名守门人 → 取不到用户名时报拒跑');
  else { console.log('  FAIL 无用户名守门人 → 取不到用户名时没有拒跑'); bad++; }
  console.log(bad === 0
    ? '反向注入 ' + (V.length + 2) + '/' + (V.length + 2) + ' 全部符合预期'
    : '反向注入有 ' + bad + ' 条不符合预期');
  process.exit(bad === 0 ? 0 : 1);
}

/* ---------- 正常模式 ---------- */
const U = userName();
const items = [];
if (!fs.existsSync(SKILLS)) refuse('找不到发布件源目录: ' + SKILLS);
const nS1 = collect(SKILLS, 'skills', items);
let nS2 = 0;
const hasPub = fs.existsSync(PUBLISH);
if (hasPub) nS2 = collect(PUBLISH, 'publish', items);

const rr = refuseReason(items.length, U);
if (rr) refuse(rr);

console.log('本机用户名（运行时取）: ' + U);
console.log('扫描面 S1 `skills/` = ' + nS1 + ' 个文本文件' +
  (hasPub ? ' · S2 发布副本 = ' + nS2 + ' 个' : ' · S2 发布副本**不存在**（未纳入本次扫描）'));
const fails = judge(items, U.toLowerCase());
fails.forEach(f => console.log('FAIL ' + f.file + ':' + f.line + ' 【' + f.shape + '】 ' + f.snip));
console.log(fails.length === 0
  ? '结论：OK 两处发布件**均无本机家目录路径**（扫描 ' + items.length + ' 个文本文件 · 命中 0）'
  : '结论：FAIL ' + fails.length + ' 处含本机家目录路径');
process.exit(fails.length === 0 ? 0 : 1);
