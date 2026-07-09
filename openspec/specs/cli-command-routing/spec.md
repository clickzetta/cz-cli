# cli-command-routing 规格说明

## Purpose
定义 cz-cli 顶层命令如何在 ClickZetta 数据命令、本地管理命令和 opencode agent 运行时之间路由，确保公开命令面与实际二进制行为一致。

## Requirements

### Requirement: 顶层 serve 命令透出 opencode agent server

本需求 MUST 按以下场景执行。

`cz-cli serve` MUST 作为顶层命令透出 opencode 的 headless agent server 能力，并保留 opencode serve 命令的参数语义。该命令属于 agent 运行时命令，MUST 由真实 cz-cli 二进制执行，不应通过 `execute()` 的进程内 API 执行。

#### Scenario: 查看 serve 帮助

- **WHEN** 用户执行 `cz-cli serve --help`
- **THEN** 命令展示 serve 的帮助信息
- **且** 帮助信息包含 headless agent server 的说明
- **且** 不要求 ClickZetta profile 或 active LLM

#### Scenario: programmatic execute 拒绝 serve

- **WHEN** 调用方通过 `execute("serve --help")` 或 `execute("serve")` 运行 serve 命令时
- **THEN** 返回 `UNSUPPORTED_PROGRAMMATIC_AGENT_RUNTIME`
- **且** 提示调用方使用真实 cz-cli 二进制

### Requirement: 顶层 autoupdate 命令归属本地管理

本需求 MUST 按以下场景执行。

`cz-cli autoupdate` MUST 作为顶层本地管理命令注册，用于查看或设置自动更新开关。该命令不属于 ClickZetta profile/连接配置命令，也不属于 agent runtime 命令。CLI MUST NOT 注册 `auto-update` 作为别名，避免命令面和自动更新内部术语混淆。

#### Scenario: autoupdate 顶层可发现

- **WHEN** 用户执行 `cz-cli autoupdate --help`
- **THEN** 帮助信息展示自动更新开关命令
- **AND** 帮助信息包含 `true`、`false`、`notify`

#### Scenario: auto-update 不作为别名

- **WHEN** 用户执行 `cz-cli auto-update --help`
- **THEN** CLI 不将其路由到 `autoupdate`

### Requirement: AIGW model list 默认限制并提示 AI agent

本需求 MUST 按以下场景执行。

`cz-cli ai-gateway model list` MUST 默认只请求并返回 10 个模型，MUST 支持 `--limit <n>` 调整上限，MUST 支持 `--no-limit` 取消默认 10 个限制并使用分页参数请求。命令输出被限制且服务端返回总数大于当前结果数时，MUST 在 `ai_message` 中提示当前展示数量、总数，以及可使用 `--limit` 或 `--no-limit` 调整。

#### Scenario: 默认只请求 10 个模型

- **WHEN** 用户执行 `cz-cli ai-gateway model list <key-or-alias>`
- **THEN** 请求 AIGW model list API 时使用 `pageSize=10`
- **且** 若服务端返回总数大于 10，则响应包含 `ai_message` 提示默认限制和调整方式

#### Scenario: 使用 limit 或 no-limit 调整模型数量

- **WHEN** 用户执行 `cz-cli ai-gateway model list <key-or-alias> --limit 3`
- **THEN** 请求 AIGW model list API 时使用 `pageSize=3`
- **WHEN** 用户执行 `cz-cli ai-gateway model list <key-or-alias> --no-limit`
- **THEN** 命令不使用默认 10 个模型限制
- **且** 请求 AIGW model list API 时使用显式 `--page-size` 或命令的宽分页默认值

### Requirement: Agent 指令壳只指向 OpenSpec 配置

本需求 MUST 按以下场景执行。

仓库根目录 `AGENTS.md` MUST 作为轻量入口，只说明规范与契约来源是 `openspec/config.yaml`，不应复制长期契约内容。AI agent 需要理解命令参数、输出结构或开发流程时，MUST 读取 `openspec/config.yaml`。

#### Scenario: Agent 读取根目录指令

- **WHEN** AI agent 读取仓库根目录 `AGENTS.md`
- **THEN** 文档只指向 `openspec/config.yaml`
- **且** 不复制完整开发流程、样式、验证或输出契约

#### Scenario: Agent 查找命令参数和 ai_message 契约

- **WHEN** AI agent 需要了解命令参数、通用 `--help` 发现方式或结构化输出字段
- **THEN** `openspec/config.yaml` 描述使用 `cz-cli <command> --help` 获取参数契约
- **且** `openspec/config.yaml` 描述 `ai_message` 是面向 agent 的操作提示字段

### Requirement: limit 和 truncate 是命令级参数

本需求 MUST 按以下场景执行。

`--limit`、`--no-limit`、`--truncate`、`--no-truncate` MUST be treated as command-specific options, not global options. The generic output layer MUST NOT apply row limits or field truncation unless the invoked command explicitly implements and documents that behavior.

#### Scenario: 通过 help 判断命令是否支持限制或截断

- **WHEN** 用户或 AI agent 需要判断某个命令是否支持结果数量限制或字段截断
- **THEN** MUST inspect that command's own `--help`
- **且** 只有帮助信息列出 `--limit`、`--no-limit`、`--truncate` 或 `--no-truncate` 时，调用方才应认为该命令支持对应参数

#### Scenario: 命令未声明限制或截断参数

