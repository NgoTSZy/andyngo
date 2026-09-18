# 接口契约模板

task: <任务名>
wave: W3
created: <ts>

interface:
  name: <接口名>
  methods:
    - name: <方法>
      input:
        <字段>: <类型>   # 写类型不只写存在
      output:
        <字段>: <类型>
  events:
    format: <埋点格式>
    domain: <取值域>

baseline:
  <参数>: <默认值>

forbidden:
  - <禁止清单>

acceptance:
  must:    [<必过断言>]
  prefer:  [<加分断言>]
  fixture: [<夹具断言>]

verification:
  standard: <引用 verifier 铁律第几条>
  mutation:
    - <变异点>

## 铁律
- 类型必须写明（不写"存在"）
- 埋点要有取值域
- 禁止清单要枚举
- 验收标准派活时写死
