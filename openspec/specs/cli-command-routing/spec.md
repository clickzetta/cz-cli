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
