#!/usr/bin/env bash
# 载体退出码的**双向测**（ISS-096 的尺子）—— 2026-09-16 W23 J14 加。
#
# ── 为什么必须有它 ────────────────────────────────────────────────────────────
# ISS-096：`andyngo-audit.sh`（**顶层门禁**）**永远 exit 0**。成因：脚本最后一条命令是
# `cat "$REPORT"`，所以退出码永远来自 `cat`；每个子命令的 rc 只是 `echo "EXIT=$?"`
# **打进报告文本**，不进退出码。**于是 `acceptance` 报 FAIL 时载体照样 exit 0** ——
# 人读报告能看到 `EXIT=1`，**机器读 rc 永远看到绿**。
#
# 本仓库的规矩是「**判据与它的双向测必须一起跑**」。而这次要修的是**顶层门禁自己的退出码** ——
# 它比任何一条普通判据都更需要尺子：**一条恒说 OK 的门禁，和没有门禁长得一样。**
#
# ── 怎么造出「可控的假失败」（不碰真记录）────────────────────────────────────
# 载体开头是 `ROOT="${PROJECT_ROOT:-$PWD}"` —— 把 `PROJECT_ROOT` 指向**假根**，
# 假根里只放一个 `.check/acceptance.js`：
#     `process.exit(1)` → 假失败      `process.exit(0)` → 假成功
# 真树其余文件在假根下都不存在 → 各段 SKIP → **不会递归**（假根里没有本测试）。
# **`ANDYNGO_SPEC` 必须显式指向不存在的路径** —— 否则载体探测到
# `$HOME/Desktop/andyngo build.md.txt`（真规格）→ SPEC 段会跑真判据，把假根测试污染掉。
#
# ── 五组断言（成对，防「门被写成永远返回真 / 假」）──────────────────────────
#   ① **到达性**：假失败那跑的报告里必须出现 `EXIT=1`
#        —— 先证明「那个失败**真的到达了**载体」，否则下面 ② 的 rc=1 可能是别的原因
#           （ISS-113 的教训：验证「某条守卫拦住了 X」时，必须先证明「X 真的到达了守卫」）
#   ② **主断言**：假失败 → 载体 **rc=1**（这就是 ISS-096 要修的东西）
#   ③ **反向守门人**：假成功 → 载体 **rc ≠ 1**
#        —— 没有它，把收尾写成 `exit 1` 就能让 ①②④ 全过（**门被写成什么都报红**）
#        ★ **断言的是「≠ 1」而不是「= 0」**：假根下其余各段都 `SKIP`，所以假成功那跑
#          按新语义应当是 **rc=2**（拒跑）。「= 0」是**旧语义下的**期望，
#          照抄它会把**正确的**新行为判成红。③ 的本意是「门不是恒红」，`≠ 1` 才是它的原话。
#   ④ **形态未变**：两跑的报告里 `EXIT=` 行都仍是 `EXIT=<数字>` 形式
#        —— 退出码变了，但**报告文本那一半必须保住**（人读的是它）
#   ⑤ **SKIP 语义**：假成功那跑**必然有 `SKIP`** → 载体 **rc=2**
#        —— 这正是 ISS-096 的**剩余缺口**：「没跑成」与「跑了且合格」必须在 rc 上分开。
#          没有它，把 `SKIP` 写回「只打印、不计数」就能让 ①②③④ 全过。
#
# 用法：bash .check/tests/audit-exitcode-test.sh
# 退出码：0 全过 / 1 有断言不符 / 2 拒跑（夹具或载体建不起来）
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2

CARRIER="$ROOT/skills/andyngo/scripts/andyngo-audit.sh"
if [ ! -f "$CARRIER" ]; then
  echo "拒跑：无 $CARRIER"; exit 2
fi

D=$(mktemp -d) || { echo "拒跑：mktemp 失败"; exit 2; }
trap 'rm -rf "$D"' EXIT

win() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

pass=0; fail=0
ok()  { echo "PASS  $1"; pass=$((pass + 1)); }
bad() { echo "FAIL  $1"; fail=$((fail + 1)); }

echo "=== 载体退出码 · 双向测（ISS-096）==="
echo "载体: $CARRIER"

# ── 假根工厂：$1 = 目录名，$2 = acceptance 的退出码 ─────────────────────────
mkrg() {
  local rg="$D/$1"
  mkdir -p "$rg/.check"
  printf 'process.exit(%s);\n' "$2" > "$rg/.check/acceptance.js"
  printf '%s' "$rg"
}

