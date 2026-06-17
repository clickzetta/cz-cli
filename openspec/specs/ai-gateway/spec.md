# ai-gateway 规格说明

## Purpose
定义 ClickZetta AIGW virtual key 与 model 浏览命令。该能力当前在 `cz-cli ai-gateway` 下，不属于旧 Python `ai-guide`。

## Requirements
### Requirement: ai-gateway 命令 help 签名稳定

本需求 MUST 按以下场景执行。

`ai-gateway` 命令族 MUST 暴露 key 和 model 两个子命令组。

#### Scenario: ai-gateway group help

- **WHEN** 用户执行 `cz-cli ai-gateway --help`
- **THEN** help 显示 `key` 和 `model`
- **AND** 全局连接与输出格式参数可用

#### Scenario: 未知子命令

- **WHEN** 用户执行 `cz-cli ai-gateway unknown`
- **THEN** CLI 返回 usage error
- **AND** 提示查看 help

### Requirement: model list 默认限制并提示 agent

本需求 MUST 按以下场景执行。

model list SHOULD 默认限制返回数量，避免 agent 上下文膨胀，并通过 `ai_message` 提供继续分页/取消限制提示。

#### Scenario: 默认限制

- **WHEN** 用户执行 `cz-cli ai-gateway model list <key-or-alias>`
- **THEN** CLI 默认最多请求/返回 10 个模型（或 help 声明的默认值）
- **AND** `ai_message` 提示使用 `--limit` 或 `--no-limit`

#### Scenario: 取消限制

- **WHEN** 用户执行 `cz-cli ai-gateway model list <key-or-alias> --no-limit`
- **THEN** CLI 请求完整模型列表
- **AND** 大结果仍可通过输出格式和截断提示保护 agent 上下文

### Requirement: virtual key 管理保护敏感值

本需求 MUST 按以下场景执行。

key 子命令 MUST 遮蔽 secret，只在创建时返回必要一次性信息。

#### Scenario: 列出 key

- **WHEN** 用户执行 `cz-cli ai-gateway key list --format json`
- **THEN** 输出 key 元数据和 alias/status
- **AND** 不泄露完整 secret

#### Scenario: 创建失败

- **WHEN** 创建 key 的请求被拒绝或 quota 不足
- **THEN** CLI 返回业务错误
- **AND** 错误字段使用用户可理解名称
