#!/usr/bin/env bash
# 判据自测（守门人 + 截断弱点 + 独立性 + 假红）
# 用法: judge-selftest.sh [spec] [SKILL.md] [口径一脚本.sh] [口径二脚本.js]
#       四个参数全部可省：按脚本自身位置推导；推导不自洽则 **exit 2 拒跑**
# 退出码: 0 = 全部通过；1 = 有失败项；2 = 拒跑（参数/依赖定位不到，**没跑成**）
#
# 存在原因：独立验收（W6）判定 v1 的「两个口径」**不独立** —— 抽取行完全相同，
# 等于一条来源而非两条。本自测把该结论固化成可重跑的红灯。
#
# 坑（本项目踩过两次）：给原生 node.exe 传 /c/... 形式路径会变成 C:\c\...
# → 所以下面统一用 win() 转成 C:/... 再交给 node。

# 【2026-09-16 加，ISS-017】四参数缺省化 + **缺参即拒跑**
#   原版 `SPEC="$1"; SKILL="$2"; J1="$3"; J2="$4"` —— **缺参不报错，继续跑**。
#   实测裸跑（无参数）：`cygpath: can't convert empty path` ×3 · 口径一 rc=127（`bash ""`）·
#   口径二 rc=0（**空路径被当成了合法输入**）· 最后打印 **「自测结论: 有 8 项失败」**。
#   同 ISS-015 是**同一个形状**，我是横向扫兄弟脚本时发现的 —— 不是碰巧又踩到。
#   自测脚本撒谎的代价比判据撒谎更大：它正是用来证明「判据没撒谎」的那把尺子。
#   → 四参数可省（按脚本自身位置推导），推导不自洽 **exit 2 拒跑**，0/1/2 三态分开。
SELF_DIR=$(cd "$(dirname "$0")" && pwd)
REPO="${REPO:-$(cd "$SELF_DIR/../.." && pwd)}"
SKILL="${2:-$REPO/skills/andyngo/SKILL.md}"
J1="${3:-$SELF_DIR/card-entry-coverage.sh}"
J2="${4:-$SELF_DIR/card-entry-coverage2.js}"
SPEC="${1:-${SPEC:-}}"
if [ -z "$SPEC" ]; then
  for c in "$REPO/andyngo build.md.txt" "$HOME/Desktop/andyngo build.md.txt" "/c/Users/<user>/Desktop/andyngo build.md.txt"; do
    if [ -f "$c" ]; then SPEC="$c"; break; fi
  done
fi
miss=""
if [ -z "$SPEC" ] || [ ! -f "$SPEC" ]; then miss="$miss 规格('$SPEC')"; fi
[ -f "$SKILL" ] || miss="$miss SKILL.md('$SKILL')"
[ -f "$J1" ]    || miss="$miss 口径一('$J1')"
[ -f "$J2" ]    || miss="$miss 口径二('$J2')"
if [ -n "$miss" ]; then
  # 【2026-09-17 · B】行首 `SKIP ` 是**计数契约**（载体 `skip()` 上方注释 + `audit-exitcode-test.sh`
  # ⑤ 用 `grep -c '^SKIP '` 数它）。本行原为**行首** `SKIP ` ⇒ 经载体 `2>&1` 透传后，报告里
  # `^SKIP ` 的行数与 `SKIPPED` 计数器**对不上**（口径分叉）。这与 ISS-139 修掉的
  # `write-lock-guard.sh:65` 是**同一个形状** —— 那一处修了，这一处漏了。
  # **缩进 5 格**：证据保留、契约行不再碰撞（与下一行对齐）。
  echo "     SKIP 定位不到：$miss" >&2
  echo "     拒绝在错的路径上跑出「有 N 项失败」—— 那是把「没跑成」伪装成「判据坏了」" >&2
  exit 2
fi

fail=0
pass() { echo "  [PASS] $1"; }
bad()  { echo "  [FAIL] $1"; fail=$((fail+1)); }

