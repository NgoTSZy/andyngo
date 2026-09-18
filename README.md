# andyngo

一套**可验收的工作流协议** —— 它不只是文档，是一台**带判据的机器**：
`skill`（路由） + `.check`（判据层） + `record`（账本层）。

> **本仓库的发布形态说明**：只含 `skills/andyngo/` 一个 skill 载体。
> 原工作区还有 21 个 skill，**不在本仓库范围内**（见下文「已知边界」）。

---

## 目录结构

```
skills/andyngo/     ← skill 本体（22 文件）—— zip 从这里打
  SKILL.md            YAML frontmatter: name / description
  assets/             契约
  references/         10 个事件各自的「怎么做」（A-discovery / B-execution / C-assurance / D-evolution）
  scripts/            3 个 .sh（载体 · 记录 · 安全检查）
.check/             ← 判据层 + 记录层骨架
  *.js                判据（check-protocol · andyngo-integrity · probe-crossref · probe-record-shape …）
  tests/              22 条尺子
  record/             四件套 + alloc.sh（唯一写入器）+ newid.js（唯一取号器）+ 豁免表
MODE.md             ← 最小骨架（**必需**，见下）
install.sh
```

---

## 运行要求（实测）

| 项 | 要求 |
|---|---|
| **Node** | **≥ 14**（代码里用到 `??`） |
| **bash** | 任意 bash（脚本全部 `#!/usr/bin/env bash`） |
| **外部依赖** | **0 个** —— `require` 全是 Node 内置（`fs` / `path` / `child_process` / `crypto` / `os`）或相对路径。**不需要 `npm install`，不联网，不编译。** |
| **平台** | Linux / macOS 原生；Windows 需 **Git Bash**（有 2 处 `sed -i` 用 GNU 语法） |

---

## 安装（**两步** —— 因为落点有两处）

```bash
git clone https://github.com/<你>/andyngo.git && cd andyngo
bash install.sh /path/to/your/project
```

或手动：

```bash
# ① skill 本体 → 产品的 skill 目录
cp -r skills/andyngo ~/.workbuddy-ai/skills/
#    或：WorkBuddy「添加技能 → 上传技能」装 dist/andyngo.zip

# ② 判据与记录层 → 你的项目根
cp -r .check /path/to/your/project/.check
cp MODE.md /path/to/your/project/MODE.md
: > /path/to/your/project/.check/record/eventlog/$(date -u +%Y-%m-%d).txt
```

**为什么分两处**：`andyngo-audit.sh:4` 是 `ROOT="${PROJECT_ROOT:-$PWD}"` ——
判据跑在**你的项目根**，不是 skill 的安装位置。这是设计（可移植），不是疏忽。

---

## ★ 预期状态：**第一次跑不会全绿** —— 那不是装坏了

```bash
cd /path/to/your/project
node .check/probe-record-shape.js --scan     # ← 这条会绿
node .check/andyngo-integrity.js             # ← 这条会 rc=2
```

**原因**：账本是空的。判据对空输入报 **`UNVERIFIED`（rc=2）** 而不是 `0` ——
因为「**判据空转**」和「**判据跑了且合格**」必须能被机器区分开。
**一个不响的守门人比没有守门人更坏**，所以空账本必须报 `2`。

| rc | 含义 |
|---|---|
| `0` | 通过 |
| `1` | **失败**（查出来了，东西真的不对） |
| `2` | **拒跑**（没跑成 —— 「没跑成 ≠ 通过」） |

**怎么让它转绿**：先有记录。用 `skills/andyngo/scripts/andyngo-record.sh` 写第一条，
或按 `references/` 里的做法走一遍完整事件。

---

## 已知边界（**不假装它被覆盖了**）

1. **`ruler-callpoint.js` 会报「未接」** —— 它检查「每条尺子有没有接进载体」。
   本仓库只含 `skills/andyngo/` 一个载体，而 `.check/tests/` 里的尺子有一部分是接在
   **原工作区另外的载体**（`skills/andy/scripts/andy-audit.sh`）上的。
   ⇒ 在本仓库里它们**没有载体**，报「未接」是**发布裁剪的正确结果**，不是缺陷。
   （要消掉它：在 `.check/record/ruler-callpoint-exemptions.md` 逐条登记豁免，或删掉那些尺子。）
2. **`artifacts-index.js` 检查的 `artifacts/` 目录不在本仓库内** —— 它是另一个项目的产物登记。
3. **`MODE.md` 是最小骨架**，原版含作者本机的工作规则，未随仓库发布。
   ⇒ **`check-protocol.js`（C1–C8）会报 FAIL** —— 它检查的正是 `MODE.md` 的**内容质量**
   （目录 ↔ 章节对应 · 单值量唯一 · 活引用真实存在 · 「已落」声明自带可执行核对命令 …）。
   骨架没有目录、没有引用，所以 C1/C3/C4/C5/C6/C7/C8 全红是**预期的**。
   **你把自己的规则写进 `MODE.md` 之后，它会自然变绿** —— 这不是安装问题。
4. **刚改过的文件会标 `FRESH`**（mtime < 30 分钟）**不计入命中** ——
   所以「命中 0」在这里**不等于「没有缺口」**，等它们定稿后复跑会自动变红。
   这是设计（防止把「正在被写」误报成「已坏」）。

---

## 三个坑（都是作者亲自踩的）

| # | 坑 | 现象 | 正确做法 |
|---|---|---|---|
| 1 | 用 `&&` 串联多步复制 | 中间一步失败 ⇒ **后续全部静默跳过** | 每步单独取 `rc`，或复制后**核对文件数** |
| 2 | `node ".check/x.js --scan"` | `Cannot find module '...x.js --scan'` —— 引号把**参数也括进去**了 | `node .check/x.js --scan`（**不加引号**） |
| 3 | `grep -E '??'` 数 `??` | 报 9711 处（假）—— `??` 是 ERE 的 **lazy 量词**，匹配空串 | 用 **`grep -F`**（真值 3 处） |

**共同点**：**「工具差 ≠ 缺陷」**。报红前先问「这红是不是我这一轮造成的」。

---

## 许可

见 `LICENSE`（如有）。本仓库为作者个人工作流的发布版。
