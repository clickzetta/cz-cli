# profile-management 规格说明

## Purpose
定义 `cz-cli profile` 命令族和 `~/.clickzetta/profiles.toml` 的行为。旧 Python 规格迁移为当前 yargs 命令：`list/detail/create/update/delete/use/status/quickstart/discover/list-workspaces/render-command`。

## Requirements
### Requirement: profile 创建支持互斥认证模式

本需求 MUST 按以下场景执行。

`profile create` MUST 支持 PAT 或 username/password 两种认证模式，并拒绝冲突或缺失认证。

#### Scenario: 使用 PAT 创建

- **WHEN** 用户执行 `cz-cli profile create dev --pat <token> --service <url> --instance <i> --workspace <w>`
- **THEN** CLI 写入 `[profiles.dev]`，包含 PAT 与连接字段
- **AND** 不写入 username/password

#### Scenario: 同时提供 PAT 和用户名密码

- **WHEN** 用户在 create 中同时提供 `--pat` 和 `--username/--password`
- **THEN** CLI 返回 usage error
- **AND** 错误说明认证模式互斥

#### Scenario: 缺少认证

- **WHEN** 用户创建 profile 但没有 PAT 或完整 username/password
- **THEN** CLI 返回缺失认证参数错误
- **AND** 不写入部分 profile

### Requirement: profile 创建支持协议与连接验证控制

本需求 MUST 按以下场景执行。

profile 创建 SHOULD 支持 protocol、service、instance、workspace、schema、vcluster 等连接字段，并可按命令帮助控制是否验证连接。

#### Scenario: 指定协议

- **WHEN** 用户执行 `cz-cli profile create dev --protocol http ...`
- **THEN** profile 保存 `protocol = "http"`
- **AND** 后续连接使用该协议，除非被 CLI 覆盖

#### Scenario: 连接验证失败

- **WHEN** 默认创建流程需要验证连接且远端不可达
- **THEN** CLI 返回连接验证错误
- **AND** 不应保存一个看似成功但不可用的 profile，除非命令明确支持跳过验证

### Requirement: profile 列表和详情保护敏感字段

本需求 MUST 按以下场景执行。

`profile list` MUST 适合日常展示，`profile detail` 可展示完整配置但仍应遮蔽敏感值。

#### Scenario: 列出 profiles

- **WHEN** 用户执行 `cz-cli profile list --format json`
- **THEN** CLI 返回 profile 名称、默认标记和非敏感连接摘要
- **AND** PAT、password、header secret 等敏感值必须被遮蔽

#### Scenario: 未显式指定格式时默认表格展示

- **WHEN** 用户执行 `cz-cli profile list` 且未传 `--format`
- **THEN** CLI 默认以 `table` 格式输出，便于人工阅读
- **AND** 用户显式指定 `--format json`（或其他格式）时，仍以指定格式输出，不受默认值影响


#### Scenario: 没有 profiles

- **WHEN** profiles 文件不存在或不包含任何 profile
- **THEN** CLI 返回空列表或明确 onboarding 指导
- **AND** 不抛出未处理文件错误

### Requirement: 默认 profile 可选择

本需求 MUST 按以下场景执行。

`profile use` MUST 设置 `default_profile`，运行时未显式指定 `--profile` 时使用默认 profile。

#### Scenario: 设置默认 profile

- **WHEN** 用户执行 `cz-cli profile use dev`
- **THEN** `profiles.toml` 中 `default_profile` 更新为 `dev`
- **AND** 后续 `cz-cli sql "SELECT 1"` 默认使用 dev

#### Scenario: 设置不存在的 profile

- **WHEN** 用户执行 `cz-cli profile use missing`
- **THEN** CLI 返回 profile not found 错误
- **AND** 不修改现有默认值

### Requirement: profile update 只允许白名单字段

本需求 MUST 按以下场景执行。

`profile update <name> <key> <value>` MUST 只允许已声明字段，并在认证模式切换时清理冲突字段。

#### Scenario: 更新 PAT

- **WHEN** 用户执行 `cz-cli profile update dev pat <token>`
- **THEN** profile 保存新 PAT
- **AND** 清除 username/password，避免认证模式冲突

#### Scenario: 无效字段

- **WHEN** 用户执行 `cz-cli profile update dev unknown value`
- **THEN** CLI 返回 usage error
- **AND** help 中列出有效 key

### Requirement: profile 删除安全可诊断

本需求 MUST 按以下场景执行。

`profile delete` MUST 删除指定 profile，并处理默认 profile 指向。

#### Scenario: 删除 profile

- **WHEN** 用户执行 `cz-cli profile delete dev`
- **THEN** `[profiles.dev]` 被删除
- **AND** 若 dev 是默认 profile，默认值被清除或迁移到明确策略

#### Scenario: 删除不存在 profile

- **WHEN** 用户执行 `cz-cli profile delete missing`
- **THEN** CLI 返回 profile not found
- **AND** profiles 文件不被改写

### Requirement: custom headers 可配置

本需求 MUST 按以下场景执行。

profile MUST 支持 `header.<NAME>` 字段，用于向 Studio/API 请求添加自定义 HTTP header。

#### Scenario: 写入 header

- **WHEN** 用户执行 `cz-cli profile update dev header.X-Org abc`
- **THEN** profile 保存该 header
- **AND** 后续 Studio/API 请求携带它

#### Scenario: 敏感 header 展示

- **WHEN** profile list/detail 输出包含 header 字段
- **THEN** 可能包含 secret 的值 SHOULD 被遮蔽
- **AND** raw/debug 明确请求除外
