# task-flow-management 规格说明

## Purpose
迁移 Python 版本 flow-management 到当前 `cz-cli task flow` 子命令。当前 flow 操作是 task 命令的一部分，不是顶层 `cz-cli flow`。

## Requirements
### Requirement: flow 命令挂在 task flow 下

本需求 MUST 按以下场景执行。

系统 MUST 通过 `cz-cli task flow` 暴露 flow task 操作。

#### Scenario: 查看 flow help

- **WHEN** 用户执行 `cz-cli task flow --help`
- **THEN** help 展示 `dag`、`create-node`、`remove-node`、`bind`、`unbind`、`node-detail`、`node-save`、`node-save-config`、`submit`、`temp-run`、`instances`
- **AND** `temp-run` 的描述 MUST 明确说明它是 TEMP / ad-hoc 执行，不代表正式调度实例
- **AND** 文档不得推荐已废弃的顶层 `cz-cli flow`

#### Scenario: 未知顶层 flow

- **WHEN** 用户执行 `cz-cli flow list`
- **THEN** CLI 返回 usage error
- **AND** SHOULD 提示使用 `cz-cli task flow --help`

### Requirement: 按节点名称优先的 AI 友好参数

本需求 MUST 按以下场景执行。

flow 子命令 SHOULD 优先支持节点名称，必要时允许 node-id 作为精确 fallback。

#### Scenario: 按名称保存节点脚本

- **WHEN** 用户执行 `cz-cli task flow node-save FLOW_TASK --name transform --content "SELECT 1"`
- **THEN** 系统通过 DAG 解析节点名称
- **AND** 更新对应节点内容

#### Scenario: 名称不唯一或不存在

- **WHEN** 节点名称无法唯一解析
- **THEN** CLI 返回可诊断错误
- **AND** 指导用户使用 `--node-id` 或先查看 DAG

### Requirement: flow DAG 和实例查询可读

本需求 MUST 按以下场景执行。

系统 MUST 支持查询 flow DAG、节点依赖关系和实例状态。

#### Scenario: 查询 DAG

- **WHEN** 用户执行 `cz-cli task flow dag FLOW_TASK`
- **THEN** 输出包含节点列表和依赖边
- **AND** 表格格式下节点与边应易于扫描

#### Scenario: 查询节点实例

- **WHEN** 用户执行 `cz-cli task flow instances FLOW_TASK --instance 123 --node-id 456`
- **THEN** 系统返回该节点实例状态、日志/错误摘要或可继续查询的信息
- **AND** 不存在实例时返回 not found

### Requirement: flow 配置保存保持父任务上下文

本需求 MUST 按以下场景执行。

flow 节点内容、cron、VC、schema 与参数配置 MUST 以父 flow task 为上下文，并使用当前 help 暴露的 `node-save`、`node-save-config`、`submit`、`temp-run` 命令。

#### Scenario: 保存节点 cron

- **WHEN** 用户执行 `cz-cli task flow node-save-config FLOW_TASK --name transform --cron '0 0 * * * ? *'`
- **THEN** 系统保存该节点调度配置
- **AND** 不覆盖父 flow 任务其它节点配置

#### Scenario: 参数来源区分

- **WHEN** 用户执行 `cz-cli task flow node-save FLOW_TASK --name transform --param ds=2026-01-01 --flow-param tenant`
- **THEN** 系统区分手动默认值与继承父 flow 的参数
- **AND** 非法格式返回 usage error

#### Scenario: 提交流程调度

- **WHEN** 用户执行 `cz-cli task flow submit FLOW_TASK --cron '0 0 * * * ? *' --vc DEFAULT`
- **THEN** 系统保存父 flow 调度配置并提交/发布 flow
- **AND** 缺失或非法 cron 时返回可诊断错误

#### Scenario: 提交 draft flow 时走 flow 发布接口

- **WHEN** 用户执行 `cz-cli task flow submit FLOW_TASK` 且该任务是已配置节点的 draft flow
- **THEN** CLI MUST 使用 flow 发布接口语义提交 `fileId`
- **AND** MUST NOT 误走通用 task 发布接口导致 `文件参数不匹配`

#### Scenario: 提交 flow 前先检查 workspace 参数

- **WHEN** 用户执行 `cz-cli task flow submit FLOW_TASK`
- **THEN** CLI MUST 在真正提交前调用 workspace 参数预检查
- **AND** 若存在未发布、已停用或不存在的项目参数，CLI MUST 返回可诊断错误且不调用 flow 发布接口

#### Scenario: flow 提交后轮询异步提交状态

- **WHEN** flow 发布接口返回 `submitTraceId`
- **THEN** CLI MUST 轮询 flow 提交状态直到成功、失败或超时
- **AND** 当状态为失败时，CLI MUST 返回业务错误而不是误报提交成功

#### Scenario: 临时执行流程

- **WHEN** 用户执行 `cz-cli task flow temp-run FLOW_TASK --vc DEFAULT --param ds=2026-01-01`
- **THEN** 系统发起一次 ad-hoc / TEMP flow 执行
- **AND** 返回 flow instance 或后续查询所需 ID
- **AND** help 与成功提示 MUST 明确说明该命令不会生成正式调度实例，也不能代表调度重试语义

#### Scenario: 旧的 run 命令不再暴露

- **WHEN** 用户查看 `cz-cli task flow --help`
- **THEN** help MUST 只暴露 `temp-run`，不再暴露 `run`
- **AND** 文档与帮助文本 MUST 把 `temp-run` 明确描述为临时调试入口，而不是正式调度验证入口

#### Scenario: 提交流程后的验证指引

- **WHEN** 用户执行 `cz-cli task flow submit FLOW_TASK`
- **THEN** CLI 的 help 与成功提示 MUST 引导用户使用 `cz-cli runs list --task FLOW_TASK --run-type SCHEDULE`
- **AND** MUST 说明调度重试应通过正式 `SCHEDULE` 实例与 `attempts list` 验证
