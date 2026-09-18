#!/usr/bin/env node
'use strict';
/* mutations-thirdparty2.js —— 第三方-2 独立变异电池（41 条，原样保存）
 *
 * ⚠ 本文件顶部这段注释里有一段「逐条状态」表，由脚本自动生成后回填。
 *   STATUS-TABLE-BEGIN
 *   【当前状态】在 MODE.md 1469 行 / md5 87fe80d1… + check-protocol.js 现行版上重算：
 *     命中 30 / 逃逸 9 / 锚点失配 0
 *     ⚠ 这不代表我当时的结论被推翻：当时的 10/31 是钉住 610 行版本 + 旧 MODE.md 的结果。
 *     这一列是「作者修完之后，同一条变异现在能不能被抓住」。
 *
 *   | id | expect | 当时 | 现在 |
 *   |---|---|---|---|
 *   | N1 | C3 | 逃逸 | NOW-HIT 实际红[C3] |
 *   | N2 | C3 | 逃逸 | NOW-HIT 实际红[C3] |
 *   | N3 | C3 | 逃逸 | NOW-HIT 实际红[C3] |
 *   | N4 | C3 | 逃逸 | NOW-HIT 实际红[C3] |
 *   | N5 | C4 | 逃逸 | NOW-HIT 实际红[C4] |
 *   | N6 | C4 | 逃逸 | NOW-HIT 实际红[C4] |
 *   | N7 | C4 | 逃逸 | NOW-HIT 实际红[C4] |
 *   | N8 | C5 | 逃逸 | NOW-HIT 实际红[C5] |
 *   | N9 | C5 | 逃逸 | NOW-HIT 实际红[C5] |
 *   | N10 | C5 | 逃逸 | NOW-ESCAPE 实际红[无] |
 *   | N11 | C5 | 逃逸 | NOW-ESCAPE 实际红[无] |
 *   | N12 | C6 | 命中 | NOW-HIT 实际红[C6] |
 *   | N13 | C6 | 逃逸 | NOW-ESCAPE 实际红[无] |
 *   | N14 | C7 | 逃逸 | NOW-HIT 实际红[C7] |
 *   | N15 | C7 | 逃逸 | NOW-HIT 实际红[C7] |
 *   | N16 | C7 | 逃逸 | NOW-HIT 实际红[C7] |
 *   | N17 | C8 | 逃逸 | NOW-HIT 实际红[C8] |
 *   | N18 | C8 | 逃逸 | NOW-HIT 实际红[C8] |
 *   | N19 | C8 | 逃逸 | NOW-ESCAPE 实际红[无] |
 *   | N20 | C2 | 逃逸 | NOW-HIT 实际红[C2] |
 *   | N21 | C1 | 逃逸 | NOW-HIT 实际红[C1] |
 *   | N22 | C4 | 逃逸 | NOW-HIT 实际红[C4] |
 *   | N23 | !C3 | 命中 | NOW-HIT 实际红[无] |
 *   | N24 | C8 | 命中 | （落盘类）内存判定不可信 实际红[无] |
 *   | N25 | C8 | 逃逸 | （落盘类）内存判定不可信 实际红[C8] |
 *   | N26 | C7 | 逃逸 | NOW-HIT 实际红[C7] |
 *   | N27 | C7 | 命中 | NOW-HIT 实际红[C7] |
 *   | N28 | C6 | 逃逸 | NOW-HIT 实际红[C6] |
 *   | N29 | C5 | 逃逸 | NOW-HIT 实际红[C5] |
 *   | N30 | C2 | 命中 | NOW-HIT 实际红[C2] |
 *   | N31 | C6 | 命中 | NOW-HIT 实际红[C6] |
 *   | N32 | C4 | 逃逸 | NOW-HIT 实际红[C4] |
 *   | N33 | C7 | 逃逸 | NOW-ESCAPE 实际红[无] |
 *   | N34 | C5 | 逃逸 | NOW-ESCAPE 实际红[无] |
 *   | N35 | C3 | 逃逸 | NOW-ESCAPE 实际红[无] |
 *   | N36 | C5 | 命中 | NOW-HIT 实际红[C5] |
 *   | N37 | C5 | 命中 | NOW-HIT 实际红[C5] |
 *   | N38 | C5 | 逃逸 | NOW-ESCAPE 实际红[无] |
 *   | N39 | C1 | 命中 | NOW-HIT 实际红[C1,C2] |
 *   | N40 | C5 | 逃逸 | NOW-ESCAPE 实际红[无] |
 *   | N41 | C5 | 命中 | NOW-HIT 实际红[C5] |
 *
 *   【不修项】作者在 check-protocol.js 的 LIMITATIONS 常量里明写不修的：
 *     N10（C5 豁免按文件名全局生效）、N11（活引用不写代码跨度就不枚举）、
 *     N13（C6 锚点不写反引号就不枚举）、N19（C8 非表格行的落点退化）、
 *     N34（C5 正文里不带反引号的失效路径不判存在性）、N40（裸文件名只认硬编码的那一个）。
 *     N4（C3 选项专名靠紧邻词判定）标为「已收窄未消除」。
 *
 *   【仍未写进 LIMITATIONS 的逃逸 · 请作者定夺】
 *     N33 —— 假「已落」整条包进代码跨度（`` `**已落 ✅**` ``）被 C7 的「引述不算声明」放行；
 *     N35 —— 真声明包进反引号（`` `9 → 7` ``）被 C3 的引述豁免放行，等于文档只在引述里报数；
 *     N38 —— 通配符引用 `skills/[*]/SKILL.md` 被截断成 `skills/`（目录存在 → 永远 PASS），
 *            而 MODE.md 自己也用这个写法描述技能发现路径。
 *     这三条是「放宽口径」与「引述豁免」这两条新规则自带的代价，不在原 5 条不修清单里。
 *
 *   【本文件不做的事】它不参与 --mutate 的自检，也不会自动跑 ——
 *     一条「期望报红但已明写不修」的变异会变成永远红的断言，那会训练人忽略红色。
 *     要看结论请读 check-protocol.js 的 LIMITATIONS 段与 MODE.md 的残洞记录。
 *   STATUS-TABLE-END
 *
 * 出处与条件
 * ----------
 * 作者：general-purpose-6（团队 _auto_423df6fe 的第三方-2 测试者，与 check-protocol.js 作者无关）
 * 时间：2026-09-15
 * 被审版本：check-protocol.js 610 行 / md5 0fad0051…（会话中途作者改过校验器，580 → 610 行，
 *           我当场快照后钉住这一版测试，避免「测的是哪一版」说不清）
 * 被审文档：MODE.md md5 1d1a6225…（当时的版本）
 * 手法：把 check-protocol.js 的 run() 之前的部分抽成模块，走**同一个 run()**，
 *       变异只在内存字符串上做，从不写回 MODE.md。
 *
 * 当时的结果（钉住版本上的实测）
 * ----------------------------
 * 41 条变异 → **10 命中 / 31 逃逸**。
 * 命中：N12 N23 N24 N27 N30 N31 N36 N37 N39 N41
 * 逃逸：其余 31 条（N1–N11、N13–N22、N25 N26 N28 N29 N32–N35 N38 N40）
 * 对照：同一次会话里我复核了作者修过的 E1–E13，**13/13 全部真的堵上了**。
 * 所以「E 组全绿 + N 组 31 条逃逸」这两件事同时为真 —— 前者说明那一轮修复有效，
 * 后者说明**校验器整体仍然是正则启发式，一个字符级的改动就能绕过**。
 *
 * 本文件的性质
 * ------------
 * **这是证据快照，不是回归测试。** 里面的 edit 一律保持我当时跑的那一份，
 * 不重写、不改进、不为了让它「跑得通」而改锚点。
 * 因此：MODE.md 后来改过（1469 行 / md5 87fe80d1…），**一部分锚点已经失配**。
 * 失配的条目**照样留着**，不悄悄丢掉 —— 一条锚点失配的变异和一条「变异没生效」的变异
 * 在输出上无法区分，丢掉它就等于把「测不了」伪装成「通过」。
 *
 * 用法
 * ----
 *   const M = require('./mutations-thirdparty2.js');
 *   // 每条：{ id, name, expect, edit }，expect 以 '!' 开头 = 反向断言（必须**不**报红）
 *   // edit(t) 返回改过的文本；返回 === t 表示锚点在当前 MODE.md 里已失配。
 */

