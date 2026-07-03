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

CLI task 类型、状态、调度频率等 Studio 后端契约 MUST 通过集中枚举或常量模块表达，不得在命令实现中重复散落数字魔法值。

#### Scenario: 使用 folder 名称

- **WHEN** 用户执行 `cz-cli task create my_task --folder my_folder --type PYTHON`
- **THEN** 系统查询 folder 列表并解析名称为 folder ID
- **AND** 在解析出的 folder 下创建任务

#### Scenario: 创建条件任务

- **WHEN** 用户执行 `cz-cli task create condition_task --folder 389001 --type CONDITION`
- **THEN** 系统 MUST 调用 Studio 创建任务接口并传入 `fileType=19`
- **AND** `task create --help` MUST 将 `CONDITION` 作为可发现的任务类型展示

#### Scenario: 创建归并任务

- **WHEN** 用户执行 `cz-cli task create merge_task --folder 389001 --type MERGE`
- **THEN** 系统 MUST 调用 Studio 创建任务接口并传入 `fileType=20`
- **AND** `task create --help` MUST 将 `MERGE` 作为可发现的任务类型展示

#### Scenario: 保存独立条件任务配置

- **WHEN** 条件任务内容包含 `conditionConfig.branches[].outputName` 和可选 `defaultOutputName`
- **THEN** `task save-config` 和 `task save-cron` MUST 将这些分支保存为 `dataFileOutputListReqs`
- **AND** 每个输出 MUST 使用 `parseType=2`、当前 task ID 和分支名称，保证后续依赖可以引用条件分支

#### Scenario: 保存组合任务中的条件节点配置

- **WHEN** 用户对组合任务中的 `CONDITION` 节点执行 `task flow node-save-config`
- **THEN** 系统 MUST 从节点 `conditionConfig` 生成分支输出并传入 `dataFileOutputListReqs`
- **AND** 输出的 `fileShowName` MUST 使用 `workspace.flow.node` 形态

#### Scenario: 绑定条件分支到下游节点

- **WHEN** 用户执行 `cz-cli task flow bind flow --upstream condition_node --downstream succ_node --branch branch_success`
- **THEN** 系统 MUST 校验 `branch_success` 存在于上游条件节点
- **AND** 系统 MUST 在下游节点配置中保存包含 `refTableNames=branch_success` 和对应 `sequence` 的依赖 DTO

#### Scenario: 发布组合任务时刷新子节点内容配置

- **WHEN** 用户执行 `cz-cli task flow submit flow --vc FLOW_VC`
- **THEN** 系统 MUST 先保存父组合任务调度配置
- **AND** 系统 MUST 遍历组合任务 DAG 中的每个子节点，按节点自己的 VC/schema 配置重新保存节点内容
- **AND** 若节点未配置独立 VC/schema，系统 SHOULD 回退使用父组合任务的 VC/schema

#### Scenario: 保存每周指定天调度

- **WHEN** 用户执行 `cz-cli task save-cron task --cron "0 00 07 ? * MON-FRI *"` 或 `cz-cli task flow node-save-config flow --node-id node --cron "0 00 07 ? * MON-FRI *"`
- **THEN** 系统 MUST 将周一到周五转换为 Studio 周调度值 `1,2,3,4,5`
- **AND** 保存 payload MUST 包含 `schedule=[["weekly","1"],...,["weekly","5"]]`、`frequency="1"` 和顶层 `scheduleStartTime`
- **AND** `cronExpress` MUST 保存为 `0 00 07 ? * 1,2,3,4,5 *`

#### Scenario: 保留已有 Studio 调度 UI 字段

- **WHEN** 用户执行 `cz-cli task save-config task --retry-count 2` 这类非 cron 配置更新
- **THEN** 系统 MUST 保留后端已有的 `schedule`、`frequency`、`scheduleStartTime`、`scheduleEndTime`、`isScheduleRateTypeOff` 和 `useActiveEndTime`
- **AND** 不得因为保存重试、VC、依赖或产出表配置而丢失每周指定天调度定义

#### Scenario: 保存归并任务规则和调度依赖

- **WHEN** 用户执行 `cz-cli task save-merge merge_task --dependency upstream --status SUCCESS --status FAILED --status SKIPPED`
- **THEN** 系统 MUST 保存任务内容为 `{"mergeRule":{"logic":"AND","conditions":[{"dependencyId":<upstream_id>,"statusIn":["SUCCESS","FAILED","SKIPPED"]}]},"finalStatus":"SUCCESS"}`
- **AND** 系统 MUST 将上游任务作为调度依赖保存到 `dataFileInputListReqs`
- **AND** `SKIPPED` 状态 MUST 在 help 中说明仅适用于匹配 if/condition 节点的上游结果

#### Scenario: 归并任务参数校验

- **WHEN** 用户执行 `cz-cli task save-merge merge_task --dependency upstream --status UNKNOWN`
- **THEN** CLI MUST 返回 `INVALID_ARGUMENTS`
- **AND** 不调用保存内容或保存配置接口

#### Scenario: 发布未配置的归并任务

- **WHEN** 用户创建 `MERGE` 任务后未执行 `cz-cli task save-merge` 就执行 `cz-cli task deploy merge_task -y`
- **THEN** CLI MUST 返回 `NO_MERGE_CONFIG`
- **AND** 不调用发布接口

#### Scenario: 复用 Studio task 契约枚举

- **WHEN** 命令实现需要判断 SQL、Python、Flow、同步任务、运行状态或调度频率等 Studio 枚举
- **THEN** 系统 MUST 从集中契约模块读取命名常量或映射
- **AND** 不得在命令处理逻辑中直接重复使用对应整数魔法值

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
