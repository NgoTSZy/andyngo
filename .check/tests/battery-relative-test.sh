#!/usr/bin/env bash
# 「电池四态**相对基底**判」的**端到端双向测**（尺子）—— 2026-09-17 W23 J18 加（ISS-122）。
#
# ── 为什么必须有它 ────────────────────────────────────────────────────────────
# ISS-122 的现场（**实测，不是推测**）：`~/Desktop/reply-to-B.cmd` 被删 → C5 **基底红** →
#   **三套电池的变异一行没改**，读数却是 `[4] 假红 1→3` · `[5] 假红 0→3` · `[6] 命中 29→32`。
# 根因：`run-battery.js` 对负向探针判「**整份文档**有没有 Cx 红」、对正向变异判「Cx 在不在红名单里」
#   —— **两条都不问「这红是不是这条变异弄出来的」**。
# 修法：加第四态 `na`（**不适用**）—— 期望码在**基底**上本来就红 ⇒ 那条变异这一轮**没法测**，
#   单列一态、**不计入命中/逃逸/假红**。
#
# ── 这个修法有两个坏形状，本尺子的每一组都是为它们而写 ──────────────────────
#   ① **「一律不适用」**（基底绿时也降级）→ 电池**什么都不测了**，却全绿。
#      → 由 ① ② ⑤ 守：正常路径**不得出现**「不适用」，且**数字与基线逐字一致**。
#   ② **只修假红、不修命中** → 「命中」那半边仍是**假绿**（变异没生效也记成命中）。
#      → 由 ③ 守：基底红时**必须**出现「不适用 N」。
#
# ── 五组断言 ────────────────────────────────────────────────────────────────
#   ① **正常路径**（不传 `--base`）：三套读数**逐字相同**、**不得出现「不适用」**
#   ② `--base` 喂**真实 base**：与 ① 逐字相同（证明这个**只为测试**的参数不改变行为）
#   ③ 喂**基底红 C2**：三套**都必须出现「不适用 N」且 N > 0**
#   ④ ★ **假红方向**（本尺子的核心）：基底红时的 `假红` 数 **必须等于** 正常路径的假红数
#      —— 改前这里是 `1→3` / `0→3`（**误报**）。**只比假红，不比命中**：命中有意会变少（NA 吸收了）
#   ⑤ **反向守门人**：基底红时 `不适用 N` **严格小于** 总条数，且 `命中 > 0`
#      —— 没有它，一个「**一律不适用**」的坏实现会让 ③ 通过（N > 0 嘛），而 ① ② 会失败但看不出原因
#
# ★ 第 ④ 组为什么**只比假红**：命中数**本来就会变**（那几条期望 C2 的变异从「命中」变「不适用」——
#   那正是修法的**目的**，改前它们靠基底的红**冒充命中**）。把它一起比会**把正确的行为判成红**。
#
# 用法：bash .check/tests/battery-relative-test.sh
# 退出码：0 = 全过 · 1 = 有断言不符 · 2 = 拒跑（进不去仓库根 / 被测件不在）
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2

if [[ ! -f "$ROOT/.check/run-battery.js" || ! -f "$ROOT/.check/battery-relative.js" ]]; then
  echo "SKIP 无 .check/run-battery.js 或 battery-relative.js"; exit 2
fi

# ★ 临时文件放 `.check/tmp/`（**在 X1 的 SKIP 面里** → 不会被 X1 当活工具扫）。
# ★ 不要用 `/tmp`：**bash 的 `/tmp` 与 node 的 `/tmp` 不是同一个地方**
#   （node 把 `/tmp/x` 解析成 `C:\tmp\x`）—— 本轮实测踩到，`cp` 报「No such file」。
TMPD=".check/tmp"
mkdir -p "$TMPD"
REAL="$TMPD/br-base-real.md"
RED="$TMPD/br-base-c2red.md"
cleanup() { rm -f "$REAL" "$RED"; }
trap cleanup EXIT

echo "=== 电池四态「相对基底」· 端到端双向测（ISS-122）==="
echo
fail=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; fail=$((fail+1)); }

# ★ **默认只跑 1 套**（2026-09-17 瘦身）：三套跑完是 **12 次电池 ≈ 4 分钟**，
#   接进载体后会让载体从 5.5 分钟涨到 ~10 分钟 —— 而这条尺子测的是**机制**
#   （基底红 → 降级为「不适用」），三套的差异只是**变异集合不同**（F 系 / G 系 / N 系），
#   对机制没有额外覆盖。`BR_ALL=1` 可跑全套（手工排查时用）。
#   **代价如实记**：① 的「三套都不含不适用」在默认档下只覆盖一套 —— 覆盖窄了，这是省时间的价钱。
if [[ "${BR_ALL:-}" == "1" ]]; then
  BATS="mutations-fourth mutations-fourth2 mutations-thirdparty2"
else
  BATS="mutations-fourth"
fi

# 抽某一套的汇总行（`电池 N 条：命中 A / 逃逸 B / 假红 C / …`）
sumline() { node .check/run-battery.js ".check/$1.js" $2 2>&1 | grep '^电池 '; }
# 从汇总行取某个数（$1=行 $2=字段名）
field() { printf '%s' "$1" | sed -n "s/.*$2 \([0-9]*\).*/\1/p" | head -1; }
# 取「不适用 N」里的 N（没有则空）
naOf() { printf '%s' "$1" | sed -n 's/.*不适用 \([0-9]*\).*/\1/p' | head -1; }
# ★ 「总条数」要**单独一个提取器** —— 它后面的分隔符是**全角冒号**（`27 条：`），
#   而 `field` 的 `s/.*条 \([0-9]*\)/` 要求「条」后跟**空格** → **匹配不到、返回空**。
#   第一版就是这么错的：⑤ 报红、详情里「共 」是空的。**「取不到」被 `-z` 断言抓出来了**
#   —— 这正是「拿不到信息 ≠ 通过」在尺子自己身上的实例。
totalOf() { printf '%s' "$1" | sed -n 's/^电池 \([0-9]*\) 条.*/\1/p' | head -1; }

