# connection-management 规格说明

## Purpose
定义 cz-cli 如何解析 ClickZetta 连接配置。来源包括 profile、环境变量、JDBC URL 与 CLI 覆盖参数。当前实现位于 `packages/cz-cli/src/connection`、`clickzetta-profile-option.ts` 和命令注册层。

## Requirements
### Requirement: 多来源连接解析

本需求 MUST 按以下场景执行。

系统 MUST 从 profile、环境变量、JDBC URL 和 CLI 参数解析连接配置，并形成单一运行时连接上下文。

#### Scenario: 使用 profile

- **WHEN** 用户执行 `cz-cli --profile myprofile sql "SELECT 1"`
- **THEN** 系统从 `~/.clickzetta/profiles.toml` 的 `[profiles.myprofile]` 加载基础连接配置
- **AND** 该 profile 覆盖 `default_profile` 仅对本次命令生效

#### Scenario: 使用 JDBC URL

- **WHEN** 用户执行 `cz-cli --jdbc "jdbc:clickzetta://host/instance?username=user&password=pass&workspace=ws" sql "SELECT 1"`
- **THEN** 系统解析 service、instance、auth 与 query 参数
- **AND** JDBC URL 中的字段参与后续优先级合并

#### Scenario: 使用环境变量

- **WHEN** 用户设置 `CZ_USERNAME`、`CZ_PASSWORD`、`CZ_INSTANCE`、`CZ_WORKSPACE` 并执行 `cz-cli sql "SELECT 1"`
- **THEN** 系统从环境变量读取连接配置
- **AND** 未设置字段可由 profile 或 CLI 补齐

### Requirement: 优先级与协议规范化

本需求 MUST 按以下场景执行。

CLI 显式参数 MUST 覆盖其它来源；协议只允许 `https` 或 `http`，无效值 MUST 被拒绝或回退到安全默认值。

#### Scenario: CLI 覆盖协议

- **WHEN** profile 中协议为 `https`，用户执行 `cz-cli --protocol http status`
- **THEN** 本次连接使用 `http`
- **AND** profile 文件不被修改

#### Scenario: 协议无效

- **WHEN** 某来源提供无效 protocol
- **THEN** 系统返回 usage/business error 或忽略该值回退默认 `https`
- **AND** 错误信息必须可诊断来源字段

### Requirement: 认证模式互斥并有明确优先级

本需求 MUST 按以下场景执行。

PAT 与 username/password 是互斥认证模式。PAT 存在时 SHOULD 优先使用 PAT；username/password 必须成对出现。

#### Scenario: PAT 优先

- **WHEN** profile 同时包含 `pat` 与 `username/password`
- **THEN** 运行时优先使用 PAT
- **AND** 输出或错误不得泄露 PAT 原文

#### Scenario: 用户名密码不完整

- **WHEN** 只提供 username 或只提供 password
- **THEN** 系统尝试从其它来源补齐
- **AND** 若最终仍不完整，返回缺失认证字段错误

### Requirement: Cookie header token 认证覆盖所有 Lakehouse 命令

本需求 MUST 按以下场景执行。

当 profile 的 `header.Cookie` 中携带 `X-ClickZetta-Token` 时，该 token 即为完整的 wire 认证凭证。运行时 MUST 在换取 token 前优先识别 cookie token，并直接将其用作 `AuthToken`，而不是回退到 `loginSingle` 登录。此认证方式 MUST 同时覆盖 SQL 执行路径与 studio / analytics-agent / gateway 等经由 `getStudioContext` / `getGatewayContext` 的命令，行为在各路径间保持一致。

#### Scenario: cookie-only profile 执行 studio/agent 命令

- **WHEN** profile 只配置了 `header.Cookie`（含 `X-ClickZetta-Token`），没有 `pat` 也没有 `username/password`，用户执行 `cz-cli analysis agent ...` 或其它 studio/gateway 命令
- **THEN** 运行时从 cookie 中解析出 token 并直接作为认证凭证，不调用 `/clickzetta-portal/user/loginSingle`
- **AND** token 中缺失的 instanceId 通过 JWT payload、`header.Instanceid` 或 `serviceInstanceList` 依次回退解析

#### Scenario: cookie token 缺失时回退

- **WHEN** profile 的 `header.Cookie` 中不含 `X-ClickZetta-Token`（或根本没有 Cookie header）
- **THEN** 运行时回退到既有认证优先级（PAT > username/password）换取 token
- **AND** 若最终无任何可用认证来源，返回明确的认证缺失错误

### Requirement: 命令执行前校验必要上下文

本需求 MUST 按以下场景执行。

需要 Lakehouse 的命令 MUST 在执行前校验认证、instance、workspace 等必要字段。

#### Scenario: 缺少认证

- **WHEN** 用户执行需要连接的命令且没有任何认证来源
- **THEN** CLI 返回 `NO_PROFILE` 或明确认证缺失错误
- **AND** 提示 `cz-cli setup` 或 profile create 路径

#### Scenario: 缺少 workspace

- **WHEN** 命令需要 workspace 但解析结果没有 workspace
- **THEN** CLI 返回可操作错误
- **AND** SHOULD 指导用户使用 `cz-cli workspace list`、`cz-cli profile update` 或 `cz-cli setup`

### Requirement: PAT 与 Studio/API 调用集成

本需求 MUST 按以下场景执行。

SQL、Studio task、runs、datasource、AIGW 等命令 MUST 使用统一连接上下文创建 ClickZetta SDK/client。

#### Scenario: SQL 使用 PAT

- **WHEN** 用户通过 PAT 执行 `cz-cli sql "SELECT 1"`
- **THEN** SDK 使用 PAT 或其交换后的 token 建立连接
- **AND** traceparent 等观测字段保持传递

#### Scenario: Studio 命令使用同一上下文

- **WHEN** 用户执行 `cz-cli task list`
- **THEN** Studio API client 使用同一 profile/JDBC/env/CLI 合并结果
- **AND** 不要求用户重复传入连接参数
