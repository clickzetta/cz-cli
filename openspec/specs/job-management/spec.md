# job-management 规格说明

## Purpose
定义 `cz-cli job` 命令族：`status`、`result`、`profile`，并迁移旧 Python runs-detail-enrichment 中的 job download/analyze/status 能力到当前 SQL job performance tools。

## Requirements
### Requirement: Job 命令 help 签名稳定

本需求 MUST 按以下场景执行。

`job` 命令族 MUST 通过 help 暴露当前子命令。

#### Scenario: job group help

- **WHEN** 用户执行 `cz-cli job --help`
- **THEN** help 显示 `status <job-id>`、`result <job-id>`、`profile <job-id>`
- **AND** 全局连接与输出格式参数可用

#### Scenario: 旧 download/analyze 名称

- **WHEN** 用户查找旧 Python 文档中的 `job download` 或 `job analyze`
- **THEN** 当前 spec MUST 指向 `job result` 与 `job profile` 的等价路径
- **AND** 不把旧命令名列为当前承诺

### Requirement: job status 查询 SQL job 状态

本需求 MUST 按以下场景执行。

系统 MUST 支持按 job ID 查询 SQL job 当前状态和摘要。

#### Scenario: 状态查询成功

- **WHEN** 用户执行 `cz-cli job status <job-id> --format json`
- **THEN** 系统返回 job 状态、开始/结束时间和可用摘要字段
- **AND** 状态值旁 SHOULD 提供可读 label

#### Scenario: job 不存在

- **WHEN** job ID 无效或不存在
- **THEN** CLI 返回 not found 或后端业务错误
- **AND** 错误中包含 job ID

### Requirement: job result 获取结果集

本需求 MUST 按以下场景执行。

`job result <job-id>` MUST 获取 SQL job 结果集，并在 job 仍运行时按命令契约等待或返回状态。

#### Scenario: 结果可用

- **WHEN** 用户执行 `cz-cli job result <job-id> --format table`
- **THEN** 系统返回结果行
- **AND** 表格输出列来自 SQL result schema

#### Scenario: 结果过大或未完成

- **WHEN** 结果集过大或 job 尚未完成
- **THEN** CLI 返回分页/等待/稍后查询指导
- **AND** 不截断关键诊断而无提示

### Requirement: job profile 输出扁平可读

本需求 MUST 按以下场景执行。

`job profile <job-id>` MUST 返回 agent 友好的扁平 profile 摘要。

#### Scenario: profile 查询成功

- **WHEN** 用户执行 `cz-cli job profile <job-id> --format json`
- **THEN** 输出包含执行耗时、扫描/写入统计、资源摘要等可用字段
- **AND** table 输出的主字段位于顶层

#### Scenario: profile 不可用

- **WHEN** 后端尚未生成 profile 或 job 类型不支持
- **THEN** CLI 返回业务错误或空态
- **AND** `ai_message` SHOULD 提示先检查 `job status`
