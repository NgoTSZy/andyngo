#!/usr/bin/env node
'use strict';
/* mutations-fourth2.js —— 第四个独立测试者 · 第二轮
 * 打的是作者第四次改动的 13 处新代码（C5 缺席窗口 / C5 目录与链接 / C6 连接词 /
 * C4 量词窗口 / C1·C2 顿号 / C7 新声明判据）。
 * expect: ['C5'] 期望报红；['!C5'] 期望**不**报红（假红）。
 * 只读 MODE.md，不改它；只读 check-protocol.js，不改它。
 */

const TOC_E = '| **附录 E** | 自决记录（原 `decisions.md`） | 查"上次为什么这么定" |';
const ANTI = '## 6. 反模式（违反，不是风格问题）';
const ASK = '**ASK 总配额 = 2 次**';
const ROW4 = '| 4 | 验收加**增量规则**（增量验 + 最终全量） | `agents/verifier.md` 铁律九 | **已落**（核对：`grep -c "铁律九：" agents/verifier.md` → 1） |';
const ROW730 = '> 而其中 4 条的目标（`agents/verifier.md` 的铁律九/十、输出格式、`MODE.md` 附录 A 第 0 节）';
const R712 = '| `~/.workbuddy-ai/agents/verifier.md` | 验收代理契约（11 条铁律）。**要注入子代理，所以必须独立** | G6 派验收时 |';
const R488 = '4. **任何动效方案必看 `easings.net`**，它是事实标准';
const R524 = '| **做动效** | 第 7.6 节（`easings.net` 必看） |';

