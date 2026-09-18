#!/usr/bin/env bash
# 口径一：速查卡 ↔ 判事件表 入口覆盖
# 判据：规格第六部分「一页速查卡」承诺的每个 /andyngo <名字>，都必须在 SKILL.md 里被接住
# 用法：card-entry-coverage.sh <spec> <SKILL.md>
# 退出码：0 = 差集为空（该绿的绿）；1 = 有缺口（该红的红）；2 = 判据空转（UNVERIFIED）
#
# v2 修订（CHG-014）：
#   ① 正则 `[a-z]+` → `[a-z-]+`。旧式在 `-` 处截断：`/andyngo security-scan`
#      会被抽成 `security`，于是**名字写错也报 hit** = 假绿。
#   ② 补空判据守门人（解析不出 8 个名字就 UNVERIFIED，不许「空集 PASS」）。
#   独立性要求：本口径（bash + 硬编码行号 + comm）与口径二
#   （card-entry-coverage2.js：node + 锚点文本 + Set）**不得共用抽取代码**。

SPEC="$1"
SKILL="$2"

card=$(sed -n '1185,1207p' "$SPEC" 2>/dev/null | grep -oE '/andyngo [a-z-]+' | sed 's|/andyngo ||' | sort -u)
table=$(grep -oE '/andyngo [a-z-]+' "$SKILL" 2>/dev/null | sed 's|/andyngo ||' | sort -u)

# 空判据守门人：速查卡若解析不出 8 个名字，判据本身失效 —— 不许退化成「空集 PASS」
cn=$(printf '%s\n' "$card" | grep -c . || true)
if [ "$cn" -lt 8 ]; then
  echo "速查卡解析出 $cn 个名字（预期 8）—— 规格路径/行号漂移，判据失效"
  echo "VERDICT: UNVERIFIED（判据空转，不报 PASS）"
  exit 2
fi

echo "速查卡承诺: $(echo $card | tr '\n' ' ')"
echo "判事件表接住: $(echo $table | tr '\n' ' ')"

missing=$(comm -23 <(echo "$card") <(echo "$table") | grep . || true)
n=$(printf '%s\n' "$missing" | grep -c . || true)

echo "缺口(MISSING): $(echo $missing | tr '\n' ' ')"
echo "缺口数 = $n"

if [ "$n" -eq 0 ]; then
  echo "VERDICT: PASS（速查卡 $cn 个入口全部被接住）"
  exit 0
else
  echo "VERDICT: FAIL（速查卡有 $n 个入口接不住）"
  exit 1
fi
