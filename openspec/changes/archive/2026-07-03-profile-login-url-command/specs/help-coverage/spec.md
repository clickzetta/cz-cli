## ADDED Requirements

### Requirement: profile login-url help 覆盖必须可验证
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
