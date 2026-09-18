#!/usr/bin/env bash
# `andyngo-record.sh` 的**双向测**（尺子）—— 测的是「它转调 `newid.js`」这件事本身。
#
# ── 为什么必须有（ISS-108 / CHG-135，2026-09-16 W23 J14）────────────────────
# 本脚本原先**自己取号**（`LAST=$(grep …|tail -1)` + `SEQ=$((LAST+1))` + 裸 `>>`）——
# 那是 DEC-027 明文禁止的形态。改成转调 `newid.js` 之后，**只跑一次成功写入不算验证**：
# 那只测了 happy path。真正要钉住的是四条「它会不会响 / 会不会哑」：
#   ① 新加的 `case "$out" in 'ALLOC '*)` 断言**真的会响**（不是永远绿的空断言）
#   ② `|| exit $?` **真的透传** `newid.js` 的退出码（不是永远 1）
#   ③ 存在性守卫**真的会响**（把 `newid.js` 拿掉 → rc=1，不是静默继续）
#   ④ 拒写发生在**取号之前**（evidence 不存在时不调用 `newid.js`）——
#      否则「rc=1」只是「写完之后才失败」，事故照样落盘
#   ⑤ 并发下**唯一 seq == 进程数**（这条才是 ISS-108 的本体）
#
# ── 做法：注入假 `newid.js` ──────────────────────────────────────────────
# 在一个**假根**里放一份本脚本的副本，让它的 `../../..` 指向假根 —— 于是可以喂给它
# 各种「坏 newid.js」（回错格式 / 透传 5 / 写副作用标记）。**不碰真树**，
# 所以它既能测到红分支，又不会污染真记录。
#
# 用法: bash .check/tests/andyngo-record-test.sh [被测脚本]
#   不给参数 → 测真树里的 `skills/andyngo/scripts/andyngo-record.sh`
#   给参数   → 测指定的脚本（**反向验证用**：拿改前的归档件跑同一把尺子，它必须红）
# 退出码: 0 = 全过 · 1 = 有断言不符
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
REAL="${1:-$ROOT/skills/andyngo/scripts/andyngo-record.sh}"
if [ ! -f "$REAL" ]; then echo "找不到被测脚本: $REAL"; exit 1; fi

D=$(mktemp -d)
trap 'rm -rf "$D"' EXIT
mkdir -p "$D/skills/andyngo/scripts" "$D/.check/record"
cp "$REAL" "$D/skills/andyngo/scripts/andyngo-record.sh"
S="$D/skills/andyngo/scripts/andyngo-record.sh"
FAKE="$D/.check/record/newid.js"

pass=0; fail=0
ok()   { pass=$((pass+1)); echo "PASS  $1"; }
no()   { fail=$((fail+1)); echo "FAIL  $1"; }
chkrc() { if [ "$1" = "$2" ]; then ok "rc=$2（期望 $1）· $3"; else no "rc=$2（期望 $1）· $3"; fi; }

echo "===== andyngo-record.sh 双向测 ====="

# ── ① 正向控制：假 newid.js 正常回号 ────────────────────────────────────
# 没有它，下面每一条 FAIL 都可能是「脚本根本没跑起来」，而不是「守卫响了」。
cat > "$FAKE" <<'EOF'
console.log('ALLOC EVT 007'); process.exit(0);
EOF
R=$(mktemp -d)
out=$(RECORD_ROOT="$R" bash "$S" W23 J14 OK art -- 2>/dev/null); rc=$?
chkrc 0 "$rc" "正向控制：正常回号"
case "$out" in
  'EVT 007 '*) ok "正向控制：输出形态 \`$out\`";;
  *) no "正向控制：输出形态不符 → \`$out\`";;
esac
rm -rf "$R"

# ── ② 退出码透传：假 newid.js 回 5（`--check` 发现未登记撞号）────────────
# 钉住 `|| exit $?` —— 若写成 `|| exit 1`，这条会 FAIL。
cat > "$FAKE" <<'EOF'
console.error('DUP 未登记撞号'); process.exit(5);
EOF
R=$(mktemp -d)
RECORD_ROOT="$R" bash "$S" W23 J14 OK art -- >/dev/null 2>&1; rc=$?
chkrc 5 "$rc" "退出码透传：newid.js 回 5 → 脚本也回 5"
rm -rf "$R"