module.exports = [

  // ============ C5 新增的「陈述缺席」窗口（怀疑太宽）============
  // 【已知·LIMITATIONS 第 1154 行已列】这 3 条**不是新洞**，是拿 A/B 对照确认那条自陈的代价真的存在。
  { id: 'G01', name: '[已知·LIMITATIONS 已列] 失效活引用，后窗 6 字内有「没有」但语义无关（没有任何豁免）',
    expect: ['C5'],
    edit: t => t.replace(R712, '| `~/.workbuddy-ai/agents/verifier-typo.md` | 没有任何豁免条款 | G6 派验收时 |') },
  { id: 'G02', name: '[已知·LIMITATIONS 已列] 失效活引用，前窗 6 字内有「没有」但语义无关（落点没有变：）',
    expect: ['C5'],
    edit: t => t.replace(ANTI, '落点没有变：`agents/ghost.md`\n\n' + ANTI) },
  { id: 'G03', name: '[已知·LIMITATIONS 已列] 失效活引用，后窗内有「缺失」但指的是别的东西（缺失的部分见附录 B）',
    expect: ['C5'],
    edit: t => t.replace(ANTI, '| `agents/dispatcher-typo.md` | 缺失的部分见附录 B |\n\n' + ANTI) },
  { id: 'G19', name: '（对照）失效活引用，缺席词落在窗口**之外**（第 7 字起）—— 应报红',
    expect: ['C5'],
    edit: t => t.replace(ANTI, '这条引用没有任何问题，落点是 `agents/ghost.md`\n\n' + ANTI) },

  // ============ C5 新增的目录引用 / 相对链接判据 ============
  { id: 'G04', name: '（假红探针）代码跨度里写**域名 + 尾斜杠**：`easings.net/` —— 不是本机目录',
    expect: ['!C5'],
    edit: t => t.replace(R488, '4. **任何动效方案必看 `easings.net/`**，它是事实标准') },
  { id: 'G05', name: '（假红探针）markdown 链接指向**无协议的外部站**：`[缓动参考](easings.net)`',
    expect: ['!C5'],
    edit: t => t.replace(R524, '| **做动效** | 第 7.6 节（[缓动参考](easings.net) 必看） |') },
  { id: 'G06', name: '（假红探针）**描述缺席的链接**：`[旧契约已删除](agents/old-contract.md)`（同句写代码跨度时被缺席窗口放行）',
    expect: ['!C5'],
    edit: t => t.replace(ANTI,
      '[旧契约已删除](agents/old-contract.md)\n旧契约已删除 `agents/old-contract.md`\n\n' + ANTI) },

  // ============ C6 新增的连接词窗口 / `~` 字符类 ============
  { id: 'G07', name: '（假红探针）句子在**描述锚点已消失**：`agents/verifier.md` 中的模板 2b 已删除',
    expect: ['!C6'],
    edit: t => t.replace(ROW730,
      '> 原落点 `agents/verifier.md` 中的模板 2b 已随技能改薄指针而消失，已迁到 JOB 模板（见下文）') },
  { id: 'G08', name: '锚点用**反斜杠**路径（C5 归一了，C6 没归一）：`~\\.workbuddy-ai\\agents\\verifier.md` 铁律十五',
    expect: ['C6'],
    edit: t => t.replace(ROW730, ROW730.replace('`agents/verifier.md` 的铁律九/十',
      '`~\\.workbuddy-ai\\agents\\verifier.md` 的铁律十五')) },
  { id: 'G09', name: '[已知·LIMITATIONS 已列] 锚点连接词用「上的」（枚举集外的连接词）`agents/verifier.md` 上的铁律十五',
    expect: ['C6'],
    edit: t => t.replace(ROW730, ROW730.replace('`agents/verifier.md` 的铁律九/十',
      '`agents/verifier.md` 上的铁律十五')) },

  // ============ C4 新增的量词窗口 ============
  { id: 'G10', name: '第二条矛盾口径用**未列量词**：`**ASK 总配额的总次数 = 3 次**`',
    expect: ['C4'],
    edit: t => t.replace(ASK, '**ASK 总配额的总次数 = 3 次**（新增）\n    - ' + ASK) },
  { id: 'G11', name: '第二条矛盾口径用「是」当分隔符：`**ASK 总配额是 3 次**`',
    expect: ['C4'],
    edit: t => t.replace(ASK, '**ASK 总配额是 3 次**（新增）\n    - ' + ASK) },
  { id: 'G12', name: '（对照）第二条矛盾口径用已列量词 `上限`：`**ASK 总配额上限 = 3 次**` —— 应报红',
    expect: ['C4'],
    edit: t => t.replace(ASK, '**ASK 总配额上限 = 3 次**（新增）\n    - ' + ASK) },

  // ============ C7 新的声明判据（\p{L}\p{N} 之前不许有内容）============
  { id: 'G13', name: '状态格写成 `1️⃣ **已落**`（keycap 数字前缀，数字是 \\p{N}）且删掉核对命令',
    expect: ['C7'],
    edit: t => t.replace(ROW4, ROW4.replace('**已落**（核对：`grep -c "铁律九：" agents/verifier.md` → 1）',
      '1\uFE0F\u20E3 **已落**')) },
  { id: 'G14', name: '（对照）状态格写成 `√ **已落**` 且删掉核对命令 —— 应报红（F19 的回归）',
    expect: ['C7'],
    edit: t => t.replace(ROW4, ROW4.replace('**已落**（核对：`grep -c "铁律九：" agents/verifier.md` → 1）',
      '√ **已落**')) },

  // ============ C1 / C2 新增的顿号分隔符 ============
  { id: 'G15', name: '正文新增 `## 附录F · 幽灵附录`（附录与字母间**无空格**，目录也没登记）',
    expect: ['C2'],
    edit: t => t.replace(ANTI, '## 附录F · 幽灵附录\n\n' + ANTI) },
  { id: 'G16', name: '（假红探针）目录登记行与正文标题**写法一致**都带顿号：`| **7、** |` + `## 7、幽灵节`',
    expect: ['!C2'],
    edit: t => t.replace(TOC_E, TOC_E + '\n| **7、** | 幽灵节 | — |')
      .replace(ANTI, '## 7、幽灵节\n\n' + ANTI) },
  { id: 'G17', name: '正文新增 `## 7 幽灵节`（编号后**无分隔符**，目录也没登记）',
    expect: ['C2'],
    edit: t => t.replace(ANTI, '## 7 幽灵节\n\n' + ANTI) },
  { id: 'G18', name: '（对照）目录 `| **7** |` 与正文 `## 7、幽灵节` 都登记了 —— 应不报红',
    expect: ['!C2'],
    edit: t => t.replace(TOC_E, TOC_E + '\n| **7** | 幽灵节 | — |')
      .replace(ANTI, '## 7、幽灵节\n\n' + ANTI) },
];
