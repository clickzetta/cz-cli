# analytics-agent session 规格说明

## Purpose
定义 `cz-cli analytics-agent session` 命令组的用户可见参数面，确保常用 session 请求使用扁平参数，不要求用户手写内部 JSON body。

## Requirements

### Requirement: session list/create/delete/result/stop 使用扁平参数

`cz-cli analytics-agent session list`、`create`、`delete`、`result`、`stop` MUST 使用显式参数构造请求体，不把 `--body` 暴露为普通用户主路径。`session create` 的 `--title` MUST 提供且非空。`session delete` MUST 通过显式 `--session-id` 传入要删除的会话。

#### Scenario: session list 用扁平字段构造请求体

- **WHEN** 用户执行 `cz-cli analytics-agent session list --domain-id 195 --source-type dashboard --source-id 7`
- **THEN** CLI 调用 session list open API
- **且** 请求体包含 `domainId`、`sourceType`、`sourceId`

#### Scenario: session create 用扁平字段构造请求体

- **WHEN** 用户执行 `cz-cli analytics-agent session create --domain-id 195 --title 销售诊断 --source-type dashboard --source-id 7`
- **THEN** CLI 调用 session create open API
- **且** 请求体包含 `domainId`、`title`、`sourceType`、`sourceId`

#### Scenario: session delete 用扁平字段构造请求体

- **WHEN** 用户执行 `cz-cli analytics-agent session delete --session-id 88`
- **THEN** CLI 调用 session delete open API
- **且** 请求体包含 `sessionId=88`
- **且** 请求体不需要手写 `--body`

#### Scenario: session create 传入非法 domain-id 时本地拒绝

- **WHEN** 用户执行 `cz-cli analytics-agent session create --domain-id abc --title 销售诊断`
- **THEN** CLI MUST 在发请求前直接返回 `USAGE_ERROR`
- **且** 错误信息 MUST 明确说明 `--domain-id` 必须是正整数

#### Scenario: session delete 缺少 session-id 时本地拒绝

- **WHEN** 用户执行 `cz-cli analytics-agent session delete`
- **THEN** CLI MUST 在发请求前直接返回 `USAGE_ERROR`
- **且** 错误信息 MUST 明确说明 `--session-id` 必填

#### Scenario: session create 缺少 title 时本地拒绝

- **WHEN** 用户执行 `cz-cli analytics-agent session create --domain-id 195`
- **THEN** CLI MUST 在发请求前直接返回 `USAGE_ERROR`
- **且** 错误信息 MUST 明确说明 `--title` 必填

#### Scenario: session create 传入空 title 时本地拒绝

- **WHEN** 用户执行 `cz-cli analytics-agent session create --domain-id 195 --title "   "`
- **THEN** CLI MUST 在发请求前直接返回 `USAGE_ERROR`
- **且** 错误信息 MUST 明确说明 `--title` 非空

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

`cz-cli analytics-agent session run` MUST 支持通过可重复的 `--model-setting KEY=VALUE` 传入 0 到多个任意 `modelSettings` 字段，不再固定暴露 `thinking-level` 这类单一开关。当前后端可用的键为 `language`（如 `zh-CN`）与 `thinkingLevel`（如 `off`）。每个条目按第一个 `=` 拆分：`=` 左侧为字段名（去除首尾空格），右侧为字段值；值 MUST 按宽松 JSON 规则解析（`true`/`false`/`null`、数字、`{...}`/`[...]`/带引号的字符串按 JSON 解析，其余保留为原始字符串）。`--model-name` 作为 `model_name` 的便捷写法保留；同名 `--model-setting` 条目 MUST 覆盖 `--model-name` 的值。

#### Scenario: run 传入多个 --model-setting 时写入 modelSettings

- **WHEN** 用户执行 `cz-cli analytics-agent session run --domain-id 195 --session-id 7 --msg "hello" --model-setting thinkingLevel=off --model-setting language=zh-CN`
- **THEN** CLI 调用 query API
- **且** 请求体中的 `modelSettings.thinkingLevel` 为字符串 `off`
- **且** 请求体中的 `modelSettings.language` 为字符串 `zh-CN`

#### Scenario: run 未传任何 model 相关参数时不携带 modelSettings

- **WHEN** 用户执行 `cz-cli analytics-agent session run --domain-id 195 --session-id 7 --msg "hello"`
- **THEN** CLI 调用 query API
- **且** 请求体 MUST NOT 包含 `modelSettings` 字段

#### Scenario: run 的 --model-setting 覆盖 --model-name

- **WHEN** 用户执行 `cz-cli analytics-agent session run --domain-id 195 --session-id 7 --msg "hello" --model-name deepseek --model-setting model_name=qwen`
- **THEN** CLI 调用 query API
- **且** 请求体中的 `modelSettings.model_name` 为 `qwen`

#### Scenario: run 只有 session-id 但缺少 domain-id

- **WHEN** 用户执行 `cz-cli analytics-agent session run --session-id 7 --msg "hello"`
- **THEN** CLI MUST 在本地直接拒绝该请求
- **且** 错误信息 MUST 明确说明 `--domain-id` is required

#### Scenario: run 在未传 session-id 时自动创建 session

- **WHEN** 用户执行 `cz-cli analytics-agent session run --domain-id 195 --msg "hello"`
- **THEN** CLI MUST 先调用 session create open API
- **AND** session create 请求体 MUST 同时包含 `domainId` 与非空 `title`
- **AND** 再使用返回的 `sessionId` 调用 query API
- **AND** query 请求体 MUST 同时包含 `domainId` 与新建得到的 `sessionId`

#### Scenario: run 缺少 msg 时本地拒绝

- **WHEN** 用户执行 `cz-cli analytics-agent session run --domain-id 195 --msg "   "`
- **THEN** CLI MUST 在本地直接拒绝该请求
- **且** 错误信息 MUST 明确说明 `--msg` 非空

#### Scenario: help 不再暴露 body

- **WHEN** 用户执行 `cz-cli analytics-agent session run --help`
- **THEN** help 中不包含 `--body`
