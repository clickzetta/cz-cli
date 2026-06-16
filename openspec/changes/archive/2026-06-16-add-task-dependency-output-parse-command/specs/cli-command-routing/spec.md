## ADDED Requirements

### Requirement: task 依赖产出解析命令可发现
`cz-cli task lineage` MUST be registered as a `task` subcommand and MUST be discoverable through CLI help.

#### Scenario: 查看 task 帮助
- **WHEN** 用户执行 `cz-cli task --help`
- **THEN** 帮助信息 MUST include `lineage`

#### Scenario: 查看 lineage 帮助
- **WHEN** 用户执行 `cz-cli task lineage --help`
- **THEN** 帮助信息 MUST show the `cz-cli task lineage` command header
- **AND** 帮助信息 MUST include the `task` positional argument and describe it as task name or ID
- **AND** 帮助信息 MUST include `--schema`, `--content`, and `--file` options
