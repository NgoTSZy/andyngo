# andyngo-audit — 巡检

domain: ASSURANCE
inputs: 无
outputs: 四态表
stop_when: 表产出

## 一条命令
scripts/andyngo-audit.sh

## 四态
OK / FAIL / DRIFT / UNVERIFIED

## 输出目录
.check/audit/<YYYY-MM-DD>/
保留 90 天。

## 只报，不修

## 七条核对
1. node .check/acceptance.js（若存在）
2. node .check/check-protocol.js（若存在）
3. token 口径（先跑，口径没定义后面全白做）
4. 目录数
5. 计数一致性
6. 常驻层 hook 声明
7. 覆盖率

## 空启动默认走这里
