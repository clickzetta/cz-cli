# attempts-management 规格说明

## Purpose
定义 `cz-cli attempts` 命令族，覆盖 run attempt 列表和 attempt 日志查询。旧 Python execution/attempt 日志能力在当前仓库中由 `runs` 与 `attempts` 分工承接：`runs` 管 run instance，`attempts` 管单次 attempt 记录与日志。

## Requirements
### Requirement: Attempts 命令 help 签名稳定

本需求 MUST 按以下场景执行。

`attempts` 命令族 MUST 通过 help 暴露当前子命令和命令级参数。

#### Scenario: attempts group help

- **WHEN** 用户执行 `cz-cli attempts --help`
- **THEN** help 显示 `list [id]`、`log [id]` 与 `logs [id]`
- **AND** `logs` 作为 `log` 的 alias 或等价入口

#### Scenario: list 参数

- **WHEN** 用户执行 `cz-cli attempts list --help`
- **THEN** help 显示 positional `id`、`--run-id`、`--task-id`、`--page`、`--page-size`、`--limit`
- **AND** positional `id` 的优先级高于 `--run-id`、`--task-id` 和自动选择最新 run

### Requirement: attempts list 支持 run 和 task 两种定位方式

本需求 MUST 按以下场景执行。

系统 MUST 支持按 run instance ID 或 task name/ID 查询 attempt records。

#### Scenario: 按 run ID 查询 attempts

- **WHEN** 用户执行 `cz-cli attempts list 123 --format json`
- **THEN** 系统按 run instance ID 查询 attempts
- **AND** 输出包含 attempt ID、状态、开始/结束时间和可用错误摘要

#### Scenario: 按 task 自动选择最新 run

- **WHEN** 用户执行 `cz-cli attempts list --task-id daily_task`
- **THEN** 系统先定位该 task 的最新 run，再列出其 attempts
- **AND** 找不到 run 时返回 not found 或业务错误

### Requirement: attempts log 获取 attempt 日志

本需求 MUST 按以下场景执行。

`attempts log` MUST 获取单次 attempt 日志；`attempts logs` MUST 保持等价行为或兼容 alias。

#### Scenario: 获取指定 attempt 日志

- **WHEN** 用户执行 `cz-cli attempts log 123 --attempt-id 456 --offset 0`
- **THEN** 系统返回指定 attempt 的日志内容或日志片段
- **AND** 输出包含后续分页所需 offset 或截断提示（如后端提供）

#### Scenario: 未指定 attempt ID

- **WHEN** 用户执行 `cz-cli attempts log 123`
- **THEN** 系统自动选择首个 attempt 或 help 契约声明的默认 attempt
- **AND** 若没有 attempts，返回空日志状态或可诊断业务错误
