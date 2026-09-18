#!/usr/bin/env bash
set -uo pipefail

ROOT="${PROJECT_ROOT:-$PWD}"
DATE=$(date -u +%Y-%m-%d)
OUT="$ROOT/.check/audit/$DATE"
mkdir -p "$OUT"

TS=$(date -u +%H%M%S)
REPORT="$OUT/audit-$TS.txt"

# 【2026-09-16 加，W23 J14 · ISS-096】顶层门禁的退出码必须携带信息。
#
# 改前：本脚本最后一条命令是 `cat "$REPORT"`，于是**退出码永远来自 `cat`（恒 0）** ——
# 每个子命令的 rc 只是 `echo "EXIT=$?"` **打进报告文本**。结果：**`acceptance` 报 FAIL 时
# 载体照样 exit 0**。人读报告能看到 `EXIT=1`，**机器读 rc 永远看到绿**。
# 这与本文件反复写的那个形状是同一个：**判据说了话，而它机器可读的那一半恒为 0。**
# automation §六 铁律也写着「**退出码 0 通过 / 1 失败 / 2 拒跑**」—— 恒 0 违反本仓库自己的规范。
#
# 改法（**最小改动，报告文本一字不变**）：段内每处 `echo "EXIT=$?"` 换成 `seg` ——
# 它**打印同一行**，同时把非零 rc 累加进 `FAILED`；块结束后据此定退出码。
# **`{ ... } > "$REPORT"` 不是子 shell**（是同一 shell 的重定向），所以块内累加对块外可见。
#
# 为什么必须**先证明它真的会红**：`.check/tests/audit-exitcode-test.sh` 用 `PROJECT_ROOT`
# 指向假根造可控的假失败，**五组**断言（到达性 / 主断言 / 反向守门人 / 形态未变 / SKIP 语义）。
# **改前实测 ② FAIL（假失败 → 载体 rc=0）** —— 缺陷被精确复现；改后 ② 转 PASS。
#
# 【2026-09-16 加，W23 J14 · ISS-096 的**剩余缺口**】退出码补上第三态 **2 = 拒跑**。
# 改前：`SKIP` 分支（「本机没有这个件」）**不打印 `EXIT=` 行** → `SEGS` 数不到它、
# `FAILED` 也数不到它 → **载体照样 rc=0**。于是「这一段根本没跑成」与「这一段跑了且合格」
# 在**机器读的那一半**里长得一样（都只是「少了一条 EXIT= 行」）—— 这是 ISS-096 的同族假绿，
# 只是换了个入口。现在：`SKIP` 计入 `SKIPPED`，收尾三态：
#     `FAILED>0 → 1` · 否则 `SKIPPED>0 → 2` · 否则 `0`
# ★ 【2026-09-18 · W23 J20 · ISS-153】`SKIPPED` 有**两个来源**：
#   ① 载体自己 `skip()`（「本机没有这个件」）② **段返回 `rc=2`（内层判据拒跑）** —— 见 `seg()` 上方。
#   两者都计入 `SKIPPED`、都打**行首** `SKIP `（计数契约，`audit-exitcode-test.sh` ⑤⑦）。
# **`2` = 拒跑 / 结果不完整** —— 与本仓库其它组件（`write-lock.js` · `alloc.sh` ·
# `check-protocol.js`）以及 automation §六 铁律「0 通过 / 1 失败 / 2 拒跑」一致。
# **优先级：`FAILED` 优先于 `SKIPPED`** —— 「有段不合格」是**确定**的信号、「有段没跑成」是
# **缺失**信号；确定的负面优先，且**两者都不是绿**。报告里两个数都印出来，不丢信息。
FAILED=0   # 非零 EXIT 的段数（机器读的那一半的来源）
SEGS=0     # EXIT= 行的总数（打印在汇总里，便于人读对照）
SKIPPED=0  # `SKIP` 的处数（**「跑不成」的那一半** —— 见文件头 ISS-096 剩余缺口那段）
# 打印退出码行并累加失败数。两种用法：
#   `cmd ; seg`       → 捕获 $?（函数体**第一条**就是 `local rc=$?`，中间不许插命令）
#   `seg "$rc1" 尾注`  → 直接用已捕获的变量（段内已有 `rc1=$?` 那种写法）
#
# 【2026-09-18 · W23 J20 · ISS-153】**按 rc 分流，不是「非零即失败」。**
# 改前：`if [ "$rc" != "0" ]; then FAILED=…` ⇒ 段返回 **2** 也被算成「**确定**不合格」，
# 载体于是报 rc=1 —— 而 2 在本仓库的统一口径里是**拒跑**（`0 通过 / 1 失败 / 2 拒跑`）。
# **实测复现**（`audit-exitcode-test.sh` ⑥「假拒跑」）：改前 `段返回 2 → 载体 rc=1`。
# **同族**：ISS-149 只**逐例**把两个已知段（`write-lock-test.sh` / `judge-selftest.sh`）
# 的 rc=2 改走 `skip`，**通用规则没进这里** ⇒ 第三个实例（`acceptance.js` 因 UNVERIFIED
# 返回 2）当场复现。现在把规则放进 `seg()` **本身** —— **一处改，所有段生效**。
# ★ **`rc=2` 分支必须同时打一行行首 `SKIP `**：`SKIPPED` 的唯一可见来源是收尾那个数，
#   而报告里逐条的证据是行首 `SKIP ` 行；只计数不打行会让两者**口径分叉**（ISS-139 的形状）。
#   `audit-exitcode-test.sh` ⑦ 是这条契约的守门人（三跑逐条比对计数与文本）。
seg() {
  local rc=$?
  local tail=""
  if [ $# -gt 0 ]; then
    case "$1" in
      ''|*[!0-9]*) ;;              # 非数字 → 当成尾注，rc 仍取 $?
      *) rc="$1"; shift ;;         # 纯数字 → 当成 rc
    esac
    tail="$*"
  fi
  echo "EXIT=$rc$tail"
  SEGS=$((SEGS + 1))
  if [ "$rc" = "0" ]; then
    :                              # 通过
  elif [ "$rc" = "2" ]; then
    # 拒跑（没跑成）—— 归 SKIPPED，不归 FAILED（ISS-153）
    echo "SKIP 本段返回 rc=2（拒跑 / 未验证）—— 计入「没跑成」，不计「确定不合格」"
    SKIPPED=$((SKIPPED + 1))
  else
    FAILED=$((FAILED + 1))
  fi
  return 0
}