const MUTATIONS = [
  { id: 'N1', name: 'C3 · 真声明改用 -> 箭头（C3 只认 → 字符）', expect: 'C3',
    edit: t => t.replace('### C.7 文件地图（2026-09-15「清」之后 · 9 → 5）',
      '### C.7 文件地图（2026-09-15「清」之后 · 9 -> 7）') },

  { id: 'N2', name: 'C3 · 真声明写成 `9→ 7`（前无空格、后有空格，re 与 loose 都不匹配）', expect: 'C3',
    edit: t => t.replace('### C.7 文件地图（2026-09-15「清」之后 · 9 → 5）',
      '### C.7 文件地图（2026-09-15「清」之后 · 9→ 7）') },

  { id: 'N3', name: 'C3 · 真声明用全角数字 `9 → ７`（\\d 不匹配）', expect: 'C3',
    edit: t => t.replace('### C.7 文件地图（2026-09-15「清」之后 · 9 → 5）',
      '### C.7 文件地图（2026-09-15「清」之后 · 9 → ７）') },

  { id: 'N4', name: 'C3 · 真声明写 `9→7`，且前 12 字内含「方案」（被当选项专名放行）', expect: 'C3',
    edit: t => t.replace('### C.7 文件地图（2026-09-15「清」之后 · 9 → 5）',
      '### C.7 文件地图（方案 C 落地后 · 9→7）') },

  { id: 'N5', name: 'C4 · 另加一条矛盾口径「ASK 总配额 = 三次」（中文数字）', expect: 'C4',
    edit: t => t.replace('    - **ASK 总配额 = 2 次**（G3 确认计划与最终目的 + G4 三方案选一）',
      '    - **ASK 总配额 = 2 次**（G3 确认计划与最终目的 + G4 三方案选一）\n    - **ASK 总配额 = 三次**（口径二）') },

  { id: 'N6', name: 'C4 · 旧口径写成 `ask 全程只有 1 次提问配额`（小写，行级门 /ASK/ 不匹配）', expect: 'C4',
    edit: t => t.replace('    - 其中**真正意义上的「选择」只有 1 次**（G4）。G3 是确认，不是选择。',
      '    - 其中**真正意义上的「选择」只有 1 次**（G4）。G3 是确认，不是选择。\n    - 旧稿：ask 全程只有 1 次提问配额。') },

  { id: 'N7', name: 'C4 · 旧口径行尾补「最多 2 次」触发 SHIELD → 违规被洗白', expect: 'C4',
    edit: t => t.replace('    - 其中**真正意义上的「选择」只有 1 次**（G4）。G3 是确认，不是选择。',
      '    - 其中**真正意义上的「选择」只有 1 次**（G4）。G3 是确认，不是选择。\n    - ASK 全程只有 1 次提问配额，最多 2 次。') },

  { id: 'N8', name: 'C5 · 活引用指向不存在的 CJK 文件名（正则截断成父目录 agents，永远"存在"）', expect: 'C5',
    edit: t => t.replace('`~/.workbuddy-ai/agents/verifier.md`', '`~/.workbuddy-ai/agents/验证器-typo.md`') },

  { id: 'N9', name: 'C5 · 活引用路径含空格（`agents/veri fier.md`）→ 截断成 agents', expect: 'C5',
    edit: t => t.replace('`~/.workbuddy-ai/agents/verifier.md`', '`~/.workbuddy-ai/agents/veri fier.md`') },

  { id: 'N10', name: 'C5 · 新增一条「活」引用 SOURCES.md（已废弃的旧文件名，本机不存在）→ 被全局豁免放行', expect: 'C5',
    edit: t => t.replace('## 1. 七条公理',
      '检索源索引见 `SOURCES.md` 第 3 节（活引用，非历史区）。\n\n## 1. 七条公理') },

  { id: 'N11', name: 'C5 · 活引用 `agents/verifier-typo.md` 去掉反引号 → 枚举器看不见', expect: 'C5',
    edit: t => t.replace('| `~/.workbuddy-ai/agents/verifier.md` |', '| ~/.workbuddy-ai/agents/verifier-typo.md |') },

  { id: 'N12', name: 'C6 · 跨文件锚点用 9 字模板名（{1,8} 上限 + 整词前瞻 → 完全不匹配）', expect: 'C6',
    edit: t => t.replace('| 4 | 验收加**增量规则**（增量验 + 最终全量） | `agents/verifier.md` 铁律九 |',
      '| 4 | 验收加**增量规则**（增量验 + 最终全量） | `agents/verifier.md` 模板 一个根本不存在的长模板名 |') },

  { id: 'N13', name: 'C6 · 跨文件锚点去掉反引号（`agents/verifier.md` → agents/verifier.md 铁律十五）', expect: 'C6',
    edit: t => t.replace('| 4 | 验收加**增量规则**（增量验 + 最终全量） | `agents/verifier.md` 铁律九 |',
      '| 4 | 验收加**增量规则**（增量验 + 最终全量） | agents/verifier.md 铁律十五 |') },

  { id: 'N14', name: 'C7 · 新加一条不带粗体的假「已落」声明（`已落` 无 **）→ C7 计数不到', expect: 'C7',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）',
      '| 99 | 假声明 | 某处 | 已落（无核对） |\n\n## 6. 反模式（违反，不是风格问题）') },

  { id: 'N15', name: 'C7 · 把一条真「已落」写成 `** 已落 **`（粗体里前导空格）→ 隐身且计数下降', expect: 'C7',
    edit: t => t.replace('| 4 | 验收加**增量规则**（增量验 + 最终全量） | `agents/verifier.md` 铁律九 | **已落**（核对：`grep -c "铁律九：" agents/verifier.md` → 1） |',
      '| 4 | 验收加**增量规则**（增量验 + 最终全量） | `agents/verifier.md` 铁律九 | ** 已落 ** |') },

  { id: 'N16', name: 'C7 · 用下划线粗体 `__已落__` 且无核对命令 → C7 隐身', expect: 'C7',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）',
      '| 99 | 假声明 | 某处 | __已落__ |\n\n## 6. 反模式（违反，不是风格问题）') },

  { id: 'N17', name: 'C8 · 删掉紧跟命令的期望值，改在行内别处放一个 `→ 1`（第三兜底正则接住）', expect: 'C8',
    edit: t => t.replace('| 4 | 验收加**增量规则**（增量验 + 最终全量） | `agents/verifier.md` 铁律九 | **已落**（核对：`grep -c "铁律九：" agents/verifier.md` → 1） |',
      '| 4 | 验收加**增量规则**（增量验 + 最终全量，铁律九 → 1 条） | `agents/verifier.md` 铁律九 | **已落**（核对：`grep -c "铁律九：" agents/verifier.md`） |') },

  { id: 'N18', name: 'C8 · 新增一条只有 3 列（无落点列）的已落行，命令指向别的文件 → 身份检查自证', expect: 'C8',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）',
      '| 99 | 假声明 | **已落**（核对：`grep -c "M1 变异测试" agents/verifier.md` → 1） |\n\n## 6. 反模式（违反，不是风格问题）') },

  { id: 'N19', name: 'C8 · 已落写在非表格行，落点声明 dispatcher.md、命令跑 verifier.md（命令前随便提一句 verifier.md 即过关）', expect: 'C8',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）',
      '- **已落**（落点 `agents/dispatcher.md`，另见 `agents/verifier.md`；核对：`grep -c "M1 变异测试" agents/verifier.md` → 1）\n\n## 6. 反模式（违反，不是风格问题）') },

  { id: 'N20', name: 'C1/C2 · 新增 `## 8. 幽灵节` 但标题前有一个空格（CommonMark 合法标题）→ 两条都静默', expect: 'C2',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）',
      ' ## 8. 幽灵节（有前导空格）\n\n## 6. 反模式（违反，不是风格问题）') },

  { id: 'N21', name: 'C1/C2 · 目录登记 **98**，正文的 `## 98.` 藏在 `~~~` 围栏里 → stripFences 不认', expect: 'C1',
    edit: t => t.replace('| **附录 E** | 自决记录（原 `decisions.md`） | 查"上次为什么这么定" |',
      '| **附录 E** | 自决记录（原 `decisions.md`） | 查"上次为什么这么定" |\n| **98** | 围栏幽灵 | — |')
      .replace('## 6. 反模式（违反，不是风格问题）',
        '~~~\n## 98. 围栏幽灵\n~~~\n\n## 6. 反模式（违反，不是风格问题）') },

  { id: 'N22', name: 'C4 · 另加矛盾口径 `ASK 总配额：3 次`（全角冒号，正则只认 =）', expect: 'C4',
    edit: t => t.replace('    - **ASK 总配额 = 2 次**（G3 确认计划与最终目的 + G4 三方案选一）',
      '    - **ASK 总配额 = 2 次**（G3 确认计划与最终目的 + G4 三方案选一）\n    - **ASK 总配额：3 次**（口径二）') },

  { id: 'N23', name: '（反向）C3 · 把 C.7 标题里的 `9 → 5` 用反引号包住 → 必须不报红（引述跳过）', expect: '!C3',
    edit: t => t.replace('### C.7 文件地图（2026-09-15「清」之后 · 9 → 5）',
      '### C.7 文件地图（2026-09-15「清」之后 · `9 → 5`）') },

  { id: 'N24', name: 'C8 · 期望值=5 且命令行自身不匹配该模式（^ 锚定）→ 无条件 -1 造成假红', expect: 'C8',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）',
      '| 99 | 附录数 | `MODE.md` 目录 | **已落**（核对：`grep -c "^## 附录" MODE.md` → 5） |\n\n## 6. 反模式（违反，不是风格问题）') },

  { id: 'N25', name: 'C8 · 复制第 1 行（grep MODE.md 的那条）→ 自指多算 2 次而只扣 1（期望 C8 报红=假红）', expect: 'C8',
    edit: t => t.replace('| 2 | **契约必须写类型，不只写存在**',
      '| 1b | 复制行 | `MODE.md` G6 | **已落**（核对：`grep -c "验证强度跟着任务生命周期走" MODE.md` → 1） |\n| 2 | **契约必须写类型，不只写存在**') },

  { id: 'N26', name: 'C7 · 把 2 条已落的命令换成同义万能话术「不可核对：原始证据已随合并被覆盖」', expect: 'C7',
    edit: t => {
      let n = 0;
      return t.split('\n').map(l => {
        if (/\*\*已落\*\*/.test(l) && n < 2) { n++; return l.replace(/（核对：`grep[^`]*`[^）]*）/, '（不可核对：原始证据已随合并被覆盖）'); }
        return l;
      }).join('\n');
    } },

  { id: 'N27', name: 'C7 · 假已落写成 `**已落\\u200b**`（零宽空格，仍在 [^*] 内 → 应报红，探针）', expect: 'C7',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）',
      '| 99 | 假声明 | 某处 | **已落\u200b** |\n\n## 6. 反模式（违反，不是风格问题）') },

  { id: 'N28', name: 'C6 · 铁律锚点写成阿拉伯数字（`agents/verifier.md` 铁律 15）→ 正则只认汉字', expect: 'C6',
    edit: t => t.replace('| 4 | 验收加**增量规则**（增量验 + 最终全量） | `agents/verifier.md` 铁律九 |',
      '| 4 | 验收加**增量规则**（增量验 + 最终全量） | `agents/verifier.md` 铁律 15 |') },

  { id: 'N29', name: 'C5 · 活引用用 Windows 反斜杠（`~/.workbuddy-ai\\agents\\verifier-typo.md`）', expect: 'C5',
    edit: t => t.replace('`~/.workbuddy-ai/agents/verifier.md`', '`~/.workbuddy-ai\\agents\\verifier-typo.md`') },

  { id: 'N30', name: 'C2 · 新增 `## 8．幽灵节`（全角句点）→ num 正则不匹配，应报「归不进目录编号」', expect: 'C2',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）',
      '## 8．幽灵节\n\n## 6. 反模式（违反，不是风格问题）') },

  { id: 'N31', name: 'C6 · 跨文件锚点用 9 字模板名 → 提取被截成 8 字，若目标真有该名也会假红', expect: 'C6',
    edit: t => t.replace('| 4 | 验收加**增量规则**（增量验 + 最终全量） | `agents/verifier.md` 铁律九 |',
      '| 4 | 验收加**增量规则**（增量验 + 最终全量） | `agents/verifier.md` 模板 铁律九校验流程 |') },

  { id: 'N32', name: 'C4 · 旧口径写成 `` `ASK` 全程只有 1 次提问配额 ``（ASK 在代码跨度里被剥掉）', expect: 'C4',
    edit: t => t.replace('    - 其中**真正意义上的「选择」只有 1 次**（G4）。G3 是确认，不是选择。',
      '    - 其中**真正意义上的「选择」只有 1 次**（G4）。G3 是确认，不是选择。\n    - 旧稿：`ASK` 全程只有 1 次提问配额。') },

  { id: 'N33', name: 'C7 · 假已落整条写成代码跨度 `` `**已落 ✅ 2026-09-15**` ``（引述豁免）', expect: 'C7',
    edit: t => t.replace('## 6. 反模式（违反，不是风格问题）',
      '反例：`**已落 ✅ 2026-09-15**`（无核对命令）\n\n## 6. 反模式（违反，不是风格问题）') },

  { id: 'N34', name: 'C5 · 失效引用不带反引号（~/.workbuddy-ai/agents/verifier-typo.md 裸写）→ 已知约定缺口', expect: 'C5',
    edit: t => t.replace('`~/.workbuddy-ai/agents/verifier.md`', '~/.workbuddy-ai/agents/verifier-typo.md') },

  { id: 'N35', name: 'C3 · 真声明写成 `` `9 → 7` ``（整条代码跨度）→ 被当引述跳过', expect: 'C3',
    edit: t => t.replace('### C.7 文件地图（2026-09-15「清」之后 · 9 → 5）',
      '### C.7 文件地图（2026-09-15「清」之后 · `9 → 7`）') },

  { id: 'N36', name: 'C5 · `skills/constraint-mode/SKILL.md` 改成 SKILL-typo.md → 应报红', expect: 'C5',
    edit: t => t.replace('`skills/constraint-mode/SKILL.md`', '`skills/constraint-mode/SKILL-typo.md`') },

  { id: 'N37', name: 'C5 · `MEMORY.md` 全局改成 MEMORY-typo.md → 硬编码特例失效，枚举器看不见', expect: 'C5',
    edit: t => t.replace(/MEMORY\.md/g, 'MEMORY-typo.md') },

  { id: 'N38', name: 'C5 · 引用写成通配符 `skills/*/SKILL.md` → 捕获退化成 `skills/`（目录存在）', expect: 'C5',
    edit: t => t.replace('`skills/constraint-mode/SKILL.md`', '`skills/*/SKILL.md`') },

  { id: 'N39', name: 'C1 · 整段删掉 `## 目录`（含表格）→ 应报「找不到 ## 目录 —— 检查器失效」', expect: 'C1',
    edit: t => t.replace(/## 目录\n\n\| 节 \| 内容 \| 什么时候看 \|\n\|---\|---\|---\|\n(?:\|[^\n]*\|\n)+/, '') },

  { id: 'N40', name: 'C5 · 只把裸引用 `MEMORY.md` 改成 `MEMORY-typo.md`（其余带路径的保留）→ 应报红', expect: 'C5',
    edit: t => t.replace('`skills/constraint-mode/SKILL.md`、`MEMORY.md`。', '`skills/constraint-mode/SKILL.md`、`MEMORY-typo.md`。') },

  { id: 'N41', name: 'C5 · `~/.workbuddy-ai/MEMORY.md` 改成 `~/.workbuddy-ai/MEMORY.md.bak`', expect: 'C5',
    edit: t => t.replace('`~/.workbuddy-ai/MEMORY.md`', '`~/.workbuddy-ai/MEMORY.md.bak`') },
];

module.exports = MUTATIONS;