# 先跑一次正常路径，留作 ①②④⑤ 的参照
declare -A N_SUM N_FR N_NA
for b in $BATS; do
  N_SUM[$b]="$(sumline "$b" '')"
done

# ① 正常路径
allok=1; detail=""
for b in $BATS; do
  s="${N_SUM[$b]}"
  [[ "$s" == *不适用* ]] && { allok=0; detail="$detail $b(出现了「不适用」)"; }
done
echo "--- ① 正常路径（不传 --base）· 期望：（默认档 1 套）不含「不适用」---"
for b in $BATS; do echo "      $b: ${N_SUM[$b]}"; done
if [[ $allok -eq 1 ]]; then ok "① 正常路径：读数不含「不适用」（**没有一律降级**）"
else bad "① 正常路径出现了「不适用」：$detail"; fi

# ② `--base` 喂真实 base —— 必须与 ① 逐字相同
node -e 'const fs=require("fs");const {buildFileSet}=require("./.check/fileset.js");fs.writeFileSync(process.argv[1],buildFileSet().text);' "$REAL" || { echo "SKIP 造不出真实 base"; exit 2; }
same=1; detail=""
for b in $BATS; do
  s2="$(sumline "$b" "--base $REAL")"
  [[ "$s2" == "${N_SUM[$b]}" ]] || { same=0; detail="$detail $b(『$s2』≠『${N_SUM[$b]}』)"; }
done
echo "--- ② --base 喂真实 base · 期望：与 ① 逐字相同 ---"
if [[ $same -eq 1 ]]; then ok "② \`--base\` 喂真实 base：与 ① **逐字相同**（这个测试专用参数**不改变行为**）"
else bad "② 喂真实 base 后读数变了：$detail"; fi

# 造「基底红 C2」（正文多一个未登记的 `## N. 标题`）—— 用真实 base + 幽灵章节
cp "$REAL" "$RED"
printf '\n## 7. 幽灵章节\n' >> "$RED"
c2red="$(node .check/check-protocol.js --file "$RED" 2>&1 | grep -cE '^FAIL' || true)"
if [[ "$c2red" != "1" ]]; then
  echo "SKIP 造不出「基底**只红一处**」的文本（实测 FAIL 数 = $c2red，期望 1）—— 夹具失效，本尺子拒跑"
  exit 2
fi

# ③ 基底红 → 必须出现「不适用 N」且 N > 0
allna=1; detail=""
for b in $BATS; do
  s3="$(sumline "$b" "--base $RED")"
  n="$(naOf "$s3")"
  if [[ -z "$n" || "$n" -le 0 ]]; then allna=0; detail="$detail $b(『$s3』)"; fi
done
echo "--- ③ 基底红 C2 · 期望：都出现「不适用 N」且 N > 0 ---"
for b in $BATS; do echo "      $b: $(sumline "$b" "--base $RED")"; done
if [[ $allna -eq 1 ]]; then ok "③ 基底红时**确实**降级为「不适用」（**命中方向的假绿被摘掉**）"
else bad "③ 基底红时没有出现「不适用」：$detail"; fi

# ④ ★ 核心：假红方向 —— 基底红时的假红数**必须等于**正常路径
frEq=1; detail=""
for b in $BATS; do
  n_fr="$(field "${N_SUM[$b]}" 假红)"
  s4="$(sumline "$b" "--base $RED")"
  n_fr4="$(field "$s4" 假红)"
  [[ "$n_fr" == "$n_fr4" ]] || { frEq=0; detail="$detail $b(正常 $n_fr → 基底红 $n_fr4)"; }
done
echo "--- ④ ★ 假红方向（核心）· 期望：基底红时假红数 = 正常路径假红数 ---"
if [[ $frEq -eq 1 ]]; then ok "④ **假红不再误报**：基底红时假红数与正常路径**逐套相同**（改前这里是 1→3 / 0→3）"
else bad "④ 假红被基底带跑了：$detail"; fi

# ⑤ 反向守门人：降级必须**精确**，不是一刀切
prec=1; detail=""
for b in $BATS; do
  s5="$(sumline "$b" "--base $RED")"
  n_na="$(naOf "$s5")"; n_tot="$(totalOf "$s5")"; n_hit="$(field "$s5" 命中)"
  if [[ -z "$n_na" || -z "$n_tot" || "$n_na" -ge "$n_tot" || "$n_hit" -le 0 ]]; then
    prec=0; detail="$detail $b(不适用 $n_na / 共 $n_tot · 命中 $n_hit)"
  fi
done
echo "--- ⑤ 反向守门人 · 期望：不适用数 < 总条数，且命中 > 0 ---"
if [[ $prec -eq 1 ]]; then ok "⑤ 降级**精确到码**：不适用数 < 总数、其余照常判（**不是一刀切全 NA**）"
else bad "⑤ 降级一刀切了：$detail"; fi

echo
echo "结论: $((5-fail))/5 条符合期望"
exit $((fail ? 1 : 0))
