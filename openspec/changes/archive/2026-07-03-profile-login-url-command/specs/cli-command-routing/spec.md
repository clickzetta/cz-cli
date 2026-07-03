## ADDED Requirements

### Requirement: profile login-url 命令必须可发现
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
