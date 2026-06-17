# task-management 规格说明

## Purpose
定义 Studio task 命令族的基础行为。当前 TypeScript 版本命令包括 list/list-folders/folder-tree/create/create-realtime-sync/create-batch-sync/create-stream-sync/create-setup/create-folder/status/content/save-content/create-offline-sync/offline-sync-schema/save-offline-sync/save-realtime-sync/lineage/save-cron/save-config/deps/deploy/start/stop/undeploy/execute/flow/delete-folder/delete/schedule-info/downstream/cron-preview/search/stats 等，旧 Python 的 `task detail` 与 `task save` 只作为别名或迁移语义保留。

## Requirements
### Requirement: Task 命令 help 签名稳定

本需求 MUST 按以下场景执行。

`cz-cli task --help` MUST 展示当前支持的任务命令，并以 help 作为参数契约来源。

#### Scenario: task group help

- **WHEN** 用户执行 `cz-cli task --help`
- **THEN** help 显示创建、同步任务配置、列表、folder、状态、内容、保存、配置、依赖、部署、启停、执行、flow、删除、调度信息、下游、cron 预览、搜索和统计相关子命令
- **AND** 旧命令名如 `detail` 可作为 alias 出现，但不应作为首选文档入口

#### Scenario: 命令级参数

- **WHEN** 用户需要判断 `task list` 是否支持 `--limit` 或 `--no-limit`
- **THEN** MUST 查看 `cz-cli task list --help`
- **AND** 不得假设共享输出层提供通用 limit/truncate

### Requirement: task list 和 folder 查询

本需求 MUST 按以下场景执行。

系统 MUST 支持按名称、类型、状态、folder、owner 等条件列出任务，并支持 folder-tree 辅助创建。

#### Scenario: 搜索任务

- **WHEN** 用户执行 `cz-cli task list --name daily --limit 50`
- **THEN** 系统返回匹配任务列表
- **AND** 输出字段使用 task_name、task_id、folder_path 等用户友好名称

#### Scenario: folder 不存在

- **WHEN** 用户按不存在的 folder 过滤或创建任务
- **THEN** CLI 返回 `FOLDER_NOT_FOUND` 或等价错误
- **AND** 提示 `cz-cli task list-folders` 或 `cz-cli task folder-tree`

### Requirement: task create 支持 folder 名称或 ID

本需求 MUST 按以下场景执行。

`task create --folder` MUST 支持整数 folder ID 或 folder name，并在需要时解析名称。

#### Scenario: 使用 folder 名称

- **WHEN** 用户执行 `cz-cli task create my_task --folder my_folder --type PYTHON`
- **THEN** 系统查询 folder 列表并解析名称为 folder ID
- **AND** 在解析出的 folder 下创建任务

#### Scenario: 名称跨页解析

- **WHEN** 目标 folder 不在第一页
- **THEN** 系统分页查询直到找到或耗尽
- **AND** 耗尽后返回 folder not found

### Requirement: task content 返回草稿态内容和配置

本需求 MUST 按以下场景执行。

`task content <task>` MUST 返回任务脚本内容与草稿态配置。

#### Scenario: 按 ID 或名称查询

- **WHEN** 用户执行 `cz-cli task content TASK_NAME_OR_ID`
- **THEN** 系统解析 task 并返回 `task_content` 与 `schedule_config`/等价配置字段
- **AND** `ai_message` SHOULD 说明这是草稿态数据，调度态数据使用 `cz-cli runs detail` 或 `task schedule-info`

#### Scenario: 旧 detail alias

- **WHEN** 用户执行 `cz-cli task detail TASK_NAME_OR_ID`
- **THEN** 系统执行与 `task content` 等价的逻辑
- **AND** MAY 输出迁移提示，建议改用 `task content`

### Requirement: task save-content 是保存脚本内容的规范命令

本需求 MUST 按以下场景执行。

`task save-content <task>` MUST 接受 inline content 或 file input，且两者互斥。

#### Scenario: 保存 inline content

- **WHEN** 用户执行 `cz-cli task save-content TASK --content "SELECT 1"`
- **THEN** 系统按原文保存到任务草稿
- **AND** 不对内容做意外 trim 或模板替换

#### Scenario: 保存文件内容

- **WHEN** 用户执行 `cz-cli task save-content TASK -f script.py`
- **THEN** 系统读取文件并保存其内容
- **AND** 文件不存在时返回可诊断错误

#### Scenario: 输入不唯一

- **WHEN** 用户同时提供 `--content` 和 `-f`，或二者都不提供
- **THEN** CLI 返回 `INVALID_ARGUMENTS` 或 usage error
- **AND** 不调用保存 API

### Requirement: task deps 查询草稿态依赖

本需求 MUST 按以下场景执行。

`task deps <task>` MUST 查询草稿态上游/下游依赖图。

#### Scenario: 默认深度

- **WHEN** 用户执行 `cz-cli task deps TASK`
- **THEN** 系统查询 parent_level=1 与 child_level=1 的依赖关系
- **AND** 返回 parent_tasks 与 child_tasks 或等价字段

#### Scenario: 自定义深度

- **WHEN** 用户执行 `cz-cli task deps TASK --parent-level 2 --child-level 3`
- **THEN** 系统按指定深度查询
- **AND** 非法深度返回 usage/business error

### Requirement: deploy/undeploy/start/stop 明确风险

本需求 MUST 按以下场景执行。

任务上线、下线、启动和停止命令 MUST 在 help 与输出中体现风险和确认策略。

#### Scenario: deploy 成功

- **WHEN** 用户执行 `cz-cli task deploy TASK -y`
- **THEN** 系统发布任务
- **AND** 返回发布版本或状态信息

#### Scenario: undeploy 需要确认

- **WHEN** 用户执行 `cz-cli task undeploy TASK` 且未提供 `-y`
- **THEN** CLI 在 TTY 中要求确认，非 TTY 中返回需要确认的错误
- **AND** 错误说明下线会清理 run instances 或其它不可逆影响

### Requirement: task execute 支持 ad-hoc 执行

本需求 MUST 按以下场景执行。

`task execute <task>` MUST 支持覆盖内容、参数、VC、schema、datasource/database 与等待策略。

#### Scenario: 执行并等待

- **WHEN** 用户执行 `cz-cli task execute TASK --param ds=2026-01-01 --max-wait-seconds 600`
- **THEN** 系统提交 ad-hoc 执行并轮询结果
- **AND** 返回 run/job 标识和最终状态

#### Scenario: 等待超时

- **WHEN** 执行未在 `--max-wait-seconds` 内完成
- **THEN** CLI 返回 timeout 语义
- **AND** `ai_message` SHOULD 提供后续查询 run/job 的命令
