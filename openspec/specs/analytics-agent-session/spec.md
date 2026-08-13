# analytics-agent session 规格说明

## Purpose
定义 `cz-cli analytics-agent session` 命令组的用户可见参数面，确保 session 删除可以通过显式会话 ID 调用。

## Requirements

### Requirement: session delete 使用显式 session-id

`cz-cli analytics-agent session delete` MUST 使用显式 `--session-id` 参数构造请求体，并调用已存在的 open API。

#### Scenario: session delete 用扁平字段构造请求体

- **WHEN** 用户执行 `cz-cli analytics-agent session delete --session-id 88`
- **THEN** CLI 调用 session delete open API
- **且** 请求体包含 `sessionId=88`

#### Scenario: session delete 缺少 session-id 时本地拒绝

- **WHEN** 用户执行 `cz-cli analytics-agent session delete`
- **THEN** CLI MUST 在发请求前直接返回 `USAGE_ERROR`
- **且** 错误信息 MUST 明确说明 `session-id` 必填
