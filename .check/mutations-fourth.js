#!/usr/bin/env node
'use strict';
/* mutations-fourth.js —— 第四个独立测试者的变异电池
 *
 * 规则：
 *   expect: ['C3']  期望 C3 报红（逃逸 = 该红没红）
 *   expect: ['!C3'] 期望 C3 **不**报红（假红 = 合法写法被报红）
 * 每条 edit 都作用在 MODE.md 的原文副本上，**不改 MODE.md 本体**。
 *
 * 只找 LIMITATIONS 里**没列出来**的形式；已知的 17 条洞不重复报。
 * 入口是 --file：**只期望 C8 报红**的变异在这里必然记成逃逸（入口限制），本电池不含这类。
 */

// ---- 锚点（每条都验过：在 MODE.md 里只出现 1 次）----
const TOC_E = '| **附录 E** | 自决记录（原 `decisions.md`） | 查"上次为什么这么定" |';
const TOC_D = '| **附录 D** | 复盘（原 `RETRO.md`） | 复盘 / 接手 / 写新规则前 |';
const ANTI = '## 6. 反模式（违反，不是风格问题）';
const ASK = '**ASK 总配额 = 2 次**';
const C7H = '### C.7 文件地图（2026-09-15「清」之后 · 9 → 5）';
const APPB = '## 附录 B · 流水线（原 `PIPELINE.md`）';
const ROW4 = '| 4 | 验收加**增量规则**（增量验 + 最终全量） | `agents/verifier.md` 铁律九 | **已落**（核对：`grep -c "铁律九：" agents/verifier.md` → 1） |';
const ROW5 = '| 5 | 汇总行**分离产品断言与检查器自检** | `agents/verifier.md` 输出格式 | **已落**（核对：`grep -c "检查器自检" agents/verifier.md` → 3） |';
const ROW730 = '> 而其中 4 条的目标（`agents/verifier.md` 的铁律九/十、输出格式、`MODE.md` 附录 A 第 0 节）';
const P1ROW = '| P1 | 指令员程序 + 验收契约 | `agents/` 两个文件（已建） | 派 1 个 2 波次任务，主画面 ≤6 行 |';
const HOOKDIR = '我查的是：`settings.json` 无 `hooks` 键、`hooks/` 目录不存在、';
const REDUCE_HDR = '| 缩减 | 落点 | 状态 |';

