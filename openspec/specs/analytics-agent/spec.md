# analytics-agent 规格说明

## Purpose
定义 `cz-cli analytics-agent` 命令族对 Analytics Agent 服务、domain、datasource、session 等 API 的封装要求。

## Requirements
### Requirement: analytics-agent 命令 help 签名稳定

本需求 MUST 按以下场景执行。

`analytics-agent` MUST 通过 help 暴露当前子命令组，并以命令 help 作为参数契约。

#### Scenario: group help

- **WHEN** 用户执行 `cz-cli analytics-agent --help`
- **THEN** help 展示 datasource、domain、service、session 等当前子命令组（以实现为准）
- **AND** 全局连接与输出格式参数可用

#### Scenario: 未知子命令

- **WHEN** 用户执行 `cz-cli analytics-agent unknown`
- **THEN** CLI 返回 usage error
- **AND** 不调用远端服务

### Requirement: 输出字段面向用户和 agent

本需求 MUST 按以下场景执行。

Analytics Agent API 的输出 MUST 使用产品/领域友好的字段名，并适合 table-first 渲染。

#### Scenario: 列表输出

- **WHEN** 用户执行 analytics-agent 的 list 类命令并指定 `--format table`
- **THEN** 主要 ID、name、status、created/updated 字段位于顶层
- **AND** raw backend payload 仅放在明确 raw/debug 字段中

#### Scenario: 枚举值

- **WHEN** 后端返回数字或 magic string 状态
- **THEN** 输出 SHOULD 同时提供可读 label 字段
- **AND** 不要求 agent 查后端枚举表才能理解结果

### Requirement: 错误可诊断

本需求 MUST 按以下场景执行。

Analytics Agent 命令 MUST 将远端错误映射为结构化 CLI 错误。

#### Scenario: 权限不足

- **WHEN** 远端返回权限不足
- **THEN** CLI 输出业务错误 code 和 message
- **AND** `ai_message` SHOULD 指导检查 profile、service 或权限

#### Scenario: 资源不存在

- **WHEN** 用户请求不存在的 domain/session/datasource
- **THEN** CLI 返回 not found
- **AND** 错误包含请求标识
