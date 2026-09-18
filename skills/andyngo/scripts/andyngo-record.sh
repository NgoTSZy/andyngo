#!/usr/bin/env bash
set -euo pipefail

RECORD_ROOT="${RECORD_ROOT:-$PWD/.check/record}"
DATE=$(date -u +%Y-%m-%d)
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
LOG="$RECORD_ROOT/eventlog/$DATE.txt"

mkdir -p "$(dirname "$LOG")"

EV="${5:-}"
if [[ -n "$EV" && "$EV" != "--" && ! -f "$EV" ]]; then
  echo "FAIL evidence_ptr 不存在: $EV" >&2
  exit 1
fi

# ── 取号 + 追加：**转调 `newid.js`，不自己做** ───────────────────────────────
# ★ 2026-09-16 W23 J14（ISS-108）。为什么必须改（**实测，不是推理**）：
#   本脚本原先用 `LAST=$(grep … | tail -1)` 取最大号、`SEQ=$((LAST+1))` 算下一个号、
#   再裸 `>>` 追加 —— 取号是**两次操作**，中间那段窗口里另一个写者可以插队，
#   而这正是 DEC-027 明文禁止的形态。**同一次 10 进程并发实验**（尺子：
#   `bash .check/tests/andyngo-record-test.sh` 第 ⑥ 段；改前 3 次重复跑、方差为 0）：
#     本脚本  → **唯一 seq 3/10**，重复号 `001 002 003`（10 行全在，一个字节没丢）
#     newid.js → **10/10**，零重复、零残留锁
#   「没丢东西」不等于「没坏」（DEC-026）：每一行都读得通，坏的是「号 → 内容」的唯一性
#   —— 同 ISS-035/036/037、DEC-021/022 已发生的事故。
#   所以这里**必须**转调，不能自己取号。
#
# **不变的三样**（规格 §验证第 3/5 项测的就是它们，也是「保留原本的要求」）：
#   CLI（5 个位置参数）· evidence 校验的 `rc=1` · 输出行的形态（`EVT <号> <TS> …`）。
# 给原生 node.exe 传路径**必须**是 Windows 形式：Git Bash 的 `/c/...` 会被解析成 `C:\c\...`
# （ISS-003 家族，本仓库已踩 5 次）。**只在转换器存在时转** —— 不存在（Linux/WSL）时
# 原样就是对的，所以这不是「平台开关」（DEC-023 那种「让检查不跑的开关」），是「有转换器才用」。
# 不用 `cd` 绕：那会改掉 `$EV` 的解析基准（它按调用方 cwd 解析）。
#
# ★ 这一段是**第一版漏掉的地方，实测抓到**（不是审出来的）：第一版只转了 `$LOG`、
#   没转 `NEWID` —— 于是 `[[ -f "$NEWID" ]]`（bash，认 POSIX 路径）**通过**，
#   而 `node "$NEWID"`（原生 exe，把 `/c/...` 读成 `C:\c\...`）报
#   `Cannot find module 'C:\c\Users\...\newid.js'`，脚本 rc=1 且**一行都没写**。
#   形状：**守门人检查的通道 ≠ 真正使用的通道**（DEC-037 —— 我在同一轮里刚立的规则，
#   转头自己踩了一次）。所以修法不只是补一次转换，而是：两处路径**都**走同一个 `win()`，
#   且存在性检查放在**转换之后**（检查的路径 == 使用的路径）。
win() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
NEWID="$(win "$(cd "$(dirname "$0")/../../.." && pwd)/.check/record/newid.js")"
if [[ ! -f "$NEWID" ]]; then
  echo "FAIL 找不到 newid.js（取号必须走它，禁止先读后写，DEC-027）: $NEWID" >&2
  exit 1
fi
LOG_NODE="$(win "$LOG")"

# 正文用**内联**形式：它是本脚本自己拼的（`$TS` + 5 个位置参数），不经过调用方的引号层，
# 所以没有 ISS-048 那个「反引号被 shell 吃掉片段」的暴露面；而 `newid.js` 的 WARN
# 只在内联路径生效，此处它恰是适用的。stderr **不捕获** —— 让 WARN / ALLOC-FAIL 原样透给调用方。
out=$(node "$NEWID" "$LOG_NODE" EVT ' ' "$TS $1 $2 $3 $4 $5") || exit $?

# 断言 newid.js 真的回了号。**不能省**：少了它，一旦它的输出格式变了，本脚本会把一条
# **残缺的行**静默写进只增不改的事件流（同 ISS-048「读得通但有空洞」的形状）。
case "$out" in
  'ALLOC '*) ;;
  *) echo "FAIL newid.js 未返回 ALLOC 行（可能未写入）: $out" >&2; exit 1 ;;
esac

echo "${out#ALLOC } $TS $1 $2 $3 $4 $5"
