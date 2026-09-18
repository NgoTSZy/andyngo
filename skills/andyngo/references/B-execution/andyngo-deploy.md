# andyngo-deploy — 部署建议

domain: EXECUTION
required: Idempotency, Canary, Rollback Plan, SLO/SLI, Error Budget, Blue-Green, Feature Flag
inputs: 产物 + 环境
outputs: 部署方案 + 回滚手册
stop_when: 方案落盘

## 流程
1. 环境检查（OS / shell / 运行时 / 依赖）
2. 四层治理蓝图对照：
   - 作用域身份
   - 准入时策略
   - 人工审批门
   - 不可变审计
3. 选最简架构（单实例起步）
4. 写部署方案 + Rollback Plan
5. 写复原检查清单

## 反直觉
系统提示词写"永远不碰生产"不是控制，是建议。
护栏必须放准入层。

从最简模式开始，只在有证据时加复杂度。
