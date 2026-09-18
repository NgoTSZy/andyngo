# andyngo-resume — 接续未结项

domain: DISCOVERY
required: Reference Class, Lineage
inputs: 上轮 SEAL 的"仍未结"
outputs: 未结项列表
stop_when: 用户挑一项进 TASK

## 流程
1. 读 .check/record/eventlog/<最近日期>.txt
2. 读最近 SEAL 记录的"仍未结"
3. 只列未结项给用户
4. 用户挑一项 → 进 TASK

## 输出
UNRESOLVED  <n> 项
  1. <描述>  <来源事件 ID>
  2. ...