# ── 跑载体：$1 = 假根 → 打印报告路径；退出码写进 $D/rc.txt ──────────────────
# ★ 为什么必须**写文件**而不是赋值给全局变量：调用处是 `REP1=$(runcarrier …)`，
#   而**命令替换会创建子 shell** —— 函数内对全局变量的赋值**不会传回父 shell**。
#   第一版就是 `RC=$?` + 调用处 `RC1=$RC`，实测**永远读到 0**：载体明明已 rc=1，
#   尺子仍报 ② FAIL（**测的是上一层**，同 ISS-034 的形状）。
#   **这是本尺子自己踩过的坑，写在这里留证** —— 「判据报红时先怀疑判据自己」。
runcarrier() {
  local rg="$1"
  ANDYNGO_SPEC="$D/nonexistent-spec.txt" PROJECT_ROOT="$(win "$rg")" \
    bash "$CARRIER" > "$D/stdout.txt" 2>&1
  echo "$?" > "$D/rc.txt"
  ls -1t "$rg"/.check/audit/*/audit-*.txt 2>/dev/null | head -1
}

# ══ 假失败 ═══════════════════════════════════════════════════════════════════
RG1=$(mkrg fakefail 1)
REP1=$(runcarrier "$RG1"); RC1=$(cat "$D/rc.txt")

echo
echo "--- ① 到达性：假失败必须真的到达载体（报告里出现 EXIT=1）---"
if [ -n "$REP1" ] && grep -q '^EXIT=1' "$REP1" 2>/dev/null; then
  ok "① 报告里出现 EXIT=1 —— 假失败**真的到达了**载体（不是被 SKIP 掉）"
else
  bad "① 报告里没有 EXIT=1 —— 假失败没到达载体，下面 ② 的结论**无效**（报告=$REP1）"
fi

echo "--- ② 主断言：假失败 → 载体 rc=1 ---"
if [ "$RC1" = "1" ]; then
  ok "② 假失败 → 载体 rc=1（**ISS-096 已修**：顶层门禁的退出码携带信息）"
else
  bad "② 假失败 → 载体 rc=$RC1（**应为 1** —— 退出码不携带信息就是 ISS-096）"
fi

# ══ 假成功 ═══════════════════════════════════════════════════════════════════
RG2=$(mkrg fakeok 0)
REP2=$(runcarrier "$RG2"); RC2=$(cat "$D/rc.txt")

echo "--- ③ 反向守门人：假成功 → 载体 rc **不是 1**（门不是恒红）---"
if [ "$RC2" != "1" ]; then
  ok "③ 假成功 → 载体 rc=$RC2（**不是 1** —— 门没有被写成「什么都报红」）"
else
  bad "③ 假成功 → 载体 rc=1（**门被写成什么都报红了** —— 收尾可能硬编码了 exit 1）"
fi

echo "--- ⑤ SKIP 语义：假根必然有 SKIP → 载体 rc=2（「跑不成」不再伪装成绿）---"
ns=$(grep -c '^SKIP ' "$REP2" 2>/dev/null); ns=${ns:-0}
if [ "$RC2" = "2" ] && [ "$ns" -ge 1 ]; then
  ok "⑤ 假成功跑：报告里 $ns 处 SKIP · 载体 rc=2 —— **「没跑成」与「跑了且合格」在 rc 上分开了**（ISS-096 剩余缺口）"
else
  bad "⑤ 假成功跑：报告里 $ns 处 SKIP · 载体 rc=$RC2（**应为 ≥1 / 2** —— SKIP 又被当成绿了）"
fi

echo "--- ④ 形态未变：两跑的报告里 EXIT= 行仍是 EXIT=<数字> 形式 ---"
n1=$(grep -c '^EXIT=[0-9]' "$REP1" 2>/dev/null); n1=${n1:-0}
n2=$(grep -c '^EXIT=[0-9]' "$REP2" 2>/dev/null); n2=${n2:-0}
badfmt=0
for f in "$REP1" "$REP2"; do
  [ -n "$f" ] || continue
  c=$(grep -c '^EXIT=' "$f" 2>/dev/null); c=${c:-0}
  g=$(grep -c '^EXIT=[0-9]' "$f" 2>/dev/null); g=${g:-0}
  [ "$c" = "$g" ] || badfmt=$((badfmt + 1))
done
if [ "$n1" -ge 1 ] && [ "$n2" -ge 1 ] && [ "$badfmt" = "0" ]; then
  ok "④ 报告形态未变：假失败跑 $n1 条 · 假成功跑 $n2 条，**全部是 EXIT=<数字>**（没有畸形行）"
else
  bad "④ 报告形态变了：假失败跑 $n1 条 · 假成功跑 $n2 条 · 畸形 $badfmt 个（应 ≥1 / ≥1 / 0）"
fi

echo
echo "结论: $pass/$((pass + fail)) 条符合期望"
if [ "$fail" -gt 0 ]; then
  echo "★ ② 红 = 载体退出码没携带信息（ISS-096）；③ 红 = 门被写成什么都报红 —— 两者方向相反，不要混。"
  echo "  ⑤ 红 = SKIP 又被当成绿（ISS-096 的剩余缺口）—— 与 ③ 期望的是同一个数（2），但断言的不是同一件事。"
  exit 1
fi
exit 0