# 打印 `SKIP` 行并累加跳过数。**与 `seg` 对称**：两者都是「机器读的那一半」的来源，
# 区别是 `seg` 记「跑了的结果」、`skip` 记「没跑成」。
# 改前那些分支直接 `echo "SKIP …"` —— **不进任何计数器**，于是载体照样 rc=0。
# 行首的 `SKIP ` 是**契约**：尺子 `audit-exitcode-test.sh` 的 ⑤ 用 `grep -c '^SKIP '` 数它。
skip() {
  echo "SKIP $*"
  SKIPPED=$((SKIPPED + 1))
  return 0
}

# 规格文件定位（**唯一实现**）—— 供 `SPEC-COVERAGE` 与 `JUDGE-SELFTEST` 两段共用。
#
# 【2026-09-18 · B · ISS-152】为什么要抽成一个函数：候选表原先在两段**各抄一份**，
# 「改一处、漏一处」就是**静默分叉**（一段找得到规格、另一段找不到），
# 同 ISS-007 家族「两份实现会互相背书」。抽出来 = 一处改、两处生效。
#
# 候选顺序：`ANDYNGO_SPEC` → `.check/spec/` → 工作区根 → `$HOME/Desktop`。
# ★ **不放写死的本机绝对路径**：本文件是**发布件**，载体自己不该带 `/c/Users/<本机用户>/…`
#   （副本靠人工脱敏才不泄露）。原先第三候选正是那条写死路径，`$HOME/Desktop` 语义相同且可移植。
# ★ **要放规格就放** `.check/spec/andyngo build.md.txt`（或设 `ANDYNGO_SPEC`）。
#
# 语义与改前**逐字一致**：`ANDYNGO_SPEC` 一旦非空就**原样返回**（哪怕该文件不存在 ——
# 调用方自己的 `-f` 检查会按「找不到」skip），**不**因为环境变量指错就悄悄回退到候选表。
find_spec() {
  if [[ -n "${ANDYNGO_SPEC:-}" ]]; then printf '%s' "$ANDYNGO_SPEC"; return 0; fi
  local c
  for c in "$ROOT/.check/spec/andyngo build.md.txt" "$ROOT/andyngo build.md.txt" "$HOME/Desktop/andyngo build.md.txt"; do
    if [[ -f "$c" ]]; then printf '%s' "$c"; return 0; fi
  done
  return 1
}

