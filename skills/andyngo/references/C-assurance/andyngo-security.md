# andyngo-security — 安全审计

domain: ASSURANCE
expertise: Security Engineering
required: Threat Model, Attack Surface, STRIDE,
          OWASP Agentic Top 10, Least Privilege, Zero Trust
inputs: artifacts/ + .check/record/
outputs: artifacts/security-report.md
stop_when: Risk register 产出（按严重度排序）

## 一条命令
scripts/andyngo-security-scan.sh

产出 OWASP Agentic Top 10 清单到 `.check/audit/<YYYY-MM-DD>/security-<HHMMSS>.txt`。
**清单是起点，不是报告** —— `outputs` 的 `artifacts/security-report.md` 要在这份清单上逐项填。

## 流程
1. OWASP Agentic Top 10 (2026) 逐项对照
2. 输入消毒（prompt injection 在所有入口）
3. 工具权限（最小权限、作用域受限）
4. 凭据（短期、可轮换、不硬编码）
5. 审计日志（不可变、append-only、覆盖 perceive-reason-act）
6. 输出：风险清单（severity-ranked）+ 缓解建议

## Checklist
□ 所有 agent 输入已消毒和验证
□ 工具以最小必需权限运行
□ 凭据是短期的且作用域受限
□ 第三方插件已验证并沙箱化
□ 代码执行在隔离环境中进行
□ Agent 间通信已认证和加密

## 原则
安全应用在一个点上会让其他点暴露。
必须治理整条路径：提示词 → 工具执行 → 结果。
