# andyngo-task — 新任务全流程

domain: DISCOVERY
expertise: Product Discovery / Design Thinking
required: Problem Statement, JTBD, Success Criteria, DoR, DoD
inputs: 用户意图
outputs: artifacts/ + 验收报告
stop_when: 验收代理出三态判定

## G1 · Problem Statement
- 难点在哪（不写"要做什么"）
- Jobs-to-be-Done
- 最终目的（推敲，不是猜）
- Confidence Level

## G2 · 草案计划（≤5 步）
- 每步标注用到哪个现成件（sources.md / design-pool.md）
- 含 Definition of Ready
- 含"测不了什么"（前置声明）
- 依赖图：哪些并行，哪些串行

## G3 · ASK-1（第 1 次，配额 2）
三方案：
  A. <方案> — 依据 <外部源> — 代价 <...>
  B. ...
  C. ...
搜不到写"未搜到，自制"。
用户选 → 得到 Definition of Done

## G4 · 任务分解
- 写死 assets/andyngo-contract.md（接口 + 埋点 + 禁止清单 + 类型）
- 契约先于实现

## G5 · 波次执行
WAVE 1: Explore① ∥ Explore② ∥ Explore③ ∥ Explore④
WAVE 2: Plan（写契约）
WAVE 3: S1 ∥ S2 ∥ S3
WAVE 4: verifier① ∥ verifier② ∥ verifier③

## G6 · 验收
派独立 verifier。八条铁律。
三态判定：PASS / FAIL / UNVERIFIED

## G7 · 收尾（四行）
做了什么 / 我替你定了什么 / 仍未结 / 下一步
