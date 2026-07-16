# runs-management 规格说明

## Purpose
定义 `cz-cli runs` 命令族，覆盖 run instance 列表、详情、等待、日志、依赖、停止、补数、重跑和统计。旧 Python `runs log` 已改为规范命令 `runs logs`，`log` 仅作为 alias。

## Requirements
### Requirement: Runs 命令 help 签名稳定

本需求 MUST 按以下场景执行。

`runs` 命令族 MUST 通过 help 暴露当前子命令和命令级参数。

#### Scenario: runs group help

- **WHEN** 用户执行 `cz-cli runs --help`
- **THEN** help 显示 `list`、`detail <id>`、`wait <id>`、`logs <id>`、`deps <id>`、`stop <id>`、`refill <task>`、`rerun <id>`、`stats`
- **AND** `logs` 可声明 alias `log`

#### Scenario: list 参数

- **WHEN** 用户执行 `cz-cli runs list --help`
- **THEN** help 显示 task/status/run-type/from/to/page/page-size/limit 等当前参数
- **AND** 调用方不得把 `--limit` 当作全局参数

### Requirement: runs list 支持分页和过滤

本需求 MUST 按以下场景执行。

系统 MUST 支持按任务、状态、run type 和时间范围列出 run instances。

#### Scenario: 分页查询

- **WHEN** 用户执行 `cz-cli runs list --task daily --page 1 --page-size 10`
- **THEN** 系统返回最多 10 条 run instances
- **AND** 输出包含总数或分页下一步提示（如后端提供）

#### Scenario: 非法状态

- **WHEN** 用户传入不在 help choices 中的 status
- **THEN** CLI 返回 usage error
- **AND** 不调用远端 API

### Requirement: runs detail 使用精确 run ID

本需求 MUST 按以下场景执行。

`runs detail <id>` MUST 以 run instance ID 查询详情；按 task name 查最新 run 的能力若存在，必须在 help 中明确。

#### Scenario: 按 run ID 查询

- **WHEN** 用户执行 `cz-cli runs detail 123`
- **THEN** 系统查询该 run instance 详情
- **AND** 返回 instance 字段、状态、时间和调度配置摘要（如可用）

#### Scenario: ID 不存在

- **WHEN** run ID 不存在
- **THEN** CLI 返回 not found 或后端错误
- **AND** 错误包含请求 ID

### Requirement: runs logs 是规范日志命令

本需求 MUST 按以下场景执行。

`runs logs <id>` MUST 获取 run execution log；`runs log` 仅作为 alias 兼容。

#### Scenario: 获取日志

- **WHEN** 用户执行 `cz-cli runs logs 123`
- **THEN** 系统获取该 run 或最近 execution 日志
- **AND** 支持 `--offset` 等 help 中声明的参数

#### Scenario: 无执行记录

- **WHEN** run 没有 execution records 或日志为空
- **THEN** CLI 返回空日志状态或业务错误
- **AND** `ai_message` SHOULD 说明可先查看 `runs detail`

### Requirement: runs deps 查询调度态依赖

本需求 MUST 按以下场景执行。

`runs deps <id>` MUST 查询已发布/调度态上游与下游依赖图。

#### Scenario: 默认深度

- **WHEN** 用户执行 `cz-cli runs deps 123`
- **THEN** 系统查询 parent_level=1 与 child_level=1 的 run dependency graph
- **AND** 输出说明这是调度态依赖，草稿态依赖使用 `cz-cli task deps`

#### Scenario: 自定义深度

- **WHEN** 用户执行 `cz-cli runs deps 123 --parent-level 2 --child-level 3`
- **THEN** 系统按指定深度查询
- **AND** 非法深度返回错误

### Requirement: wait、stop、refill、rerun 风险明确

本需求 MUST 按以下场景执行。

运行实例控制命令 MUST 明确等待/确认/不可逆语义。

#### Scenario: 等待完成

- **WHEN** 用户执行 `cz-cli runs wait 123 --attempts 120 --interval 5`
- **THEN** 系统轮询直到完成或达到尝试上限
- **AND** 超时时按 `--allow-timeout` 决定退出码

#### Scenario: 补数需要确认

- **WHEN** 用户执行 `cz-cli runs refill TASK --from 2026-01-01 --to 2026-01-02` 且未确认
- **THEN** CLI 在 TTY 中确认，非 TTY 要求 `--yes`
- **AND** help 说明 refill 是不可逆/高风险操作
- **AND** help 说明该接口依赖当前登录用户名作为后端 `createBy`

#### Scenario: 补数请求使用后端兼容字段

- **WHEN** 用户执行 `cz-cli runs refill TASK --from 2026-01-01 --to 2026-01-02 --yes`
- **THEN** CLI 提交的补数请求包含 `createBy`、`userId`、`dateList` 与 `complementBizDateBeanList`
- **AND** `createBy` 使用当前登录用户名，`userId` 使用当前登录用户 ID
- **AND** `dateList` 与 `complementBizDateBeanList` 使用 `bizStartDate`/`bizEndDate` 表达补数时间窗口

#### Scenario: 补数时间边界参数不完整

- **WHEN** 用户执行 `cz-cli runs refill TASK --from 2026-01-01 --yes` 或仅传 `--to`
- **THEN** CLI 返回 `INVALID_ARGUMENTS`
- **AND** 不调用补数创建 API

#### Scenario: 当前登录上下文缺少用户名

- **WHEN** 用户执行 `cz-cli runs refill TASK --yes`，但当前登录上下文没有可用的用户名
- **THEN** CLI 返回 `INVALID_ARGUMENTS`
- **AND** 错误提示需要重新登录或刷新 profile
- **AND** 不调用补数创建 API
