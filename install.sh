#!/usr/bin/env bash
# andyngo 安装 —— 两步落位（skill 本体 + 判据记录层）
#
# 用法：bash install.sh [项目根]      （默认 = 当前目录）
#
# 为什么是两步：`andyngo-audit.sh:4` 是 ROOT="${PROJECT_ROOT:-$PWD}" ——
# 判据跑在**项目根**，而 skill 装在**产品的 skill 目录**。两处落点，不能合并。
set -uo pipefail

TARGET="${1:-$PWD}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SKILL_DEST="$HOME/.workbuddy-ai/skills"

[ -d "$TARGET" ] || { echo "拒跑：目标目录不存在: $TARGET"; exit 2; }
[ -d "$HERE/skills/andyngo" ] || { echo "拒跑：找不到 $HERE/skills/andyngo"; exit 2; }

# ① skill 本体 → 产品的 skill 目录
if [ -e "$SKILL_DEST/andyngo" ]; then
  echo "拒绝覆盖：$SKILL_DEST/andyngo 已存在（先备份或移走再装）"; exit 2
fi
mkdir -p "$SKILL_DEST"
cp -r "$HERE/skills/andyngo" "$SKILL_DEST/"
echo "① skill  → $SKILL_DEST/andyngo   rc=$?"

# ② 判据与记录层 → 项目根
if [ -e "$TARGET/.check" ]; then
  echo "拒绝覆盖：$TARGET/.check 已存在（先备份或移走再装）"; exit 2
fi
cp -r "$HERE/.check" "$TARGET/.check"
echo "② .check → $TARGET/.check   rc=$?"

# ③ MODE.md（判据层**无条件**读它，缺了会崩 —— 不是可选件）
if [ -e "$TARGET/MODE.md" ]; then
  echo "跳过 MODE.md：$TARGET/MODE.md 已存在（不覆盖你的规则）"
else
  cp "$HERE/MODE.md" "$TARGET/MODE.md"
  echo "③ MODE.md → $TARGET/MODE.md   rc=$?"
fi

# ④ 当天 eventlog（空文件；andyngo-integrity.js 按**当天日期**找它，空目录不够）
D="$TARGET/.check/record/eventlog/$(date -u +%Y-%m-%d).txt"
[ -f "$D" ] || : > "$D"
echo "④ eventlog → $D"

echo
echo "安装完成。下一步："
echo "  cd $TARGET && node .check/probe-record-shape.js --scan"
echo
echo "★ 首次跑多数判据会 rc=2（UNVERIFIED）—— 那是**空账本**，是设计不是故障。"
echo "  「判据空转」与「判据跑了且合格」必须能被机器区分，所以空账本报 2 而不是 0。"
echo "  要让它转绿：先用 skills/andyngo/scripts/andyngo-record.sh 写第一条记录。"