# ── ③ ALLOC 断言：假 newid.js **回 0 但不回 ALLOC 行** ───────────────────
# 这是最该钉的一条：少了它，一条**残缺的行**会被静默写进只增不改的事件流
# （同 ISS-048「读得通但有空洞」）。假 newid.js 还真的**写一行**，模拟「写坏格式」。
cat > "$FAKE" <<'EOF'
require('fs').appendFileSync(process.argv[2], 'GARBAGE\n');
console.log('something else'); process.exit(0);
EOF
R=$(mktemp -d)
err=$(RECORD_ROOT="$R" bash "$S" W23 J14 OK art -- 2>&1 >/dev/null); rc=$?
chkrc 1 "$rc" "ALLOC 断言：回 0 但格式不符 → 脚本回 1"
case "$err" in
  *'未返回 ALLOC 行'*) ok "ALLOC 断言：stderr 有明确原因";;
  *) no "ALLOC 断言：stderr 缺少原因 → \`$err\`";;
esac
rm -rf "$R"

# ── ④ 存在性守卫：把假 `newid.js` 拿掉 ─────────────────────────────────
# 反向验证 —— 证明那条 `[[ -f "$NEWID" ]]` 不是永远绿的。
mv "$FAKE" "$FAKE.off"
R=$(mktemp -d)
err=$(RECORD_ROOT="$R" bash "$S" W23 J14 OK art -- 2>&1 >/dev/null); rc=$?
chkrc 1 "$rc" "存在性守卫：newid.js 不在 → 脚本回 1（不是静默继续）"
case "$err" in
  *'找不到 newid.js'*) ok "存在性守卫：stderr 有明确原因";;
  *) no "存在性守卫：stderr 缺少原因 → \`$err\`";;
esac
mv "$FAKE.off" "$FAKE"
rm -rf "$R"

# ── ⑤ 拒写发生在取号**之前** ───────────────────────────────────────────
# 假 newid.js 被调用就留一个标记文件。evidence 不存在时那个标记**必须不在** ——
# 否则「rc=1」只是「写完之后才失败」，事故照样落盘。
cat > "$FAKE" <<'EOF'
require('fs').writeFileSync(process.argv[2] + '.CALLED', 'x');
console.log('ALLOC EVT 008'); process.exit(0);
EOF
R=$(mktemp -d)
RECORD_ROOT="$R" bash "$S" W23 J14 OK art /nonexistent-evidence.txt >/dev/null 2>&1; rc=$?
chkrc 1 "$rc" "evidence 不存在 → rc=1"
if [ -e "$R/eventlog/$(date -u +%Y-%m-%d).txt.CALLED" ]; then
  no "拒写顺序：newid.js **被调用过**（拒写发生在取号之后 —— 有落盘风险）"
else
  ok "拒写顺序：newid.js 未被调用（拒写发生在取号之前）"
fi
rm -rf "$R"

# ── ⑥ 并发唯一性：10 进程写同一日志，唯一 seq 必须 == 10 ────────────────
# **这条才是 ISS-108 的本体** —— 上面五条改前也能过，只有这条改前必红。
# 用**真的** newid.js（并发性只能靠真件测；假件没有锁）。
# ★ 第一版这里漏了下面这一行，于是并发段跑的是 ⑤ 那个「只留标记、不写日志」的假件，
#   报「一行都没写出来」—— **FAIL 在尺子自己身上**。留着这句说明：尺子也会假红，
#   而它红的时候要先看它测的是不是真件（同「判据报红先怀疑判据自己」，但**先怀疑 ≠ 先否定**）。
cp "$ROOT/.check/record/newid.js" "$FAKE"
N=10
R=$(mktemp -d)
for i in $(seq 1 "$N"); do
  RECORD_ROOT="$R" bash "$S" W23 J14 OK "art-$i" -- >/dev/null 2>&1 &
done
wait
L="$R/eventlog/$(date -u +%Y-%m-%d).txt"
if [ ! -s "$L" ]; then
  no "并发唯一性：一行都没写出来"
else
  TOT=$(wc -l < "$L")
  UNI=$(grep -oP '^EVT \K\d+' "$L" | sort -u | wc -l)
  DUP=$(grep -oP '^EVT \K\d+' "$L" | sort | uniq -d | tr '\n' ',')
  if [ "$UNI" -eq "$TOT" ] && [ "$TOT" -gt 0 ]; then
    ok "并发唯一性：$N 进程 · 落盘 $TOT 行 · 唯一 seq $UNI（重复号 [${DUP%,}]）"
  else
    no "并发唯一性：$N 进程 · 落盘 $TOT 行 · **唯一 seq 只有 $UNI**（重复号 [${DUP%,}]）—— DEC-026：没丢东西 ≠ 没坏"
  fi
fi
rm -rf "$R"

echo "结论: $pass 过 / $fail 不过"
[ "$fail" -eq 0 ] || exit 1
exit 0
