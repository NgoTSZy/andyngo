#!/usr/bin/env bash
# X1「**窗口新鲜度前置**」的**端到端双向测**（尺子）—— 2026-09-17 W23 J18 加（ISS-127）。
#
# ── 为什么必须有它 ────────────────────────────────────────────────────────────
# ISS-127 实测：X1 在「**外部会话活跃写入期**」会**反复报新缺口** ——
#   01:13Z 命中 2 → 补登记 → 01:26Z 又命中 1（那个会话 09:22 刚写过它）。
# 判据分不出「**真缺口**（文件已定稿、确实漏了登记）」与「**瞬时状态**（文件还在被写）」。
# 修法：文件 mtime 距今 < 30 分钟 ⇒ 该文件的缺口不计入命中，改报 `FRESH`（可见、不判红）。
#
# **这个修法有一个明显的坏形状，本尺子就是为它而写**：
#   如果「降级」退化成「**一律不报**」，那么 X1 会从「总是响」变成「**永远不响**」——
#   本仓库原话：「**一个不会响的守门人比没有守门人更坏**」。
# 所以下面每一组都是**成对**的：既证明「新鲜不判红」，**也**证明「陈旧必判红」。
#
# ── 五组断言 ────────────────────────────────────────────────────────────────
#   ① 夹具**刚创建**（新鲜）→ 该文件报 `FRESH`、**不计命中**、`--scan` 退出码 **0**
#   ② 把 mtime 推到 **90 分钟前**（陈旧）→ 同一份文件**必须判红**、退出码 **1**   ← **自愈的证明**
#   ③ 再推回**新鲜** → 必须**又变回** `FRESH`（证明不是一次性开关）
#   ④ 删掉夹具 → 该文件**不再出现在任何一行里**（**证明红是夹具造成的，不是本来就红**）
#   ⑤ 夹具**含 `exit 2`** 这件事本身要被 X1 看到（`检查 N 处` 变大）—— 否则① ② 测的是空气
#
# **④ 是关键的反向守门人**：没有它的话，一个「**什么都报红**」的坏 X1 会让 ② 通过。
# **⑤ 是「用例测到了它声称的东西」的证明** —— 同族先例：`ruler-callpoint.js` 的 `--inject`
#   第三号用例曾因夹具没写出文件而**测的不是它声称的东西**。
#
# ── 两条实测踩出来的坑（都写进断言里了）──────────────────────────────────────
# ★ 断言必须**精确到夹具路径**，不能用「有 FRESH 行 / 无 FRESH 行」——
#   因为**本尺子自己**（`.check/tests/x1-freshness-test.sh`）就含 `exit 2` 字面、
#   刚创建时也是「新鲜未判」的一员。第一版断言「删掉夹具后无 FRESH」→ **永远假红**。
#   （本尺子已按铁律 2 登记进 `exit-codes.md`，所以它不会进命中面；但它在**新鲜期**仍会进 FRESH 面。）
# ★ 取 X1 的**整段**（汇总行 + 后续缩进行），不能只 `grep '^\[X1\]'` ——
#   `FRESH` 行是缩进的，只抓汇总行会**看不到它**，于是「判据没打印」与「判据没降级」分不开。
#
# 用法：bash .check/tests/x1-freshness-test.sh
# 退出码：0 = 全过 · 1 = 有断言不符 · 2 = 拒跑（进不去仓库根 / 判据不在）
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2

if [[ ! -f "$ROOT/.check/probe-crossref.js" ]]; then
  echo "SKIP 无 .check/probe-crossref.js"; exit 2
fi

# 夹具位置的三条硬约束（**选错位置会让本尺子自己制造假红**）：
#   · 必须在 X1 的**扫描面内** → 只能是 `.check/` 或 `skills/` 下；
#   · 必须**不在 SKIP 面内** → 不能放 `evidence/` `audit/` `applied/` `tmp/` `record/*.md`；
#   · 必须**不在 `.check/tests/`** → 否则 `ruler-callpoint.js` 会来问「这把尺子的调用点在哪」，
#     而它是一把**夹具尺**（没有独立调用点）→ 凭空多一条假红。
# 所以落在 `.check/` **根下**（不是任何被规则扫的子目录）。
TMPF=".check/x1-fresh-probe-tmp.sh"
FIXBASE="x1-fresh-probe-tmp"
cleanup() { rm -f "$TMPF"; }
trap cleanup EXIT

cat > "$TMPF" <<'FIXEOF'
#!/usr/bin/env bash
# 临时夹具（由 .check/tests/x1-freshness-test.sh 创建，跑完即删）。
# 它**故意**含一处未登记的 `exit 2` —— X1 的扫描面要能看到它。
if [ -z "${1:-}" ]; then
  echo "缺参"
  exit 2
fi
FIXEOF

echo "=== X1 窗口新鲜度前置 · 端到端双向测（ISS-127）==="
echo "夹具: $TMPF（扫描面内 · 非 SKIP · 非 .check/tests/）"
echo
fail=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; fail=$((fail+1)); }

