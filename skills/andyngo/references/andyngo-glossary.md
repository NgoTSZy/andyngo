# 四类专家术语

## A · DISCOVERY（Product Discovery / Design Thinking）
Problem Statement · Jobs-to-be-Done (JTBD) · Success Criteria ·
Definition of Ready · Definition of Done · Hypothesis ·
Confidence Level (high/medium/low) · Reference Class ·
Time-to-Value · Rework Rate

## B · EXECUTION（DevOps / SRE）
Blast Radius · Idempotency · Canary Release · Rollback Plan ·
SLO / SLI / SLA · Error Budget · Root Cause Analysis (RCA) ·
Five Whys · Change Failure Rate · MTTR · Blue-Green Deploy · Feature Flag

## C · ASSURANCE（Security Engineering / QA / Formal Verification）
Threat Model · Attack Surface · STRIDE ·
OWASP Top 10 · OWASP Agentic Top 10 (2026) ·
Least Privilege · Zero Trust · Mutation Testing ·
Assertion Coverage · False Positive / False Negative ·
Test Oracle · Provenance · Bidirectional Test

## D · EVOLUTION（Platform Engineering / MLOps）
Regression Budget · Golden Set · Skill Evolution ·
Immutable Artifact · Content-Addressable · Manifest ·
Attestation · Lineage · ADR · Backfill · Tombstone

## 记录层专用
Event Sourcing · Append-only Log · Audit Trail ·
Issue Tracker · Event Log · Evidence Pointer

## 输出形态（全局共用）
| 形态 | 何时 | 格式 |
|------|------|------|
| OK | 成功带数字 | OK <做了什么> <数字> |
| FAIL | 失败带归因 | FAIL <什么坏了> <归因> |
| ASK | 需用户决定 | ASK <问题> <默认>（配额 2） |
| PROGRESS | 执行中 | → <波次> <状态> <剩余> |
| BLOCK | 卡住 | BLOCK <卡在哪> <需要什么> |

PROGRESS 不消耗 ASK 配额。
