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

### Requirement: id 参数本地校验为正整数

`analytics-agent` 命令族的资源 id 参数（如 `domain-id`、`dataset-id`、`attr-id`、`metric-id`、`analysis-id`、`node-id`、`space-id`、`join-id`、`table-id`、`datasource-id`、`question-id`、`session-id` 等）MUST 在发请求前本地校验为正整数（安全整数范围内、> 0）。非数字、小数、0、负数、超出安全整数范围的输入 MUST 直接返回 `USAGE_ERROR`，不得把非法值发给后端而暴露为 HTTP 500 或后端 NPE。表示根节点的 `parent-id`（允许为 0）不受此约束。

#### Scenario: 非数字 id 本地拒绝

- **WHEN** 用户执行 `cz-cli analytics-agent domain detail abc`
- **THEN** CLI MUST 在发请求前直接返回 `USAGE_ERROR`
- **且** 错误信息 MUST 说明该 id 必须是正整数
- **AND** 不调用远端服务

#### Scenario: 小数 / 0 / 负数 / 溢出 id 本地拒绝

- **WHEN** 用户对任一资源 id 传入 `27.5`、`0`、`-1` 或超出安全整数范围的值（如 `99999999999999999999`）
- **THEN** CLI MUST 在发请求前直接返回 `USAGE_ERROR`
- **AND** 不调用远端服务

#### Scenario: 合法 id 正常放行

- **WHEN** 用户传入正整数 id
- **THEN** 校验通过并正常调用远端服务

#### Scenario: parent-id 允许为 0（根节点）

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge file list <space-id> --parent-id 0`
- **THEN** CLI MUST NOT 因 `parent-id=0` 报 `USAGE_ERROR`
- **且** 正常按根节点查询

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
