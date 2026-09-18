# andyngo-seal — 封存

domain: EVOLUTION
required: Immutable Artifact, Manifest, Attestation, Lineage, Tombstone
inputs: 全部声明
outputs: 逐条核对输出
stop_when: 每条声明有证据

## 铁律
说"已落"之前必须跑核对命令。
核不出证据就写"待落"。
改动的状态只能从文件里读出来，不能从记忆里写出来。

## 流程
1. 逐条列声明
2. 逐条跑核对命令
3. 命令与输出一并落盘
4. 写 Manifest（md5 + 行数）
5. 写"仍未结"
6. 写 Attestation（带证据）

## 不许出现
"已落"却没有核对输出的行。
区域级豁免 = 裸的允许清单。
豁免必须逐条、必须写原因、必须打印出来。

## 输出落点
.check/record/changes.md
.check/audit/<日期>/seal-<ts>.txt
