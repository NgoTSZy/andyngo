# andyngo-evolve — 自改良回归

domain: EVOLUTION
expertise: Platform Engineering / MLOps
required: Regression Budget, Golden Set, Skill Evolution
inputs: 历史缺陷 + baseline
outputs: 改良提案 + 回归数据
stop_when: 用户决定是否采纳

## 模式来源
- Self-Harness（上海 AI Lab）：33%/52%/60% 相对提升
- GRASP：有界编辑 + 硬回归预算

## 流程
1. 读历史缺陷（refs/ + VERIFY.md）
2. 读当前基线
3. 提 N 条候选（改什么/为什么/预期收益）
4. 在留出样本（Golden Set）上跑回归
5. 只保留：净改进 + 不破回归预算
6. 输出提案 + 回归数据

## 约束
自修改限定在小控制适配器 + 版本化 harness。
围绕冻结基础模型。
每个修改通过随时有效的门控。
针对固定误差预算发可审计证书。
