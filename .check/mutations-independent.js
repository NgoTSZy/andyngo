#!/usr/bin/env node
'use strict';
/* mutations-independent.js —— 独立变异测试（第三方，非 check-protocol.js 作者）
 *
 * 目的：专打 check-protocol.js 自带 13 条变异**没想到**的形态。
 * 手法：把 check-protocol.js 的头部（run 之前的全部逻辑）抽出来当模块用，
 *       于是我的变异走的是**同一个 run()**，不存在「我另写了一个宽松的实现」这种解释。
 * 只读被审文件：`MODE.md` + `refs/*.md`（文件集由 `.check/fileset.js` 定义）只读，从不写回。
 */

const fs = require('fs');
const path = require('path');

const CHECK = path.join(__dirname, 'check-protocol.js');
const CHECK_DIR = __dirname;
const HOME = path.resolve(__dirname, '..');
const MODE = path.join(HOME, 'MODE.md');

// ---- 抽取 run()：切掉自带的「变异测试」段与 CLI 段，只留函数定义
const src = fs.readFileSync(CHECK, 'utf8');
const cutAt = src.indexOf('// ---------------------------------------------------------------- 变异测试');
if (cutAt < 0) { console.error('抽取失败：找不到「变异测试」分隔注释'); process.exit(2); }
// new Function 不认 shebang —— 先剥掉首行 #!
const head = src.slice(0, cutAt).replace(/^#![^\n]*\n/, '') + '\nmodule.exports = { run, parseTocLabels };\n';
const mod = { exports: {} };
new Function('module', 'exports', 'require', '__dirname', '__filename', head)(
  mod, mod.exports, require, CHECK_DIR, CHECK);
const run = mod.exports.run;
if (typeof run !== 'function') { console.error('抽取失败：run 不是函数'); process.exit(2); }

/* 【2026-09-15 期 1 适配】原来只读 `MODE.md`。附录拆到 `refs/` 之后，
 * 单读 `MODE.md` 的基线已经不干净（实测：非 PASS C3,C6,C7,C8），
 * 于是本电池打印「基线不干净，先停」，**一条变异都没跑**。
 * 这是拆文件欠的债：`run-battery.js` 当时跟着改了，这个自备跑手没改。
 * 文件集的定义只有一份（`.check/fileset.js`），这里跟它走 —— 不再自己读 `MODE.md`。 */
const fsx = require('./fileset.js').buildFileSet();
const runOn = (text) => run(text, MODE, fsx.segs);
const base = fsx.text;
const baseRes = runOn(base);
const baseBad = baseRes.filter(r => r.state !== 'PASS').map(r => r.id);

console.log('基线（同一 run()）：' + (baseBad.length ? '非 PASS ' + baseBad.join(',') : '全部 PASS'));
if (baseBad.length) { console.log('基线不干净，先停'); process.exit(2); }
console.log('');

const MUTATIONS = [
  { id: 'M1', marker: "ASK 总配额 = 3 次", expect: ['C4'], name: 'C4 · 插入第二条**与权威口径矛盾**的配额声明（ASK 总配额 = 3 次）',
    edit: t => t.replace(
      '- **ASK 总配额 = 2 次**（G3 确认计划与最终目的 + G4 三方案选一）',
      '- **ASK 总配额 = 2 次**（G3 确认计划与最终目的 + G4 三方案选一）\n    - 补充口径：**ASK 总配额 = 3 次**') },

  { id: 'M2', marker: "ASK 全程只有 1 次提问配额", expect: ['C4'], name: 'C4 · 旧口径换同义词（「1 次提问配额」而非「1 次配额」）',
    edit: t => t.replace(
      '- **ASK 总配额 = 2 次**（G3 确认计划与最终目的 + G4 三方案选一）',
      '- **ASK 总配额 = 2 次**（G3 确认计划与最终目的 + G4 三方案选一）\n    - 旧口径（已废弃）：ASK 全程只有 1 次提问配额。') },

  { id: 'M3', marker: "**已落 ✅", expect: ['C7'], name: 'C7 · 已落写成 `**已落 ✅ 2026-09-15**`（粗体内多带字符，且无核对命令）',
    edit: t => t.replace('| **已落**（核对：`grep -c "铁律九：" agents/verifier.md` → 1） |',
                         '| **已落 ✅ 2026-09-15** |') },

  { id: 'M4', marker: "agents/verifier.md`）", expect: ['C8'], name: 'C8 · 删掉核对命令的**期望值**（只留命令，不留 → N）',
    edit: t => t.replace('核对：`grep -c "铁律九：" agents/verifier.md` → 1',
                         '核对：`grep -c "铁律九：" agents/verifier.md`') },

  { id: 'M5', marker: "9 → 7（不是", expect: ['C3'], name: 'C3 · 新值写在同一行且该行含「不是」（整行被当否定句跳过）',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）',
                         '合并后文件数：9 → 7（不是 9 → 5 的旧说法）。\n\n## 6. 反模式（违反，不是风格问题）') },

  { id: 'M6', marker: "9→7", expect: ['C3'], name: 'C3 · 新值用**无空格箭头**写（9→7，落进「专名」口径）',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）',
                         '合并后文件数：9→7。\n\n## 6. 反模式（违反，不是风格问题）') },

  { id: 'M7', marker: "模板 铁律", expect: ['C6'], name: 'C6 · 模板锚点写成目标文件里**恰好是子串**的词（`agents/verifier.md` 模板 铁律）',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）',
                         '跨文件锚点：`agents/verifier.md` 模板 铁律。\n\n## 6. 反模式（违反，不是风格问题）') },

  { id: 'M8', marker: "→ 1（同 agents/verifier.md）", expect: ['C8'], name: 'C8 · 换掉核对命令的文件参数，并在**同一行别处**补提该文件（绕过 D11 的文件身份检查）',
    edit: t => t.replace('核对：`grep -c "M1 变异测试" agents/dispatcher.md` → 1',
                         '核对：`grep -c "M1 变异测试" agents/verifier.md` → 1（同 agents/verifier.md）') },

  { id: 'M9', marker: "check-protocol-typo.js", expect: ['C5'], name: 'C5 · 活引用改成一个不存在的**非 .md** 路径（check-protocol.js → typo.js）',
    edit: t => t.replace('`~/.workbuddy-ai/.check/check-protocol.js`',
                         '`~/.workbuddy-ai/.check/check-protocol-typo.js`') },

  { id: 'M10', marker: " | **7** | 不存在的节", expect: ['C1'], name: 'C1 · 目录里插一行带**前导空格**的 `| **7** |`（正则锚 ^\\| 失效）',
    edit: t => t.replace('| **6** | 反模式 | 自查 |',
                         '| **6** | 反模式 | 自查 |\n | **7** | 不存在的节 | — |') },

  { id: 'M11', marker: "## 7. 幽灵节", expect: ['C1'], name: 'C1+C2 · 目录登记 **7**，正文的 `## 7.` 藏在**代码块**里',
    edit: t => t.replace('| **6** | 反模式 | 自查 |',
                         '| **6** | 反模式 | 自查 |\n| **7** | 幽灵节 | — |')
                .replace('## 6. 反模式（违反，不是风格问题）',
                         '```text\n## 7. 幽灵节\n```\n\n## 6. 反模式（违反，不是风格问题）') },

  { id: 'M12', marker: "不可核对：历史记录，不改写", expect: ['C7'], name: 'C7+C8 · 7 条已落里 **6 条**把核对命令整段换成「不可核对：历史记录，不改写」（只留 1 条真命令）',
    edit: t => { let first = true; return t.split('\n').map(l => {
      if (!/\*\*已落\*\*/.test(l)) return l;
      if (first) { first = false; return l; }
      return l.replace(/（核对：`grep[^`]*`[^）]*）/, '（不可核对：历史记录，不改写）');
    }).join('\n'); } },

  { id: 'M14', marker: "grep -c \"铁律\" agents/verifier.md", expect: ['C8'], name: 'C8 · 删掉期望值 **且**把核对命令换成一条计数=11 的命令（计数错了但没人比）',
    edit: t => t.replace('核对：`grep -c "铁律九：" agents/verifier.md` → 1',
                         '核对：`grep -c "铁律" agents/verifier.md`') },

  { id: 'M13', marker: "## 附录 F · 新附录", expect: ['C2'], name: 'C1/C2 口径对照 · 新增**合法**的附录 F（目录登记 + 正文标题都有）',
    edit: t => t.replace('| **附录 E** | 自决记录（原 `decisions.md`） | 查"上次为什么这么定" |',
                         '| **附录 E** | 自决记录（原 `decisions.md`） | 查"上次为什么这么定" |\n| **附录 F** | 新附录 | — |')
                .replace('## 6. 反模式（违反，不是风格问题）',
                         '## 附录 F · 新附录\n\n## 6. 反模式（违反，不是风格问题）') },
];

let hit = 0, esc = 0, anchorMiss = 0;
const escapes = [];

for (const mu of MUTATIONS) {
  const mutated = mu.edit(base);
  if (mutated === base) { anchorMiss++; console.log('??  ' + mu.id + ' 锚点没匹配上（变异没生效）| ' + mu.name); continue; }
  const res = runOn(mutated);
  const got = res.filter(r => r.state === 'FAIL').map(r => r.id);
  const unv = res.filter(r => r.state === 'UNVERIFIED').map(r => r.id);
  const want = mu.expect[0];
  const ok = got.includes(want);
  if (ok) hit++; else { esc++; escapes.push({ mu, got, unv }); }
  console.log((ok ? 'OK  ' : 'ESC ') + mu.id + ' 期望 ' + mu.expect.join('/') + ' | 实际报红 [' +
    (got.join(',') || '无') + ']' + (unv.length ? ' ⚠UNVERIFIED[' + unv.join(',') + ']' : '') + ' | ' + mu.name);
}
console.log('----');
console.log('变异 ' + MUTATIONS.length + ' 条，命中 ' + hit + '，逃逸 ' + esc + (anchorMiss ? '，锚点未命中 ' + anchorMiss : ''));
for (const e of escapes) {
  console.log('  ESC ' + e.mu.id + ' → 期望 ' + e.mu.expect[0] + ' 报红，实际 [' + (e.got.join(',') || '无') + ']');
}

// ---- 探针：把校验器**实际看到的**内容打出来，证明逃逸不是「变异没生效」
const PROBE = MUTATIONS.map(x => x.id);
console.log('\n===== 探针（校验器实际看到什么） =====');
for (const id of PROBE) {
  const mu = MUTATIONS.find(x => x.id === id);
  const mutated = mu.edit(base);
  if (mutated === base) { console.log(id + '：变异未生效'); continue; }
  const res = runOn(mutated);
  console.log('-- ' + id + ' 文本已含标记串 [' + mu.marker + ']=' + mutated.includes(mu.marker) + '，与原文不同=' + (mutated !== base));
  for (const cid of mu.expect) {
    const c = res.find(x => x.id === cid);
    console.log('   ' + cid + ' state=' + c.state + ' notes=' + JSON.stringify(c.notes) + ' fails=' + JSON.stringify(c.fails));
  }
}
