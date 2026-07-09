# analytics-agent domain 规格说明

## Purpose
定义 `cz-cli analytics-agent domain` 命令组中 domain create/update 的用户可见参数面，确保示例问题使用更直接的重复参数输入，而不是要求用户手写 JSON 数组或内部 body。

## Requirements

### Requirement: domain create/update 使用重复 sample-question 参数

`cz-cli analytics-agent domain create` 与 `update` MUST 支持重复 `--sample-question` 输入，并将其组装为请求体中的 `sampleQuestions` 数组。普通用户主路径不应再暴露 `--sample-questions` 或 `--body`。

#### Scenario: create 用重复 sample-question 组装数组

- **WHEN** 用户执行 `cz-cli analytics-agent domain create --name 销售域 --datasource-id 11 --sample-question "本周销售额多少" --sample-question "华北地区销售额多少"`
- **THEN** CLI 调用 domain create open API
- **且** 请求体中的 `sampleQuestions` 为 `["本周销售额多少","华北地区销售额多少"]`

#### Scenario: update 用重复 sample-question 组装数组

- **WHEN** 用户执行 `cz-cli analytics-agent domain update 195 --name 销售域 --datasource-id 11 --sample-question "本周销售额多少" --sample-question "华北地区销售额多少"`
- **THEN** CLI 调用 domain update open API
- **且** 请求体中的 `sampleQuestions` 为 `["本周销售额多少","华北地区销售额多少"]`

#### Scenario: sample-question 误传 JSON 数组字符串时本地拒绝

- **WHEN** 用户执行 `cz-cli analytics-agent domain create --name 销售域 --datasource-id 11 --sample-question '["问题1","问题2"]'`
- **THEN** CLI MUST 在发请求前直接返回 `USAGE_ERROR`
- **且** 错误信息 MUST 明确提示改用重复 `--sample-question`

#### Scenario: help 不再暴露 sample-questions 和 body

- **WHEN** 用户执行 `cz-cli analytics-agent domain create --help`
- **THEN** help 中不包含 `--sample-questions`
- **且** help 中不包含 `--body`

### Requirement: domain delete 兼容后端 no-data success 包装

部分后端删除接口会返回“HTTP 200 + `success=false` + 成功消息 + `data=null`”的 no-data success 形态。CLI MUST 把这类响应识别为成功，而不是误判成业务错误。

#### Scenario: domain delete 遇到 code 200 的 no-data success 仍视为成功

- **WHEN** 用户执行 `cz-cli analytics-agent domain delete 195`
- **AND** 后端返回 `code=200`、`success=false`、`message=操作成功`、`data=null`
- **THEN** CLI MUST 将该命令视为成功
- **AND** 退出码 MUST 为 0

### Requirement: domain table add 预先校验完整表名

`cz-cli analytics-agent domain table add` MUST 在发起添加前先校验 `--table-name` 是否是数据源返回的完整表名。如果用户只传了短表名，CLI MUST 直接给出明确报错和建议修正值，而不是把错误请求发给后端。

#### Scenario: 只传短表名时直接报错并提示完整表名

- **WHEN** 用户执行 `cz-cli analytics-agent domain table add 19 --datasource-id 4164 --path "workspace:quick_start/schema:rpt" --table-name "rpt_transaction_lazada"`
- **AND** 数据源 `show-table` 返回的 `fullName` 是 `quick_start.rpt.rpt_transaction_lazada`
- **THEN** CLI MUST 不调用 domain table add 接口
- **AND** CLI MUST 返回明确错误，提示当前 `--table-name` 不是完整表名
- **AND** CLI MUST 在错误里给出建议值 `quick_start.rpt.rpt_transaction_lazada`

#### Scenario: 已传完整表名时允许继续

- **WHEN** 用户执行 `cz-cli analytics-agent domain table add 19 --datasource-id 4164 --path "workspace:quick_start/schema:rpt" --table-name "quick_start.rpt.rpt_transaction_lazada"`
- **AND** 数据源 `show-table` 返回的 `fullName` 也是 `quick_start.rpt.rpt_transaction_lazada`
- **THEN** CLI MUST 继续执行后续预检查和添加请求

### Requirement: domain table add 预先检查 domain 内表冲突

`cz-cli analytics-agent domain table add` MUST 在发起添加前先检查目标 domain 当前是否已经存在相同表名。如果已存在，CLI MUST 直接报错并指出冲突对象，而不是让客户侧 agent重复提交同一张表。

#### Scenario: domain 中已存在同名表时直接拒绝

- **WHEN** 用户执行 `cz-cli analytics-agent domain table add 19 --datasource-id 4164 --path "workspace:quick_start/schema:rpt" --table-name "quick_start.rpt.rpt_transaction_lazada"`
- **AND** domain detail 返回的 `tables` 里已经包含 `tableName="quick_start.rpt.rpt_transaction_lazada"`
- **THEN** CLI MUST 不调用 domain table add 接口
- **AND** CLI MUST 返回明确错误，说明该 domain 已包含同名表

#### Scenario: domain 中无冲突时继续添加

- **WHEN** 用户执行 `cz-cli analytics-agent domain table add 19 --datasource-id 4164 --path "workspace:quick_start/schema:rpt" --table-name "quick_start.rpt.rpt_transaction_lazada"`
- **AND** domain detail 返回的 `tables` 中没有该表
- **THEN** CLI MUST 调用 domain table add 接口