- **WHEN** 命令帮助未声明 `--limit`、`--no-limit`、`--truncate` 或 `--no-truncate`
- **THEN** CLI MUST NOT silently apply a generic global row limit or field truncation through the shared output formatter
- **且** 若该命令需要限制或截断行为，MUST 在该命令自身实现并在帮助信息中声明

### Requirement: 分组命令缺子命令时返回帮助而非报错

本需求 MUST 按以下场景执行。

当用户调用一个"分组命令"（即本身没有可执行动作、只承载子命令的命令，如 `cz-cli ai-gateway`、`cz-cli ai-gateway key`、`cz-cli task`、`cz-cli task flow`、`cz-cli analytics-agent domain`、`cz-cli agent llm`）却未提供子命令时，CLI MUST 输出该分组的帮助信息（等同 `--help`）并以退出码 0 结束，而不是返回 `USAGE_ERROR`。此行为仅适用于缺少子命令的分组命令；不适用于叶子命令缺少必填位置参数或选项的情形。

分组命令缺子命令 MUST NOT 要求已配置 ClickZetta profile 或 active LLM —— 帮助信息 MUST 在无任何 profile/LLM 的机器上照常输出，不得被 `NO_PROFILE` 或 `NO_ACTIVE_LLM` 掩盖。

#### Scenario: 顶层分组命令缺子命令返回帮助

- **WHEN** 用户执行 `cz-cli ai-gateway`（无子命令）
- **THEN** CLI MUST 输出 `cz-cli ai-gateway` 的帮助信息，包含其子命令（`key`、`model`）
- **且** 退出码 MUST 为 0
- **且** 输出 MUST NOT 包含 `USAGE_ERROR`

#### Scenario: 嵌套分组命令缺子命令返回帮助

- **WHEN** 用户执行 `cz-cli ai-gateway key`（无子命令）
- **THEN** CLI MUST 输出 `cz-cli ai-gateway key` 的帮助信息（而非父级 `ai-gateway` 的帮助）
- **且** 退出码 MUST 为 0

#### Scenario: profile-gated 分组命令缺子命令不要求 profile

- **WHEN** 用户在未配置 profile 的机器上执行 `cz-cli task`（无子命令）
- **THEN** CLI MUST 输出 `cz-cli task` 的帮助信息
- **且** 退出码 MUST 为 0
- **且** 输出 MUST NOT 包含 `NO_PROFILE`

#### Scenario: 未知子命令仍然报错

- **WHEN** 用户执行 `cz-cli ai-gateway bogus`（未知子命令）
- **THEN** CLI MUST 返回 `USAGE_ERROR`
- **且** 退出码 MUST 为 2
- **且** 若存在相近子命令，SHOULD 在 `did_you_mean` 中给出建议

#### Scenario: 叶子命令缺必填参数仍然报错

- **WHEN** 用户执行 `cz-cli ai-gateway key get`（缺少必填位置参数 `<ref>`）
- **THEN** CLI MUST 返回 `USAGE_ERROR`
- **且** 退出码 MUST 为 2

### Requirement: task 依赖产出解析命令可发现

本需求 MUST 按以下场景执行。

`cz-cli task lineage` MUST be registered as a `task` subcommand and MUST be discoverable through CLI help.

#### Scenario: 查看 task 帮助

- **WHEN** 用户执行 `cz-cli task --help`
- **THEN** 帮助信息 MUST include `lineage`

#### Scenario: 查看 lineage 帮助

- **WHEN** 用户执行 `cz-cli task lineage --help`
- **THEN** 帮助信息 MUST show the `cz-cli task lineage` command header
- **AND** 帮助信息 MUST include the `task` positional argument and describe it as task name or ID
- **AND** 帮助信息 MUST include `--schema`, `--content`, and `--file` options

### Requirement: workspace-param 顶层命令可路由

本需求 MUST 按以下场景执行。

`cz-cli workspace-param` SHALL be registered as a public top-level command and SHALL route to Studio workspace parameter lifecycle commands.

#### Scenario: 顶层 help 可发现

- **WHEN** 用户执行 `cz-cli --help`
- **THEN** 帮助信息 SHALL include `workspace-param`

#### Scenario: 查看 workspace-param 帮助

- **WHEN** 用户执行 `cz-cli workspace-param --help`
- **THEN** 帮助信息 SHALL show the `cz-cli workspace-param` command header
- **AND** 帮助信息 SHALL include `list`、`add`、`update`、`enable`、`disable` 和 `delete`

#### Scenario: 未知 workspace-param 子命令

- **WHEN** 用户执行 `cz-cli workspace-param unknown`
- **THEN** CLI SHALL return a usage error
- **AND** CLI SHALL provide help guidance for the `workspace-param` command group

### Requirement: profile login-url 命令必须可发现

本需求 MUST 按以下场景执行。

`cz-cli profile login-url` MUST be registered as a `profile` subcommand and MUST be discoverable through CLI help.

#### Scenario: 查看 profile 帮助

- **WHEN** 用户执行 `cz-cli profile --help`
- **THEN** 帮助信息 MUST include `login-url`

#### Scenario: 查看 login-url 帮助

- **WHEN** 用户执行 `cz-cli profile login-url --help`
- **THEN** 帮助信息 MUST show the `cz-cli profile login-url` command header
- **AND** 帮助信息 MUST include the optional profile name positional argument
- **AND** 帮助信息 MUST include `--tenant-name`
- **AND** 帮助信息 MUST include `--resolve`
- **AND** 帮助信息 MUST include `--no-resolve`
- **AND** 帮助信息 MUST include `--open`
