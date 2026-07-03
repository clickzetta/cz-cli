# workspace-management 规格说明

## Purpose
定义 Lakehouse workspace 命令族。注意这里是 ClickZetta Lakehouse 工作空间，不是 opencode 控制平面的代码 workspace。

## Requirements
### Requirement: Workspace 命令 help 签名稳定

本需求 MUST 按以下场景执行。

`workspace` 命令族 MUST 通过 help 暴露当前子命令。

#### Scenario: workspace group help

- **WHEN** 用户执行 `cz-cli workspace --help`
- **THEN** help 显示 `list`、`use <name>`
- **AND** `use` 说明可用 `--persist` 保存到 profile（若 help 声明）

#### Scenario: 未知子命令

- **WHEN** 用户执行 `cz-cli workspace delete foo`
- **THEN** CLI 返回 usage error
- **AND** 提示查看 workspace help

### Requirement: 列出可用 workspaces

本需求 MUST 按以下场景执行。

系统 SHOULD 支持列出当前账号/region 可用 workspace。

#### Scenario: list 成功

- **WHEN** 用户执行 `cz-cli workspace list --format json`
- **THEN** 系统返回 workspace 列表
- **AND** 每个条目包含可展示名称或标识符

#### Scenario: 远端不可达

- **WHEN** 列表 API 失败
- **THEN** CLI 返回业务错误
- **AND** 错误中包含连接/profile 诊断线索

### Requirement: workspace 不再提供 current 子命令

本需求 MUST 按以下场景执行。

系统 MUST 不再暴露 `workspace current` 子命令，避免用户依赖已删除的命令入口。

#### Scenario: help 不显示 current

- **WHEN** 用户执行 `cz-cli workspace --help`
- **THEN** help 中不显示 `current`
- **AND** 用户可见子命令只包含 `list`、`use <name>`

#### Scenario: 调用已删除的 current 子命令

- **WHEN** 用户执行 `cz-cli workspace current`
- **THEN** CLI 返回 usage error
- **AND** 提示查看 `cz-cli workspace --help`

### Requirement: 切换 workspace 可选择持久化

本需求 MUST 按以下场景执行。

`workspace use <name>` MUST 支持只返回本次会话使用提示，也可通过 `--persist` 写回 profile。

#### Scenario: 不持久化

- **WHEN** 用户执行 `cz-cli workspace use myworkspace`
- **THEN** 系统返回切换当前命令或 SDK hint 的指导
- **AND** 不修改 `profiles.toml`

#### Scenario: 持久化

- **WHEN** 用户执行 `cz-cli workspace use myworkspace --schema public --persist`
- **THEN** 系统更新当前或指定 profile 的 workspace/schema
- **AND** 后续命令默认使用新 workspace
