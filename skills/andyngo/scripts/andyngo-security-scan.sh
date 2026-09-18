#!/usr/bin/env bash
set -uo pipefail

ROOT="${PROJECT_ROOT:-$PWD}"
DATE=$(date -u +%Y-%m-%d)
OUT="$ROOT/.check/audit/$DATE"
mkdir -p "$OUT"

REPORT="$OUT/security-$(date -u +%H%M%S).txt"

{
  echo "=== OWASP Agentic Top 10 Checklist ==="
  echo "□ 输入消毒（prompt injection 所有入口）"
  echo "□ 工具权限（最小权限）"
  echo "□ 凭据（短期、可轮换）"
  echo "□ 代码执行隔离"
  echo "□ Agent 间通信认证"
  echo "□ 审计日志（不可变）"
  echo "□ 策略执行（准入层）"
  echo "□ 零信任身份"
  echo "□ 端到端审计"
} > "$REPORT"

echo "SECURITY REPORT $REPORT"
