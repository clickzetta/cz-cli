# help-coverage 规格说明

## Purpose

迁移旧 Python 版本的 help coverage matrix。当前仓库不保存静态 59/59 旧矩阵；覆盖对象 MUST 来自当前 `cz-cli --help` 和各子命令 `--help` 的实际输出。

## Requirements

### Requirement: 当前命令树 help 覆盖必须可验证

本需求 MUST 按以下场景执行。

每个公开顶层命令和非隐藏子命令 MUST 有可执行的 `--help` 输出，且输出中的 usage、positionals、options、choices、examples 与实际 yargs 定义一致。

#### Scenario: 顶层命令可发现

- **WHEN** 维护者或 agent 执行 `cz-cli --help`
- **THEN** 输出列出当前公开顶层命令，例如 `sql`、`schema`、`table`、`workspace`、`status`、`profile`、`task`、`runs`、`attempts`、`agent`、`job`、`setup`、`update`、`datasource`、`ai-gateway`、`analytics-agent`
- **AND** 每个公开命令都能继续执行 `cz-cli <command> --help`

#### Scenario: 子命令 help 不需要 profile

- **WHEN** 用户执行需要 Lakehouse 的命令 help，例如 `cz-cli task save-content --help`
- **THEN** CLI 输出 help 而不要求 ClickZetta profile
- **AND** help 请求不触发远端 API 调用

### Requirement: 旧 Python 矩阵必须按当前命令面重映射

本需求 MUST 按以下场景执行。

迁移旧矩阵时 MUST 将废弃或改名命令映射到当前命令，不能把旧命令作为新仓库承诺。

#### Scenario: ai-guide 被 skill/help 文档替代

- **WHEN** 旧矩阵包含 `cz-cli ai-guide`
- **THEN** 当前规格将其映射到捆绑/外部 skill 文档、`cz-cli <command> --help` 或内部 guide 生成能力
- **AND** 不把 `cz-cli ai-guide` 作为当前公开命令

#### Scenario: executions 被 runs/attempts/job 替代

- **WHEN** 旧矩阵包含 `executions list/log/stop`
- **THEN** 当前规格以 `runs`、`attempts` 或 `job` 命令族承接等价查询、attempt 日志和控制能力
- **AND** 文档 MUST 以当前 help 为准

### Requirement: help 覆盖检查必须排除隐藏兼容别名

本需求 MUST 按以下场景执行。

隐藏别名可以继续工作以兼容脚本，但 help coverage 不应要求它们作为公开命令展示。

#### Scenario: 兼容别名可执行但不公开

- **WHEN** `task detail`、`task save` 或 `runs log` 作为兼容 alias 存在
- **THEN** help coverage MAY 记录它们的兼容语义
- **AND** 公开文档 SHOULD 推荐 `task content`、`task save-content`、`runs logs`

#### Scenario: alias 被移除

- **WHEN** 后续版本移除隐藏兼容 alias
- **THEN** help coverage 不应失败，只要公开规范命令仍可发现
- **AND** 迁移提示或 release note SHOULD 说明破坏性变化

### Requirement: workspace-param help 覆盖必须可验证

本需求 MUST 按以下场景执行。

`workspace-param` 命令族 SHALL be covered by executable help tests, and help rendering SHALL NOT require a ClickZetta profile or remote Studio API call.

#### Scenario: workspace-param 子命令 help 全覆盖

- **WHEN** 维护者运行 help coverage 测试
- **THEN** 测试 SHALL execute `cz-cli workspace-param --help`
- **AND** 测试 SHALL execute `cz-cli workspace-param list --help`
- **AND** 测试 SHALL execute `cz-cli workspace-param add --help`
- **AND** 测试 SHALL execute `cz-cli workspace-param update --help`
- **AND** 测试 SHALL execute `cz-cli workspace-param enable --help`
- **AND** 测试 SHALL execute `cz-cli workspace-param disable --help`
- **AND** 测试 SHALL execute `cz-cli workspace-param delete --help`

#### Scenario: help 不访问 profile

- **WHEN** 用户执行任意 `workspace-param` help 命令
- **THEN** CLI SHALL render help without requiring an active profile
- **AND** CLI SHALL NOT call Studio APIs while rendering help

#### Scenario: help 暴露必需参数

- **WHEN** 用户查看 `workspace-param update --help`
- **THEN** 帮助信息 SHALL include `--project-id`、`--id`、`--key`、`--value`、`--source-type` 和 `--encrypt`
- **WHEN** 用户查看 `workspace-param enable --help`、`disable --help` 或 `delete --help`
- **THEN** 帮助信息 SHALL include `--project-id` 和 `--id`

### Requirement: profile login-url help 覆盖必须可验证

本需求 MUST 按以下场景执行。

`profile login-url` 命令的 help MUST be covered by executable help tests, and help rendering MUST NOT require a ClickZetta profile or remote API call.

#### Scenario: profile login-url help 被覆盖

- **WHEN** 维护者运行 help coverage 测试
- **THEN** 测试 MUST execute `cz-cli profile --help`
- **AND** 测试 MUST execute `cz-cli profile login-url --help`

#### Scenario: help 不访问 profile 和远端

- **WHEN** 用户执行 `cz-cli profile login-url --help`
- **THEN** CLI MUST render help without requiring an active profile
- **AND** CLI MUST NOT call ClickZetta APIs while rendering help

#### Scenario: help 暴露关键参数

- **WHEN** 用户查看 `cz-cli profile login-url --help`
- **THEN** 帮助信息 MUST include the optional profile name positional argument
- **AND** 帮助信息 MUST include `--tenant-name`
- **AND** 帮助信息 MUST include `--resolve`
- **AND** 帮助信息 MUST include `--no-resolve`
- **AND** 帮助信息 MUST include `--open`
