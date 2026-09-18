# andyngo-fix — 修复

domain: EXECUTION
expertise: DevOps / SRE
required: RCA, Five Whys, Blast Radius, Rollback Plan
inputs: 坏的东西
outputs: 修复 + 双向测结果
stop_when: 双向都实测

## 流程
1. 复现：把坏的那处指出来，跑一次看它红
2. RCA（Five Whys 定位根因）
3. 修
4. 双向测：
   - 该绿的绿 —— 修完功能正常
   - 该红的红 —— 把修好的地方再改坏，看报不报
   - 只测一个方向 = 没测
5. 检查是否造出假红
   假红比漏报贵（会训练人忽略红色）
6. 评估 Blast Radius

## 停
双向都实测通过。
