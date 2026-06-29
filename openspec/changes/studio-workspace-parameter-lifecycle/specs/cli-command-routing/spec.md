## ADDED Requirements

### Requirement: workspace-param 顶层命令可路由
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
