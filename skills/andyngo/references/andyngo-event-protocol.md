# 事件格式 + 子代理契约

## 事件行
EVT <seq> <ts> <wave> <job> <status> <artifact_ptr> <evidence_ptr>

| 字段 | 谁生成 | 规则 |
|------|--------|------|
| seq | 脚本 | 从 001 起，不许跳号 |
| ts | 脚本 | UTC ISO8601 |
| wave | 主代理 | W1/W2/… |
| job | 主代理 | J1/J2/… |
| status | 子代理 | OK/FAIL/BLOCK |
| artifact_ptr | 子代理 | 产物路径；无则 -- |
| evidence_ptr | 子代理 | 必须真实存在 |

> **status 的两套取值不是矛盾，是两件事**（ISS-035）：本表这一行是**子代理回传**用的
> **三态**（`OK / FAIL / BLOCK`）；主代理的**输出形态**另有 `ASK` / `PROGRESS` 两态，
> 见 `SKILL.md` 与规格速查卡 —— **子代理回传 ≠ 主代理输出**。
> 判据 I6 按 DEC-006「取超集」认**五态**，并在此写明出处与冲突。

实例：
EVT 001 2026-09-15T14:23:01Z W1 J1 OK artifacts/tokens.json .check/record/evidence/2026-09-15/w1-j1.txt

## 子代理契约（随任务派发）
你的回传必须是这一行，不许加解释：
EVT <seq> <ts> <wave> <job> <status> <artifact_ptr> <evidence_ptr>

1. 产物写磁盘，路径放 artifact_ptr
2. 证据写磁盘，路径放 evidence_ptr（必须真实存在）
3. 不许把产物内容、日志内容、文件全文贴回主对话
4. status 三态：OK / FAIL / BLOCK（**子代理回传**专用；主代理**输出形态**另有 `ASK`/`PROGRESS` 两态，见 `SKILL.md` —— 两套服务不同对象，不是矛盾）
5. FAIL 时 artifact_ptr 写 `--`
6. 一行之外，任何输出被丢弃
7. 读资料摘要 ≤3 行

## 主代理权限
| 动作 | 允许 | 方式 |
|------|------|------|
| 读资料 | 是 | 通过下级代理代为执行，摘要 ≤3 行 |
| 读大文件 | 否 | 派 Explore 读 |
| 写文件 | 否 | 子代理写 |
| 跑命令 | 否 | 子代理跑（例外：audit.sh） |
| 追加事件 | 是 | 必须通过 record.sh |

## 主代理禁令
1. 不粘贴子代理原始输出
2. 不解释子代理做了什么（只追加 EVT 行）
3. 不自己执行任务（只派子代理）
4. 不直读 artifacts/ 内容（派 Explore）

## 循环机制
派 WAVE N → 收事件流 → 全 OK？ → 下一波次
                            ↓否
                     派修复子代理 → 重跑
                     重试 ≥3 → BLOCK 交用户

## 完整性校验（AUDIT 的一部分）
□ seq 连续？（缺号 → FAIL）
□ evidence_ptr 指向的文件存在？（缺失 → FAIL）
□ ts 单调递增？（乱序 → FAIL）
□ 事件数 == 子代理派发数？（不等 → FAIL）

## 状态显示格式
STATE  <phase> <n>/<total>
FILE   <path>

或
STATE  <phase> <n>/<total> DONE
NEXT   <下一步>

问题：
ISSUE  <ID> <状态> <描述>

解决：
FIXED  <ID> <描述>
