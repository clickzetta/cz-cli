## ADDED Requirements

### Requirement: workspace-param help 覆盖必须可验证
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