# POSIX 路径 → Windows 形式（只给原生 node 用）
# 优先 cygpath -m：它连 /tmp/... 这种「非盘符」路径也能正确映射
# （手写规则只认 /c/... 形式，会把 /tmp/x 错转成 T:/x —— 本次自测就是这么挂的）
win() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$1"
  else
    case "$1" in /[a-z]/*) echo "$(echo "${1:1:1}" | tr 'a-z' 'A-Z'):${1:2}";; *) echo "$1";; esac
  fi
}
# 只看代码行，不看注释（否则注释里提一句就误判）
code_bash() { grep -v '^[[:space:]]*#' "$1"; }
code_js()   { sed 's|//.*||; s|^[[:space:]]*\*.*||' "$1"; }

SPEC_W=$(win "$SPEC"); SKILL_W=$(win "$SKILL"); J2_W=$(win "$J2")

echo "===== 判据自测 ====="

echo
echo "--- T1 守门人：规格路径不存在 → 必须 UNVERIFIED(2)，不许空集 PASS(0) ---"
bash "$J1" /c/nonexist/spec.md "$SKILL" >/dev/null 2>&1; r1=$?
node "$J2_W" /c/nonexist/spec.md "$SKILL" >/dev/null 2>&1; r2=$?
echo "  口径一 rc=$r1   口径二 rc=$r2 （期望都是 2）"
[ "$r1" -eq 2 ] && pass "口径一 守门人拦住空转" || bad "口径一 rc=$r1"
[ "$r2" -eq 2 ] && pass "口径二 守门人拦住空转" || bad "口径二 rc=$r2"

echo
echo "--- T2 守门人：锚点被抽走 → 口径二必须 UNVERIFIED(2) ---"
TMP=$(mktemp -d)
sed 's/一页速查卡/一页查无此卡/' "$SPEC" > "$TMP/spec-noanchor.md"
node "$J2_W" "$(win "$TMP/spec-noanchor.md")" "$SKILL_W" >/dev/null 2>&1; r=$?
echo "  口径二 rc=$r （期望 2）"
[ "$r" -eq 2 ] && pass "锚点缺失时不报 PASS" || bad "口径二 rc=$r"

echo
echo "--- T3 截断弱点：把 security 写成 security-scan → 必须报缺口，不许假绿 ---"
mkdir -p "$TMP/fixture"
sed 's|/andyngo security`|/andyngo security-scan`|' "$SKILL" > "$TMP/fixture/SKILL.md"
echo "  夹具里 security-scan 出现 $(grep -c 'andyngo security-scan' "$TMP/fixture/SKILL.md") 次"
bash "$J1" "$SPEC" "$TMP/fixture/SKILL.md" 2>&1 | grep -E '缺口|VERDICT' | sed 's/^/  口径一 | /'
bash "$J1" "$SPEC" "$TMP/fixture/SKILL.md" >/dev/null 2>&1; a=$?
node "$J2_W" "$SPEC_W" "$(win "$TMP/fixture/SKILL.md")" >/dev/null 2>&1; b=$?
echo "  口径一 rc=$a   口径二 rc=$b （期望都是 1）"
[ "$a" -eq 1 ] && pass "口径一 抓到 security-scan（旧 [a-z]+ 正则会假绿）" || bad "口径一 rc=$a"
[ "$b" -eq 1 ] && pass "口径二 抓到 security-scan" || bad "口径二 rc=$b"

echo
echo "--- T4 独立性：两口径不得共用抽取机制（只比代码行，不比注释）---"
code_bash "$J1" > "$TMP/c1.txt"; code_js "$J2" > "$TMP/c2.txt"
grep -q '1185,1207' "$TMP/c1.txt" && pass "口径一 用硬编码行号定位" || bad "口径一 无硬编码行号"
grep -q 'sed -n' "$TMP/c2.txt" && bad "口径二 复用 sed 行号定位（同源）" || pass "口径二 不用 sed 行号"
grep -q 'comm -23 <(' "$TMP/c2.txt" && bad "口径二 复用 comm 求差集（同源）" || pass "口径二 不用 comm"
grep -q '一页速查卡' "$TMP/c1.txt" && bad "口径一 也用锚点（机制趋同）" || pass "口径一 不用锚点"
grep -q '一页速查卡' "$TMP/c2.txt" && pass "口径二 用锚点文本定位" || bad "口径二 无锚点"
shared=$(comm -12 <(sort -u "$TMP/c1.txt") <(sort -u "$TMP/c2.txt") | grep . | wc -l)
echo "  两脚本共有的非注释行数 = $shared"
[ "$shared" -eq 0 ] && pass "两口径零共享代码行" || echo "  [注意] 共有 $shared 行（人工确认是否只是 shebang/空行）"

echo
echo "--- T5 该绿的绿：现盘必须 PASS(0) ---"
bash "$J1" "$SPEC" "$SKILL" >/dev/null 2>&1; a=$?
node "$J2_W" "$SPEC_W" "$SKILL_W" >/dev/null 2>&1; b=$?
echo "  口径一 rc=$a   口径二 rc=$b （期望都是 0）"
[ "$a" -eq 0 ] && pass "口径一 现盘 PASS" || bad "口径一 rc=$a"
[ "$b" -eq 0 ] && pass "口径二 现盘 PASS" || bad "口径二 rc=$b"

rm -rf "$TMP"
echo
if [ "$fail" -eq 0 ]; then echo "自测结论: 全通过（0 失败）"; exit 0; fi
echo "自测结论: 有 $fail 项失败"; exit 1