module.exports = [

  // ================= C1 目录 → 正文 =================
  { id: 'F01', name: '目录里加一行**不带粗体**的登记行 `| 7 | 幽灵节 | — |`（正文没有第 7 节）',
    expect: ['C1'],
    edit: t => t.replace(TOC_E, TOC_E + '\n| 7 | 幽灵节 | — |') },
  { id: 'F02', name: '（对照）目录里加一行**标准粗体**登记行 `| **7** | 幽灵节 | — |` —— 应命中',
    expect: ['C1'],
    edit: t => t.replace(TOC_E, TOC_E + '\n| **7** | 幽灵节 | — |') },
  { id: 'F26', name: '（假红探针）目录里加一行**说明性**粗体行 `| **注意** | … | — |`（不是登记行）',
    expect: ['!C1'],
    edit: t => t.replace(TOC_E, TOC_E + '\n| **注意** | 附录 A 只打第 0 节 | — |') },

  // ================= C2 正文 → 目录 =================
  { id: 'F03', name: '未登记章节写成 `## 7、幽灵章节`（编号后用顿号，不是 `.`）',
    expect: ['C2'],
    edit: t => t.replace(ANTI, '## 7、幽灵章节\n\n' + ANTI) },
  { id: 'F04', name: '正文新增 `## 附录 F · 测试用`（目录没登记），插在附录 A 之后',
    expect: ['C2'],
    edit: t => t.replace(APPB, '## 附录 F · 测试用\n\n' + APPB) },
  { id: 'F05', name: '删掉目录里的 `附录 D` 登记行（正文 `## 附录 D` 仍在）',
    expect: ['C2'],
    edit: t => t.replace(TOC_D + '\n', '') },
  { id: 'F06', name: '未登记编号章节插在**附录 A 之后**：`## 7. 幽灵` 放在 `## 附录 B` 前',
    expect: ['C2'],
    edit: t => t.replace(APPB, '## 7. 幽灵\n\n' + APPB) },
  { id: 'F27', name: '（对照）附录 A 内部加 `### 8. 幽灵小节`（level 3，按契约不登记）',
    expect: ['!C2'],
    edit: t => t.replace('### 1. Agent Skill 分享站 / 市场（找现成的 SKILL.md）',
      '### 8. 幽灵小节\n\n### 1. Agent Skill 分享站 / 市场（找现成的 SKILL.md）') },

  // ================= C3 单值量 =================
  { id: 'F07', name: '真声明改成 `9 份 → 4`（源值与箭头之间夹一个量词）',
    expect: ['C3'],
    edit: t => t.replace(C7H, '### C.7 文件地图（2026-09-15「清」之后 · 9 份 → 4）') },
  { id: 'F08', name: '（对照）真声明去掉两侧空格 `9→5`（值不变）—— 应命中',
    expect: ['C3'],
    edit: t => t.replace(C7H, '### C.7 文件地图（2026-09-15「清」之后 · 9→4）') },

  // ================= C4 ASK 配额 =================
  { id: 'F09', name: '旧口径改写句式：`ASK 全程可以问 1 次`（无 只有/最多/仅，且「1 次」后不跟配额/提问/询问）',
    expect: ['C4'],
    edit: t => t.replace(ASK, ASK + '\n    - ASK 全程可以问 1 次') },
  { id: 'F10', name: '新增矛盾权威口径：`**ASK 总配额上限 = 3 次**`（配额与分隔符之间夹「上限」）',
    expect: ['C4'],
    edit: t => t.replace(ASK, '**ASK 总配额上限 = 3 次**（新增）\n    - ' + ASK) },

  // ================= C5 活引用 =================
  { id: 'F11', name: '相对**目录**引用（尾斜杠、无扩展名）改名成不存在的：`agents/` → `agents-typo/`',
    expect: ['C5'],
    edit: t => t.replace(P1ROW, P1ROW.replace('`agents/`', '`agents-typo/`')) },
  { id: 'F12', name: 'markdown **相对**链接指向不存在的文件：`[verifier](agents/ghost.md)`',
    expect: ['C5'],
    edit: t => t.replace(ANTI, '[verifier](agents/ghost.md)\n\n' + ANTI) },
  { id: 'F13', name: '`~` 开头但用反斜杠：`` `~\\.workbuddy-ai\\agents\\ghost.md` ``',
    expect: ['C5'],
    edit: t => t.replace('`~/.workbuddy-ai/agents/verifier.md`', '`~\\.workbuddy-ai\\agents\\ghost.md`') },
  { id: 'F28', name: '（假红探针）把「`hooks/` 目录不存在」写成 `hooks/x.md 不存在` —— 句子本身在**断言不存在**',
    expect: ['!C5'],
    edit: t => t.replace(HOOKDIR, '我查的是：`settings.json` 无 `hooks` 键、`hooks/hooks.json` 不存在、') },
  { id: 'F15', name: '（假红探针）提及产品自定义代理目录下的一个文件名：`` `~/.codebuddy/agents/custom.md` ``（未安装）',
    expect: ['!C5'],
    edit: t => t.replace('产品的自定义代理目录是 `~/.codebuddy/agents/`',
      '产品的自定义代理目录是 `~/.codebuddy/agents/`（每个代理一个 `~/.codebuddy/agents/custom.md`）') },

  // ================= C6 跨文件锚点 =================
  { id: 'F16', name: '锚点用 `~/` 前缀的代码跨度：`` `~/.workbuddy-ai/agents/verifier.md` 的铁律十五 ``',
    expect: ['C6'],
    edit: t => t.replace(ROW730, ROW730.replace('`agents/verifier.md` 的铁律九/十', '`~/.workbuddy-ai/agents/verifier.md` 的铁律十五')) },
  { id: 'F17', name: '锚点中间夹一个「里」：`` `agents/verifier.md` 里的铁律十五 ``',
    expect: ['C6'],
    edit: t => t.replace(ROW730, ROW730.replace('`agents/verifier.md` 的铁律九/十', '`agents/verifier.md` 里的铁律十五')) },
  { id: 'F18', name: '（对照）锚点写 `的铁律十五`（无 ~/、无「里」）—— 应命中',
    expect: ['C6'],
    edit: t => t.replace(ROW730, ROW730.replace('`agents/verifier.md` 的铁律九/十', '`agents/verifier.md` 的铁律十五')) },

  // ================= C7 「已落」声明 =================
  { id: 'F19', name: '状态格写成 `√ **已落**`（√ = U+221A，不在格式符剥离集里）且删掉核对命令',
    expect: ['C7'],
    edit: t => t.replace(ROW4, ROW4.replace('**已落**（核对：`grep -c "铁律九：" agents/verifier.md` → 1）', '√ **已落**')) },
  { id: 'F20', name: '（对照）真已落删掉核对命令 —— 应命中',
    expect: ['C7'],
    edit: t => t.replace(ROW4, ROW4.replace('**已落**（核对：`grep -c "铁律九：" agents/verifier.md` → 1）', '**已落**')) },
  { id: 'F21', name: '（假红探针）表格里加一行**状态词汇定义**：`| **已落** | 有可执行核对命令、且命令跑通过 | — |`',
    expect: ['!C7'],
    edit: t => t.replace(REDUCE_HDR, REDUCE_HDR + '\n| **已落** | 有可执行核对命令、且命令已跑通过 | — |') },
  { id: 'F22', name: '（对照）真已落状态格写成 `已落 ✅`，核对命令保留 —— 应不报红',
    expect: ['!C7'],
    edit: t => t.replace(ROW4, ROW4.replace('**已落**（核对：', '已落 ✅（核对：')) },

  // ================= C8 核对命令 =================
  { id: 'F23', name: '（假红探针）命令的文件参数写成等价的 `./agents/verifier.md`（落点列写的是 `agents/verifier.md`）',
    expect: ['!C8'],
    edit: t => t.replace(ROW4, ROW4.replace('`grep -c "铁律九：" agents/verifier.md`', '`grep -c "铁律九：" ./agents/verifier.md`')) },
  { id: 'F24', name: '（假红探针）命令用 `grep -c -e "铁律九：" agents/verifier.md`（合法等价写法）',
    expect: ['!C7'],
    edit: t => t.replace(ROW4, ROW4.replace('`grep -c "铁律九：" agents/verifier.md`', '`grep -c -e "铁律九：" agents/verifier.md`')) },
  { id: 'F25', name: '删掉整行第 5 条「已落」声明（文档别处仍声称「本附录 7 条」）',
    expect: ['C7'],
    edit: t => t.replace(ROW5 + '\n', '') },
];
