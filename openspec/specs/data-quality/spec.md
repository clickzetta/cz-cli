# data-quality 规格说明

## Purpose
定义数据质量检查（DQC）命令族 `cz-cli dqc`。该能力从 clickzetta-studio-ai-agent（Python）迁移而来，以自定义 SQL 规则为核心，覆盖列出/创建/更新/统计/立即执行/删除六类操作，供 agent 在 Lakehouse 上编排数据质量校验。

## Requirements
### Requirement: dqc 命令 help 签名稳定

本需求 MUST 按以下场景执行。

`dqc` 命令族 MUST 通过 help 暴露当前子命令。

#### Scenario: dqc group help

- **WHEN** 用户执行 `cz-cli dqc --help`
- **THEN** help 显示 `list`、`create`、`update`、`stat`、`run`、`delete`
- **AND** 全局连接与输出格式参数可用

#### Scenario: 缺少子命令

- **WHEN** 用户执行 `cz-cli dqc` 不带子命令
- **THEN** CLI 返回 usage error 并列出可用子命令
- **AND** 不调用远端 API

### Requirement: 列出数据质量规则

本需求 MUST 按以下场景执行。

系统 MUST 支持按目标表模糊过滤并分页列出 DQC 规则。

#### Scenario: 列出规则

- **WHEN** 用户执行 `cz-cli dqc list --object sales.orders --format json`
- **THEN** 系统返回规则列表，字段含 `rule_id`、`object_name`、`trigger_type`、`vcluster`、`checker_info`、`latest_status`
- **AND** 返回分页信息 total/page_num

#### Scenario: 空结果

- **WHEN** 用户执行 `cz-cli dqc list --object 不存在的表`
- **THEN** 系统返回空规则列表且 count 为 0
- **AND** 不报错

### Requirement: 创建自定义 SQL 数据质量规则

本需求 MUST 按以下场景执行。

系统 MUST 支持用返回单个数字的 SQL 配合比较符与阈值创建规则，并要求显式指定计算型 VC。

#### Scenario: 创建规则

- **WHEN** 用户执行 `cz-cli dqc create --table sales.orders --sql "select count(*) from sales.orders where amount < 0" --operator EQUAL --value 0 --vc analytics_vc`
- **THEN** 系统提交规则，请求体含 `tagCode=defined_sql`、`checkerInfo` 为 `{"checker":"FIXED","operator":"EQUAL","value":0}`、`vcCode=analytics_vc`
- **AND** 返回新建的 `rule_id`

#### Scenario: 缺少 VC

- **WHEN** 用户执行 `cz-cli dqc create --table sales.orders --sql "select count(*) from sales.orders where amount < 0" --operator EQUAL --value 0` 未提供 `--vc`
- **THEN** CLI 返回 `VclusterRequired` 错误并列出当前 workspace 可用的计算型 VC（GENERAL/ANALYTICS）
- **AND** 不创建规则

#### Scenario: operator 非法

- **WHEN** 用户执行 `cz-cli dqc create --table sales.orders --sql "..." --operator LIKE --value 0 --vc analytics_vc`
- **THEN** CLI 返回 usage error，说明 operator 必须是 EQUAL/NOT_EQUAL/LESS_THAN/LESS_EQUAL/GREATER_THAN/GREATER_EQUAL 之一
- **AND** 不创建规则

### Requirement: 更新数据质量规则

本需求 MUST 按以下场景执行。

系统 MUST 以读-改-写全量模式更新规则：先读取完整规则对象，覆盖显式给出的字段，再全量回传。

#### Scenario: 更新规则

- **WHEN** 用户执行 `cz-cli dqc update 123 --operator LESS_EQUAL --value 10 --vc analytics_vc`
- **THEN** 系统先读取规则 123 明细，覆盖 `checkerInfo` 与 `vcCode` 后全量回传
- **AND** 返回更新后的 `rule_id` 与被修改字段列表

#### Scenario: operator 与 value 未成对

- **WHEN** 用户执行 `cz-cli dqc update 123 --operator LESS_EQUAL`（缺少 `--value`）
- **THEN** CLI 返回 usage error，说明 operator 与 value 必须同时提供
- **AND** 不回传更新

#### Scenario: 规则不存在

- **WHEN** 用户执行 `cz-cli dqc update 999999 --desc x` 且规则 999999 无法读取
- **THEN** CLI 返回业务错误，说明无法读取该规则明细
- **AND** 不回传更新

### Requirement: 数据质量统计概览

本需求 MUST 按以下场景执行。

系统 MUST 支持规则&表总量（rule_table）与规则执行健康度（rule_task，含通过率）两类统计，默认 rule_task。

#### Scenario: 执行健康度统计

- **WHEN** 用户执行 `cz-cli dqc stat`（默认 type=rule_task）
- **THEN** 系统返回规则执行任务数与通过率概览

#### Scenario: type 非法

- **WHEN** 用户执行 `cz-cli dqc stat --type unknown`
- **THEN** CLI 返回 usage error，说明 type 必须是 rule_table 或 rule_task
- **AND** 不调用远端 API

### Requirement: 立即执行数据质量规则

本需求 MUST 按以下场景执行。

系统 MUST 支持立即（异步）触发一条规则，返回 task_id，校验结果需另行查询。

#### Scenario: 立即执行

- **WHEN** 用户执行 `cz-cli dqc run 123`
- **THEN** 系统异步触发规则并返回 `task_id`
- **AND** 提示校验结果（过/不过）需稍后查询任务获取

#### Scenario: 缺少 rule_id

- **WHEN** 用户执行 `cz-cli dqc run` 未提供 rule-id
- **THEN** CLI 返回 usage error
- **AND** 不调用远端 API

### Requirement: 删除数据质量规则

本需求 MUST 按以下场景执行。

删除为破坏性操作，MUST 在非 `--yes` 时要求交互确认。

#### Scenario: 确认后删除

- **WHEN** 用户执行 `cz-cli dqc delete 123 --yes`
- **THEN** 系统删除规则 123 并返回成功
- **AND** 不再要求确认

#### Scenario: 非交互环境未确认

- **WHEN** 用户在非 TTY 环境执行 `cz-cli dqc delete 123` 未带 `--yes`
- **THEN** CLI 返回取消结果（executed=false）
- **AND** 不删除规则

### Requirement: 规则触发方式校验

本需求 MUST 按以下场景执行。

系统 MUST 校验触发方式：REST=手动、PLAN=定时（需 cron）、SCHEDULE_TASK=挂调度任务（需 main-task + level）。

#### Scenario: 定时触发缺少 cron

- **WHEN** 用户执行 `cz-cli dqc create --table t --sql "..." --operator EQUAL --value 0 --vc v --trigger-type PLAN` 未提供 `--cron`
- **THEN** CLI 返回 usage error，说明 PLAN 触发方式必须提供 cron
- **AND** 不创建规则

#### Scenario: 挂调度任务缺少 level

- **WHEN** 用户执行 `... --trigger-type SCHEDULE_TASK --main-task 100` 未提供 `--level`
- **THEN** CLI 返回 usage error，说明 SCHEDULE_TASK 必须提供 main-task 与 level
- **AND** 不创建规则
