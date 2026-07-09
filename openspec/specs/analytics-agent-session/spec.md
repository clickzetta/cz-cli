# analytics-agent session 规格说明

## Purpose
定义 `cz-cli analytics-agent session` 命令组的用户可见参数面，确保常用 session 请求使用扁平参数，不要求用户手写内部 JSON body。

## Requirements

### Requirement: session list/create/result/stop 使用扁平参数

`cz-cli analytics-agent session list`、`create`、`result`、`stop` MUST 使用显式参数构造请求体，不把 `--body` 暴露为普通用户主路径。

#### Scenario: session list 用扁平字段构造请求体

- **WHEN** 用户执行 `cz-cli analytics-agent session list --domain-id 195 --source-type dashboard --source-id 7`
- **THEN** CLI 调用 session list open API
- **且** 请求体包含 `domainId`、`sourceType`、`sourceId`

#### Scenario: session create 用扁平字段构造请求体

- **WHEN** 用户执行 `cz-cli analytics-agent session create --domain-id 195 --title 销售诊断 --source-type dashboard --source-id 7`
- **THEN** CLI 调用 session create open API
- **且** 请求体包含 `domainId`、`title`、`sourceType`、`sourceId`

#### Scenario: session create 传入非法 domain-id 时本地拒绝

- **WHEN** 用户执行 `cz-cli analytics-agent session create --domain-id abc --title 销售诊断`
- **THEN** CLI MUST 在发请求前直接返回 `USAGE_ERROR`
- **且** 错误信息 MUST 明确说明 `--domain-id` 必须是正整数

#### Scenario: session result 用扁平字段构造请求体

- **WHEN** 用户执行 `cz-cli analytics-agent session result 123`
- **THEN** CLI 调用 session result open API
- **且** 请求体包含 `questionId=123`

#### Scenario: session stop 用扁平字段构造请求体

- **WHEN** 用户执行 `cz-cli analytics-agent session stop 7 123`
- **THEN** CLI 调用 session stop open API
- **且** 请求体包含 `sessionId=7`
- **且** 请求体包含 `questionId=123`

### Requirement: session run 使用扁平参数并对齐后端必填 domainId 契约

`cz-cli analytics-agent session run` MUST 使用显式参数组装请求体，不把 `--body` 暴露为普通用户主路径。由于后端 open query 明确要求 `domainId` 必填，因此 CLI MUST 要求 `--domain-id` 始终提供；`--session-id` 仅用于复用已有会话，不再单独作为可脱离 domainId 的入口。

#### Scenario: run 复用已有 session 时同时携带 domain-id

- **WHEN** 用户执行 `cz-cli analytics-agent session run --domain-id 195 --session-id 7 --msg "hello" --model-name deepseek`
- **THEN** CLI 先调用 query API
- **且** 请求体包含 `domainId`、`sessionId`、`msg`
- **且** 请求体中的 `modelSettings.model_name` 为 `deepseek`

#### Scenario: run 只有 session-id 但缺少 domain-id

- **WHEN** 用户执行 `cz-cli analytics-agent session run --session-id 7 --msg "hello"`
- **THEN** CLI MUST 在本地直接拒绝该请求
- **且** 错误信息 MUST 明确说明 `--domain-id` is required

#### Scenario: run 在未传 session-id 时自动创建 session

- **WHEN** 用户执行 `cz-cli analytics-agent session run --domain-id 195 --msg "hello"`
- **THEN** CLI MUST 先调用 session create open API
- **AND** 再使用返回的 `sessionId` 调用 query API
- **AND** query 请求体 MUST 同时包含 `domainId` 与新建得到的 `sessionId`

#### Scenario: help 不再暴露 body

- **WHEN** 用户执行 `cz-cli analytics-agent session run --help`
- **THEN** help 中不包含 `--body`