# 取 X1 的**整段**（汇总行 + 缩进的 FRESH/HIT 明细行）
x1seg() { node .check/probe-crossref.js --scan 2>&1 | sed -n '/^\[X1\]/,/^\[X2\]/p'; }
x1rc()  { node .check/probe-crossref.js --scan >/dev/null 2>&1; echo $?; }
# ★ 夹具在 **FRESH** 明细里？（FRESH 行**带** `FRESH` 前缀）
fix_fresh() { grep "$FIXBASE" | grep -q FRESH; }
# ★ 夹具在**命中**明细里？（**命中明细行是裸路径、不带 `HIT` 前缀** —— `HIT` 只在汇总行上。
#   第一版用 `grep -E "(FRESH|HIT).*$FIXBASE"` 判 ②，于是**永远找不到** —— 实测踩到。）
fix_hit()   { grep "$FIXBASE" | grep -qv FRESH; }

# ① 刚创建 ⇒ 新鲜
s1="$(x1seg)"; r1="$(x1rc)"
echo "--- ① 夹具刚创建（新鲜）· 期望：FRESH · 不计命中 · rc=0 ---"
echo "$s1" | sed 's/^/      /'
if echo "$s1" | fix_fresh && ! echo "$s1" | fix_hit && [[ "$r1" == "0" ]]; then
  ok "① 新鲜：该文件报 FRESH · 不计命中 · rc=0"
else bad "① 新鲜文件仍被判红，或退出码不为 0（rc=$r1）"; fi

# ② 推到 90 分钟前 ⇒ 陈旧 ⇒ **必须判红**（自愈）
if ! touch -d '90 minutes ago' "$TMPF" 2>/dev/null; then
  echo "SKIP 本机 touch 不支持 -d —— 无法做 ②–③（只验了 ①）"
  echo "结论: 1/1 条符合期望（**不是 5/5**，本机能力不足）"
  exit 2
fi
s2="$(x1seg)"; r2="$(x1rc)"
echo "--- ② mtime 推到 90 分钟前（陈旧）· 期望：HIT · rc=1 ---"
echo "$s2" | sed 's/^/      /'
if echo "$s2" | fix_hit && [[ "$r2" == "1" ]]; then
  ok "② 陈旧：同一份文件**必须判红** · rc=1 —— **自愈成立**（停写即变红，不需要有人记得复跑）"
else bad "② 陈旧文件没被判红 —— **降级退化成了「一律不报」**（rc=$r2）"; fi

# ③ 再推回新鲜 ⇒ 必须又变 FRESH
touch "$TMPF"
s3="$(x1seg)"; r3="$(x1rc)"
echo "--- ③ 再推回新鲜 · 期望：FRESH · rc=0 ---"
echo "$s3" | sed 's/^/      /'
if echo "$s3" | fix_fresh && ! echo "$s3" | fix_hit && [[ "$r3" == "0" ]]; then
  ok "③ 双向可逆：新鲜 → 陈旧 → 新鲜，判定跟着 mtime 走"
else bad "③ 推回新鲜后没有回到 FRESH（rc=$r3）"; fi

# ④ 删掉夹具 ⇒ 该文件必须从**所有**行里消失（**证明前面的红是夹具造成的**）
rm -f "$TMPF"
s4="$(x1seg)"; r4="$(x1rc)"
echo "--- ④ 删除夹具 · 期望：该文件不再出现在任何一行 · rc=0 ---"
echo "$s4" | sed 's/^/      /'
if ! echo "$s4" | grep -q "$FIXBASE" && [[ "$r4" == "0" ]]; then
  ok "④ 反向守门人：夹具一删，该文件就从 FRESH/HIT 面消失 —— 前面的红**确实是夹具造成的**"
else bad "④ 删掉夹具后该文件仍在 FRESH/HIT 面里（rc=$r4）"; fi

# ⑤ 「夹具含 exit 2」这件事本身要被 X1 看到 —— 否则 ①②③ 测的是空气
cat > "$TMPF" <<'FIXEOF'
#!/usr/bin/env bash
if [ -z "${1:-}" ]; then
  echo "缺参"
  exit 2
fi
FIXEOF
# ★ 必须限定 `^[X1]` 那一行再取数 —— 第一版直接 `sed -n 's/.*检查 N 处.*/\1/p'`，
#   把 **X2 的**计数也取了回来（`检查 2 处`）→ 变量里是两行 → `[[ -eq ]]` 报算术错误。
seen_with="$(x1seg | sed -n '/^\[X1\]/s/.*检查 \([0-9]*\) 处.*/\1/p' | head -1)"
rm -f "$TMPF"
seen_without="$(x1seg | sed -n '/^\[X1\]/s/.*检查 \([0-9]*\) 处.*/\1/p' | head -1)"
echo "--- ⑤ 夹具在扫描面内 · 期望：有夹具时「检查 N 处」= 无夹具时 + 1 ---"
echo "      有夹具: 检查 $seen_with 处 · 无夹具: 检查 $seen_without 处"
if [[ -n "$seen_with" && -n "$seen_without" && "$seen_with" -eq "$((seen_without + 1))" ]]; then
  ok "⑤ 扫描面确认：夹具恰好贡献 1 处（$seen_without → $seen_with）—— **用例确实测到了它声称的东西**"
else bad "⑤ 夹具没被 X1 扫到，或计数不符（有=$seen_with · 无=$seen_without）—— 上面几组测的是空气"; fi

echo
echo "结论: $((5-fail))/5 条符合期望"
exit $((fail ? 1 : 0))
