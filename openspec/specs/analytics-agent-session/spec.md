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

### Requirement: session 问答提示同一 session 必须串行

同一个 Analytics Agent session 内的问答 MUST 由调用方串行提交；CLI MUST 在 session create 下一步提示与 session run help/输出中明确提示前一个问题完成后才能开始下一个，避免 agent 并行发问导致后端返回 `Analysis failed: Another question is currently being processed, please try again later`。

#### Scenario: session run help 提示同一 session 必须串行

- **WHEN** 用户执行 `cz-cli analytics-agent session run --help`
- **THEN** help 中 MUST 提示同一个 session 内的问答必须串行
- **且** 提示 MUST 明确说明前一个问题完成后才能开始下一个
- **且** 提示 MUST 提醒并行时会收到 `Analysis failed: Another question is currently being processed, please try again later`

#### Scenario: session create 输出下一步时提示串行约束

- **WHEN** 用户执行 `cz-cli analytics-agent session create --domain-id 195 --title 销售诊断`
- **THEN** 输出的下一步提示 MUST 提示同一个 session 内的后续问答必须串行
- **且** 提示 MUST 明确说明前一个问题完成后再发下一个