{
  echo "=== ACCEPTANCE ==="
  if [[ -f "$ROOT/.check/acceptance.js" ]]; then
    ( cd "$ROOT" && node .check/acceptance.js 2>&1 )
    seg
  else
    skip "无 acceptance.js"
  fi

  # 【2026-09-15 加，DEC-010】规格 §3.3/§3.4 把「完整性校验（I1–I5）」列为 **AUDIT 的组成部分**，
  # 而 AUDIT 的载体就是本脚本 —— 但本脚本原先只跑 acceptance，于是 I1–I5 的载体
  # `.check/andyngo-integrity.js` **没有任何调用者**（只在文档里被提到，全是文字不是调用）。
  # 一段没人调用的判据 = 一条没有判据的规则，只是换了个地方藏着。
  echo
  echo "=== INTEGRITY (I1-I7) ==="
  if [[ -f "$ROOT/.check/andyngo-integrity.js" ]]; then
    ( cd "$ROOT" && node .check/andyngo-integrity.js 2>&1 )
    seg
  else
    skip "无 andyngo-integrity.js"
  fi

  # 【2026-09-16 加，ISS-043 / ISS-035 / ISS-026 / CHG-025 / 新发现】
  # 「跨物对照」判据（X1–X6）：每一项都只问**一件事** —— A 与 B 的关系有没有被写下来。
  #   X1 退出码 2 的语义有没有登记（exit-codes.md）· X2 三态↔五态有没有对照声明
  #   X3 evidence 归档件只增不减且非空 · X4 新增 CHG 行第 2 字段是不是合规 ts
  #   X5 记录 md5 ↔ 磁盘新鲜度（**只报告不判红**）· X6 活引用检查面覆盖哪些文件（**只报告不判红**）
  # 接在这里的理由与上面那段（DEC-010）完全相同：**判据必须有一个调用者**，
  # 否则它只是「换了个地方藏着的规则」。**判据与它的双向测必须一起跑** ——
  # 一条只会说 OK 的判据，和没有判据长得一样。
  #
  # 【2026-09-16 · W23 J11 修一处漂移】本段标题原写 `(X1-X5)`、注释也只列到 X5，
  # 而判据早已是 **6 条**（X6 在 CHG-102 就有）—— **载体的描述漂了，判据没漂**。
  # 这不是小事：**载体是判据唯一的调用者**，载体说「5 条」会让读报告的人
  # 以为 X6 没在跑。**已改为 X1–X6 并把 X6 列进注释。**
  echo
  echo "=== CROSSREF (X1-X6) ==="
  if [[ -f "$ROOT/.check/probe-crossref.js" ]]; then
    ( cd "$ROOT" && node .check/probe-crossref.js --scan 2>&1 )
    seg
    echo
    echo "--- 双向测（--inject）---"
    ( cd "$ROOT" && node .check/probe-crossref.js --inject 2>&1 )
    seg
  else
    skip "无 probe-crossref.js"
  fi

  # 【2026-09-16 加，W23 J11】记录层「逐行形状」判据（I8/I9/I10）。
  # **为什么加**：实测它**有完整双向测**（注入 6/6 被抓 · 反向 6/6 干净 · 边界 1/1 · 计数自检 1/1）
  # 却**零调用者** —— 5 个文件提到它，**全是文字**（`.md` 里的说明），
  # 代码里的真实调用点是 **0**。这正是本文件上面两段反复写的那个形状：
  # **一段没人调用的判据 = 一条没有判据的规则，只是换了个地方藏着**（DEC-010 的原话）。
  # **判据与它的双向测必须一起跑** —— 所以 `--scan` 与 `--inject` 都在这里。
  echo
  echo "=== RECORD-SHAPE (I8-I10) ==="
  if [[ -f "$ROOT/.check/probe-record-shape.js" ]]; then
    ( cd "$ROOT" && node .check/probe-record-shape.js --scan 2>&1 )
    seg
    echo
    echo "--- 双向测（--inject）---"
    ( cd "$ROOT" && node .check/probe-record-shape.js --inject 2>&1 )
    seg
  else
    skip "无 probe-record-shape.js"
  fi

  # 【2026-09-16 加，W23 J12】记录层「编号唯一」判据（`newid.js --check`）。
  # **为什么加（实测理由，不是推测）**：`.check/record/newid.js` 的 `--check` 模式查
  # 「同一个号出现在两条记录行」—— 它比 I8/I9/I10 **更全**（**连 eventlog 一起查，共 5 个文件**），
  # 有自己**逐条登记**的豁免表（`id-collision-exemptions.md`，5 条，正是那次事故的 5 组），
  # 以及 0/3/4/5/6 三态退出码（5 = 未登记撞号 · 6 = 悬空豁免）。
  # **而它的真实调用者是 0** —— 全仓库只有**注释**提到它（`probe-record-shape.js` 4 处 ·
  # `alloc.sh` 2 处），代码里没有一处调用。**判据存在、健康、有判定力，却没人跑**
  # —— 与上面 RECORD-SHAPE 段**同一个形状**（DEC-010 的原话）。
  # **★ 本段是一次「差点造重复判据」的回退留下的**：我先在 `probe-record-shape.js` 里加了
  # 一条同义规则（⑤ 跨行同号），**跑绿之后**才发现 `newid.js --check` 早已覆盖它，
  # 而且覆盖更全、豁免更细 —— 于是把三个文件**逐字节回退**（md5 全部复原到改前值），
  # 改成**接进本载体**。教训落在 `record-shape.js` 文件头那句「**同源判据不算两个判据**」：
  # **「读到过」不等于「问过」** —— 那句「实测 `newid.js --check` exit 0」我读过，
  # 却没顺着问「那它在查什么」。**两条同源判据会互相背书**，比一条判据更坏。
  echo
  echo "=== RECORD-ID-UNIQUE (newid.js --check) ==="
  if [[ -f "$ROOT/.check/record/newid.js" ]]; then
    ( cd "$ROOT" && node .check/record/newid.js --check 2>&1 )
    seg
  else
    skip "无 .check/record/newid.js"
  fi

  # 【2026-09-16 加，W23 J14】上面那个取号器的**尺子**（`newid.js --inject`）。
  # **为什么必须紧跟 `--check`**：本仓库的规矩是「**判据与它的双向测必须一起跑**」——
  # 一条只会说 OK 的判据，和没有判据长得一样。ISS-092 迟迟没修的第 ① 条理由正是
  # 「`newid.js` **没有** `--inject` 那类双向测」（先改就是又一次「判据没有尺子」）。
  # 现在尺子有了，就**必须有人跑它**，否则它只是又一个「存在但不可达」的文件 ——
  # 而 W23 J13 刚为「规格要求的文件零引用点」专门加过一条判据。
  # 与上一段判的**不是**同一件事：上一段判「号唯一」，本段判「那条 WARN 检测器
  # 抓不抓得住真阳性、放不放得过已知合法内容」（含「同一正文走 `@文件` 路径必须不报」那一对）。
  echo
  echo "=== RECORD-WARN-INJECT (newid.js --inject) ==="
  if [[ -f "$ROOT/.check/record/newid.js" ]]; then
    ( cd "$ROOT" && node .check/record/newid.js --inject 2>&1 )
    seg
  else
    skip "无 .check/record/newid.js"
  fi

  # 【2026-09-16 加，W23 J11】hub 路由表标价一致性（`skills/hub/price.js --check`）。
  # **为什么加（实测理由，不是推测）**：同一天里「改了模块没重算标价」**被踩了两次** ——
  # 第一次记在 `routes.md` 的「顺序不能反」段里（**文字**），第二次（W23 J10）
  # 改 `andyngo/SKILL.md` 后又没重算，**是跑 `acceptance.js` 才抓到的**。
  # 也就是说：那条教训**写在文件里，仍挡不住第二次**，能抓到的只有判据 ——
  # 而 `price.js --check` 此前**唯一的调用者是 `acceptance.js` 第 [10] 项**，
  # 那要跑 5.5 分钟。**接进本载体**（automation §一.1 每次都会跑它）＝ 把它放进更常走的那条路。
  # **不改 automation 提示词**（那属「动用户配置」= 乙类，需用户裁决）。
  echo
  echo "=== HUB-PRICE (price.js --check) ==="
  if [[ -f "$ROOT/skills/hub/price.js" ]]; then
    ( cd "$ROOT" && node skills/hub/price.js --check 2>&1 )
    seg

    # 【2026-09-16 加，W23 J14 · ISS-109】**判据自己的尺子**。
    # 本轮才把 **表头那句合计** 纳入 `--check` 的检查面（此前只核对表内 21 行，
    # 合计可静默腐烂 —— 实测停在 51,200/138,265 而表内已是 51,226/138,508，`--check` 全绿）。
    # **尺子必须跟判据一起跑**：不然下次改这两个正则，「门被写成永远返回空」没人会发现。
    # 尺子只验判据本身；真树是否一致由上面那条 `--check` 管（重复就是第二份判据）。
    ( cd "$ROOT" && node skills/hub/price.js --inject 2>&1 )
    seg "   （--inject 尺子 · 0 = 全过）"
  else
    # 【2026-09-17 · B】hub 已按用户裁决移出本机（`.backup-strip-20260917-2232/`，可原样移回）
    # ⇒「本机没有这个件」是**正常缺席**，不是「件丢了」。原为 `skip`（→ `SKIPPED++` → 载体 rc=2）
    # —— 那让载体变成**永远响的警报**，而「总是响的警报等于没有警报」（DEC-019 同族）：
    # 它会**淹没**真正该看的 SKIP（本机另有 `ANDYNGO_SPEC` 环境性 SKIP）。
    # 故**不计 SKIP**，也不打行首 `SKIP ` —— 行首 `SKIP ` 是**计数契约**
    # （见 `skip()` 上方注释 + `audit-exitcode-test.sh` ⑤ 用 `grep -c '^SKIP '` 数它）。
    echo "ABSENT skills/hub/price.js —— hub 已移出本机（正常缺席，不计 SKIP；移回后本段自动恢复）"
  fi

  # 【2026-09-16 加，W23 J12】规格 ↔ 判事件表 入口覆盖（两个**独立**口径 + 结论对照）。
  # **为什么加（实测理由，不是推测）**：`.check/tests/card-entry-coverage.sh`（口径一）与
  # `card-entry-coverage2.js`（口径二）**零生产调用者** —— 唯一的引用者
  # `judge-selftest.sh:23-24` 是把它们当**被测样本**（J1/J2），`exit-codes.md` 只是文档提及，
  # 代码里的真实调用点是 **0**。两个口径**都健康**（带参数 PASS rc=0 · 不带参数 UNVERIFIED rc=2），
  # 即「有判定力却没人跑」—— 与上面 RECORD-SHAPE 段**同一个形状**（DEC-010 的原话）。
  #
  # **为什么两个口径都要跑，而不是挑一个**：两个口径**刻意不共用抽取代码**（CHG-014 的独立性要求），
  # 于是它们**也不共用脆弱假设** —— 口径一按**硬编码行号** `1185,1207` 定位速查卡，
  # 口径二按**锚点文本**「一页速查卡」定位。而**规格是会被改的**（CHG-106 实证：改过第 156/168/1195 行）。
  # 改一次规格就可能让口径一的区间**指到别处** —— 此时口径一报 `UNVERIFIED(2)` 而口径二照常有结论，
  # **两个口径给出不同结论**。没有下面那段「结论对照」，读者会把「口径一红」误读成「入口覆盖坏了」。
  # 规格在**项目外**（无版本管理），路径由 `ANDYNGO_SPEC` 指定；未设则按 `find_spec()`
  # 的候选表探测（**与 `JUDGE-SELFTEST` 段共用同一份实现**，见文件上方 `find_spec`）；找不到就
  # `SKIP` —— **不报 FAIL**，不是每台机器都有那份规格。
  echo
  echo "=== SPEC-COVERAGE (速查卡 ↔ 判事件表) ==="
  SPEC=$(find_spec)
  if [[ -z "$SPEC" || ! -f "$SPEC" ]]; then
    skip "未找到规格（可用 ANDYNGO_SPEC 指定路径）"
  elif [[ ! -f "$ROOT/skills/andyngo/SKILL.md" ]]; then
    skip "无 skills/andyngo/SKILL.md"
  else
    echo "规格: $SPEC"
    echo
    echo "--- 口径一（bash · 硬编码行号 1185,1207）---"
    ( cd "$ROOT" && bash .check/tests/card-entry-coverage.sh "$SPEC" "$ROOT/skills/andyngo/SKILL.md" 2>&1 )
    rc1=$?
    seg "$rc1"
    echo
    # POSIX 路径 → Windows 形式（**只给原生 node 用**）。与 judge-selftest.sh:49-55 同一实现。
    # **不加这一步，口径二会假红**：给原生 node.exe 传 /c/... 会被解析成 C:\c\...
    # （本项目踩过两次，judge-selftest.sh 第 11 行有记）。**路径格式错 ≠ 判据发现问题。**
    # 优先 cygpath -m：它连 /tmp/... 这种「非盘符」路径也能正确映射。
    win() {
      if command -v cygpath >/dev/null 2>&1; then
        cygpath -m "$1"
      else
        case "$1" in /[a-z]/*) echo "$(echo "${1:1:1}" | tr 'a-z' 'A-Z'):${1:2}";; *) echo "$1";; esac
      fi
    }
    echo "--- 口径二（node · 锚点「一页速查卡」）---"
    ( cd "$ROOT" && node .check/tests/card-entry-coverage2.js "$(win "$SPEC")" "$(win "$ROOT/skills/andyngo/SKILL.md")" 2>&1 )
    rc2=$?
    seg "$rc2"
    echo
    if [[ "$rc1" == "2" && "$rc2" != "2" ]]; then
      echo "★ 口径一 UNVERIFIED 而口径二有结论 —— 这是**口径一的硬编码行号漂移**，"
      echo "  **不是**入口覆盖缺口。修法：更新 .check/tests/card-entry-coverage.sh 第 17 行的区间。"
    elif [[ "$rc1" == "2" && "$rc2" == "2" ]]; then
      echo "★ 两个口径都 UNVERIFIED —— 先查规格路径/锚点是否还在，**不要**当成覆盖缺口。"
    else
      echo "两口径结论一致（EXIT=$rc1 / $rc2）。"
    fi
  fi

  echo "=== SPEC-REF-COVERAGE (规格 §3.N 文件 ↔ 引用点) ==="
  # 与上一段判的**不是**同一件事：上一段判「速查卡的入口名在不在 SKILL.md」，
  # 本段判「规格 §3.N 的每个文件有没有引用点」。
  # **入口在 ≠ 入口背后要用的工具有人指向** —— 2026-09-16 实测（W23 J13）：
  # `security` 入口存在（上一段绿），但 `andyngo-security-scan.sh` 零引用（本段红）。
  # 路径容错做在判据自己身上（它把 /c/... 转成 C:/...），所以这里**不需要** win() ——
  # 而且 win() 定义在上一段的 else 分支里，规格找不到时它根本没被定义。
  if [[ -z "$SPEC" || ! -f "$SPEC" ]]; then
    skip "未找到规格（与上一段同一个变量；可用 ANDYNGO_SPEC 指定路径）"
  elif [[ ! -f "$ROOT/.check/tests/spec-ref-coverage.js" ]]; then
    skip "无 .check/tests/spec-ref-coverage.js"
  else
    ( cd "$ROOT" && node .check/tests/spec-ref-coverage.js "$SPEC" 2>&1 )
    rc3=$?
    seg "$rc3" "   （0 = 全部有引用点 · 1 = 有零引用点 · 2 = 拒跑）"
    if [[ "$rc3" == "1" ]]; then
      echo "★ 零引用点 = 规格要求它存在、但没有任何通道能到达它 ——"
      echo "  模型不会去读一个没人提过的文件，所以它等于不存在。"
      echo "  修法：在 SKILL.md 的必读表或对应事件的 reference 文档里给它一个引用点。"
    fi
    echo
    echo "--- 判据自身的双向测（--inject）---"
    # **判据与它的双向测必须一起跑**：一条只会说 OK 的判据，和没有判据长得一样。
    # 接进载体（而不是靠 prompt 记得）才是机制 —— 纪律依赖「我记得」，机制不依赖。
    ( cd "$ROOT" && node .check/tests/spec-ref-coverage.js --inject 2>&1 )
    rc3i=$?
    seg "$rc3i" "   （0 = 9/9 全过）"
  fi

  # 【2026-09-16 加，W23 J14】`andyngo-record.sh` 的**双向测**（ISS-108 的尺子）。
  # **为什么加**：本轮把它从「自己取号（`LAST+1` + 裸 `>>`，DEC-027 明文禁止）」改成
  # 「转调 `newid.js`」。改完**只跑一次成功写入不算验证** —— 那只测了 happy path；
  # 真正要钉的是「它会不会哑」：新加的 `ALLOC` 断言、`|| exit $?` 的退出码透传、
  # 「`newid.js` 不在时必须 rc=1」的存在性守卫、以及**并发下唯一 seq == 进程数**。
  # **为什么接进载体**：与第 9 段同一条理由 —— 尺子存在但没人跑，它等于不存在
  # （W23 J13 刚为这件事加过判据）。本段与第 5/9 段判的**不是**同一件事：
  # 第 5 段判 `newid.js` 的编号唯一、第 9 段判它的 WARN 检测器，本段判**转调它的那个壳**。
  # 尺子在**假根**里注入可控的假 `newid.js`，所以它既能测到红分支、又不碰真记录。
  #
  # ★ **为什么追加在末尾，而不是紧跟第 5/9 段**：`第 8 段` / `第 9 段` 这两个段号
  #   在 **5 处以上**被引用（`record-shape.js` 与 `probe-record-shape.js` 里各有一句「已接进载体第 9 段
  #   （RECORD-WARN-INJECT）」· `probe-crossref.js` 注释 · CHG-127/128/129）—— ★ **2026-09-16 更正**：
  #   这里原先引的是**行号**（`record-shape.js:86` · `probe-record-shape.js:46`），实测那两个行号
  #   **从来没对过**（11 个版本块检查点、命中 0），已换成**可 grep 的字符串** ——
  #   `SOUL.md`：**写死的值会腐烂，指针不会。** 见 ISS-117。
  #   **插在中间 = 让那 5 处静默失效**
  #   （它们指向的段落会变成另一个）。段号是**位置别名**，只能追加、不能插入 ——
  #   这与 `DEC-037` 同族：**引用点指向的东西必须真的还是那个东西**。
  echo
  echo "=== RECORD-CLI-BIDIR (andyngo-record.sh 双向测) ==="
  if [[ -f "$ROOT/.check/tests/andyngo-record-test.sh" ]]; then
    ( cd "$ROOT" && bash .check/tests/andyngo-record-test.sh 2>&1 )
    seg "   （0 = 全过 · 1 = 有断言不符；红的那条会写明是「守卫哑了」还是「并发撞号」）"
  else
    skip "无 .check/tests/andyngo-record-test.sh"
  fi

  # 【2026-09-16 加，W23 J14 · ISS-068 / ISS-069 / ISS-079】`alloc.sh` 的**幂等追加**双向测。
  # **为什么加**：那三条 high 记的是「带 `⚠️ Sandbox bypassed` 提示的命令实际被执行了两次」→
  # 同一条命令追加出**两行逐字相同**的记录（实测 **10 对**）。处置机制是 `alloc.sh` 的幂等追加，
  # 而它**此前没有任何常驻测试**（`ISS-079` 自述双向测是「**即时的（同一条命令内就能验完）**」
  # = **一次性验证**）。本段测的是「**防止重复的那个机制还活着吗**」——
  # 不是「记录里有没有重复」：前者保证**下一次不再发生**，后者只是事后清点。
  # ★ **追加在末尾**（第 11 段），理由同上一段：**段号是位置别名**（DEC-039）。
  echo
  echo "=== ALLOC-IDEMPOTENT (alloc.sh 幂等追加双向测) ==="
  if [[ -f "$ROOT/.check/tests/alloc-idempotent-test.sh" ]]; then
    ( cd "$ROOT" && bash .check/tests/alloc-idempotent-test.sh 2>&1 )
    seg "   （0 = 全过 · 1 = 有断言不符；红的那条会写明是「幂等失效」还是「门被写成什么都写不进去」）"
  else
    skip "无 .check/tests/alloc-idempotent-test.sh"
  fi

  # 【2026-09-16 加，W23 J14 · ISS-096】载体**自己退出码**的双向测（= 本尺子的尺子）。
  # **为什么必须有它**：本段所在这个文件改的正是**顶层门禁自己的退出码** ——
  # 它比任何一条普通判据都更需要尺子。改前的形状是「最后一条命令是 `cat`，所以 rc 恒 0」：
  # **人读报告能看到 `EXIT=1`，机器读 rc 永远看到绿**。而本文件反复写的规矩是
  # 「**判据与它的双向测必须一起跑**」—— **一条恒说 OK 的门禁，和没有门禁长得一样。**
  # **它怎么不递归**：尺子用 `PROJECT_ROOT` 指向**假根**（里面只有一个 `.check/acceptance.js`），
  # 假根下没有 `skills/`、也没有本测试 → 内层载体的本段 `SKIP`。
  # ★ 顺带一个**必须说清**的后果（ISS-096 剩余缺口）：假根下**其它段也都 `SKIP`** →
  #   内层载体因此 **rc=2**（拒跑）而不是 0。**这正是新语义要的效果** ——
  #   所以尺子的 ③ 断言的是「**rc ≠ 1**」（门不是恒红），不是旧语义下的「rc = 0」。
  # **靠结构排除，不靠推理**（ISS-070：递归只能靠结构排除）。
  # ★ **追加在末尾**（第 12 段），理由同上两段：**段号是位置别名**（DEC-039）。
  # **本段自己也用 `seg`** —— 所以它红了会让载体 exit 1：**自洽**（门禁的退出码携带信息，
  # 包括它自己的尺子的结果）。
  echo
  echo "=== AUDIT-EXITCODE-BIDIR (载体退出码双向测) ==="
  if [[ -f "$ROOT/.check/tests/audit-exitcode-test.sh" ]]; then
    ( cd "$ROOT" && bash .check/tests/audit-exitcode-test.sh 2>&1 )
    seg "   （0 = 全过 · 1 = 有断言不符；② 红 = 载体退出码没携带信息（ISS-096）· ③ 红 = 门被写成什么都报红 —— 两者方向相反 · ⑤ 红 = SKIP 又被当成绿）"
  else
    skip "无 .check/tests/audit-exitcode-test.sh"
  fi

  # 【2026-09-16 加，W23 J17 · ISS-119】**本仓库的脚本不许用「env + 变量赋值」包装命令。**
  # 为什么：本机 `env` 解析到 `~/.local/bin/env` —— 一个**只把 `~/.local/bin` 加进 PATH、
  # 不执行任何命令**的 shell 存根，而 `~/.local/bin` 在 PATH 里**排在 `/usr/bin` 之前**。
  # 于是 `env VAR=VAL cmd` **静默变成空操作且 rc=0**：报成功、什么都不做 ——
  # 最坏的一类失效（同 DEC-019 家族）。
  # 实测代价：`write-lock-test.sh` 用它包装取锁命令 → 锁**从没被创建** →
  # 第 17 项的内层守卫看不见锁 → **递归**（实测 60 个 bash 进程；`TaskStop` 只杀最外层，
  # 要靠按命令行逐个 `Stop-Process` 才清干净）。
  # ★ 判据为什么是**静态的**（查写法）而不是**行为**的（查本机 env）：
  #   修不修 `~/.local/bin/env` 是**环境**的事、不是仓库的事；而一条「永远红」的断言
  #   会被训练成忽略（DEC-019）。仓库能保证的只有「**自己不踩这个坑**」——
  #   所以这里判写法；本机 env 的真实行为**只报不判**，给人看。
  # ★ **追加在末尾**（不插入）：段号是位置别名（DEC-039）。
  echo
  echo "=== ENV-NOT-A-NOOP (不许用「env + 变量赋值」包装命令) ==="
  ENV_HITS=$(grep -rnE '(^|[^A-Za-z0-9_./-])env [A-Z_][A-Z0-9_]*=' \
    --include='*.sh' "$ROOT/.check" "$ROOT/skills" 2>/dev/null \
    | grep -vE '^[^:]+:[0-9]+: *#' | wc -l | tr -d ' ')
  echo "仓库 .sh 里「env + 变量赋值」的写法：$ENV_HITS 处（**必须 0**）"
  if [ "$ENV_HITS" = "0" ]; then
    seg 0 "   （0 处 —— 没有命令被交给一个可能被遮蔽的 env）"
  else
    grep -rnE '(^|[^A-Za-z0-9_./-])env [A-Z_][A-Z0-9_]*=' --include='*.sh' \
      "$ROOT/.check" "$ROOT/skills" 2>/dev/null | grep -vE '^[^:]+:[0-9]+: *#' | sed 's/^/      /'
    seg 1 "   （$ENV_HITS 处 —— 在本机这些调用**全部是空操作**，ISS-119）"
  fi
  # 本机事实（**只报不判**）
  env sh -c 'exit 7' >/dev/null 2>&1
  ENV_PROBE_RC=$?
  echo "本机 env 路径：$(command -v env 2>/dev/null || echo '(找不到)')"
  echo "本机 env 行为：\`env sh -c 'exit 7'\` → rc=$ENV_PROBE_RC（7 = 真执行了命令 · 0 = **空操作存根**，ISS-119）"

  # ── 【2026-09-17 加，W23 J18 · 用户裁决「本机只保留 /andyngo」】────────────────────
  # 起因：`skills/andy/`（v5.0 分支）按裁决移出本机（`.backup-strip-20260917-2232/skills/`），
  # 而**下面这 6 条尺子的唯一可执行调用点原本就在 `skills/andy/scripts/andy-audit.sh` 里**。
  # 实测（不是推测）：`node .check/tests/ruler-callpoint.js` → **rc=1**，报
  #   R1「可执行调用点 0 个」**6 条**：`artifacts-index.js` · `battery-relative-test.sh` ·
  #   `evt-field-shape.js` · `hardcoded-count.js` · `judge-selftest.sh` · `x1-freshness-test.sh`。
  #
  # **为什么是「改接到本载体」而不是「把这 6 条一起删掉」**：这 6 条**不是 `andy` 专属** ——
  # 它们判的是**通用**的东西（产物登记 / 电池相对基底 / EVT 字段形状 / 写死的计数 /
  # 尺子自测 / X1 新鲜度）。跟着陪葬等于**白丢 6 条判据**，与「完整运作的前提下」冲突。
  # （对照：**真正 `andy` 专属**的 4 条 `andy-*.sh|js` 已随该 skill 一起移出，见备份区 `tests/`。）
  #
  # **递归已排除**（实测）：这 6 条里没有任何一条回调本载体（`grep -n "audit.sh" 六条` → 只命中
  # 本注释自身），所以把它们接进来**不会**造成载体自我调用。
  # **段号是位置别名（DEC-039）：只追加、不插入。** 段位总数是**运行时**统计的
  # （收尾打印 `$SEGS`），这里**没有写死的数字**要同步改。

  echo
  echo "=== ARTIFACTS-INDEX ==="
  if [[ -f "$ROOT/.check/tests/artifacts-index.js" ]]; then
    ( cd "$ROOT" && node .check/tests/artifacts-index.js 2>&1 )
    seg
  else
    skip "无 .check/tests/artifacts-index.js"
  fi

  echo
  echo "=== EVT-FIELD-SHAPE ==="
  if [[ -f "$ROOT/.check/tests/evt-field-shape.js" ]]; then
    ( cd "$ROOT" && node .check/tests/evt-field-shape.js 2>&1 )
    seg
  else
    skip "无 .check/tests/evt-field-shape.js"
  fi

  echo
  echo "=== HARDCODED-COUNT ==="
  if [[ -f "$ROOT/.check/tests/hardcoded-count.js" ]]; then
    ( cd "$ROOT" && node .check/tests/hardcoded-count.js 2>&1 )
    seg
  else
    skip "无 .check/tests/hardcoded-count.js"
  fi

  echo
  echo "=== JUDGE-SELFTEST ==="
  # 【2026-09-17 · B · ISS-149】本段原为「存在就跑、跑完 `seg`」—— 而 `judge-selftest.sh`
  #   在**规格定位不到**时 `exit 2`（拒跑），于是 `seg` 记下 `EXIT=2` ⇒ 进 `FAILED`
  #   ⇒ 载体报 **rc=1（失败）而不是 rc=2（拒跑）**。**语义反了**：「规格不在本机」是
  #   **环境性缺席**（不是每台机器都有那份规格），不是判据失败。
  #   **同形先例**：ISS-139 对 `write-lock-test.sh` 的持锁拒跑做过同样的映射，但那一轮
  #   明写「`andyngo-audit.sh`（v4.x 载体）**不扩面**」⇒ **本段漏了**（同 ISS-149 的另一半：
  #   内层判据打行首 `SKIP ` 污染计数契约）。
  #   **修法照 v5.0 载体**：**载体先探规格**，探不到就 `skip`（**根本不跑判据**）；
  #   探到才跑，且**捕获输出 + 缩进 4 格**（防内层行首 `SKIP ` 污染计数契约）。
  NGSPEC=$(find_spec)
  if [[ ! -f "$ROOT/.check/tests/judge-selftest.sh" ]]; then
    skip "无 .check/tests/judge-selftest.sh"
  elif [[ -z "$NGSPEC" || ! -f "$NGSPEC" ]]; then
    skip "未找到 andyngo 规格（可用 ANDYNGO_SPEC 指定路径）—— 判据会 rc=2 拒跑，故本段不跑它"
  else
    js_out=$( cd "$ROOT" && bash .check/tests/judge-selftest.sh "$NGSPEC" 2>&1 ); rcj=$?
    if [[ -n "$js_out" ]]; then printf '%s\n' "$js_out" | sed 's/^/    | /'; fi
    seg "$rcj" "   （0 = 全部通过 · 1 = 有失败项 · 2 = 拒跑）"
  fi

  echo
  echo "=== X1-FRESHNESS ==="
  if [[ -f "$ROOT/.check/tests/x1-freshness-test.sh" ]]; then
    ( cd "$ROOT" && bash .check/tests/x1-freshness-test.sh 2>&1 )
    seg
  else
    skip "无 .check/tests/x1-freshness-test.sh"
  fi

  # ★ 以下两条是**第二批**发现的（第一批修完 SKIP_REL 之后才浮出来）：
  # 它们原先看似「有调用点」，而那个调用点其实是**发布副本** `.check/tmp/publish/` 里的同名文件
  # 给的**假命中** —— 一旦把 `.check/tmp` 排除出扫描面（`ruler-callpoint.js` 的 `SKIP_REL`），
  # 真实调用点就暴露为 **0**。**这正是「假命中会把判据弄瞎」的现场**（ISS-074 家族）。
  echo
  echo "=== LOCK-COVERAGE ==="
  if [[ -f "$ROOT/.check/tests/lock-coverage.js" ]]; then
    ( cd "$ROOT" && node .check/tests/lock-coverage.js 2>&1 )
    seg
  else
    skip "无 .check/tests/lock-coverage.js"
  fi

  echo
  echo "=== RULER-CALLPOINT ==="
  if [[ -f "$ROOT/.check/tests/ruler-callpoint.js" ]]; then
    ( cd "$ROOT" && node .check/tests/ruler-callpoint.js 2>&1 )
    seg
  else
    skip "无 .check/tests/ruler-callpoint.js"
  fi

  # ★ 放最后：它跑 3 套电池，约 80 秒（耗时最长的一段）。
  echo
  echo "=== BATTERY-RELATIVE ==="
  if [[ -f "$ROOT/.check/tests/battery-relative-test.sh" ]]; then
    ( cd "$ROOT" && bash .check/tests/battery-relative-test.sh 2>&1 )
    seg
  else
    skip "无 .check/tests/battery-relative-test.sh"
  fi
} > "$REPORT" 2>&1

# 【2026-09-16 加，W23 J14 · ISS-096】汇总 + 退出码。
# **报告文本一字未改** —— 上面那些 `EXIT=` 行原样保留（**人读的是它**）；
# 这里只**追加**一行汇总，然后把「**机器读的那一半**」接上：有非零段 → 1，否则 → 0。
# `{ ... } >> "$REPORT"` 与上面一样是**同一 shell**，不是子 shell（`>>` 也不影响可见性）。
{
  echo
  if [ "$FAILED" -gt 0 ]; then
    echo "★ 载体退出码 **1**：报告里有 **$FAILED** 段非零（共 $SEGS 段 \`EXIT=\` 行）—— 逐段看上面的 \`EXIT=\` 行。"
    if [ "$SKIPPED" -gt 0 ]; then
      echo "  另有 **$SKIPPED** 处 \`SKIP\` —— **rc 取 1（失败）而不是 2（拒跑）**：确定的负面优先于缺失。"
    fi
  elif [ "$SKIPPED" -gt 0 ]; then
    echo "★ 载体退出码 **2**（拒跑 · 结果不完整）：**$SKIPPED** 处 \`SKIP\`，其余 $SEGS 段 \`EXIT=0\`。"
    echo "  **「没跑成」不等于「跑了且合格」** —— 逐段看上面的 \`SKIP\` 行，" 
    echo "  确认是「本机没有这个件」（正常）还是「件丢了」（要修）。"
  else
    echo "载体退出码 **0**：全部 $SEGS 段 \`EXIT=0\`。"
  fi
} >> "$REPORT"

cat "$REPORT"

# 【ISS-096 + 剩余缺口】退出码必须携带信息，**三态**：
#   0 = 全跑成且全合格 · 1 = 有段不合格（**确定**的负面）· 2 = 有段没跑成（**缺失**）。
# 「没跑成」**不能**报 0 —— 那是把「不知道」当成「通过」（ISS-096 的同族假绿）。
if [ "$FAILED" -gt 0 ]; then exit 1; fi
if [ "$SKIPPED" -gt 0 ]; then exit 2; fi
exit 0
