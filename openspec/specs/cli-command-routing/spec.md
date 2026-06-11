# cli-command-routing 规格说明

## Purpose
定义 cz-cli 顶层命令如何在 ClickZetta 数据命令、本地管理命令和 opencode agent 运行时之间路由，确保公开命令面与实际二进制行为一致。

## Requirements

### Requirement: 顶层 serve 命令透出 opencode agent server

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

### Requirement: AIGW model list 默认限制并提示 AI agent

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

仓库根目录 `AGENTS.md` MUST 作为轻量入口，只说明规范与契约来源是 `openspec/config.yaml`，不应复制长期契约内容。AI agent 需要理解命令参数、输出结构或开发流程时，MUST 读取 `openspec/config.yaml`。

#### Scenario: Agent 读取根目录指令

- **WHEN** AI agent 读取仓库根目录 `AGENTS.md`
- **THEN** 文档只指向 `openspec/config.yaml`
- **且** 不复制完整开发流程、样式、验证或输出契约

#### Scenario: Agent 查找命令参数和 ai_message 契约

- **WHEN** AI agent 需要了解命令参数、通用 `--help` 发现方式或结构化输出字段
- **THEN** `openspec/config.yaml` 描述使用 `cz-cli <command> --help` 获取参数契约
- **且** `openspec/config.yaml` 描述 `ai_message` 是面向 agent 的操作提示字段
