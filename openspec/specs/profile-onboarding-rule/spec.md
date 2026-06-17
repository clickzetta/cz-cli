# profile-onboarding-rule 规格说明

## Purpose
迁移 Python 版本 Rule 0：当 agent 或 CLI 发现没有可用 ClickZetta profile 时，必须优先引导用户完成 profile onboarding。当前主要入口为 `cz-cli setup`、`profile quickstart`、`profile discover` 与结构化 `NO_PROFILE` 指导。

## Requirements
### Requirement: 无 profile 时优先给出 setup 指导

本需求 MUST 按以下场景执行。

需要 Lakehouse 连接的命令在没有 profile 时 MUST 返回可操作 onboarding 信息，而不是继续请求业务 API。

#### Scenario: 交互式终端无 profile

- **WHEN** 用户在 TTY 中执行 `cz-cli task list` 且没有 profile
- **THEN** CLI 输出 `cz-cli setup`、credential 快速路径和 username/password 路径
- **AND** 明确 LLM 配置与 Lakehouse profile 配置是两件事

#### Scenario: 非交互式无 profile

- **WHEN** CI 或 agent 执行 `cz-cli task list --format json` 且没有 profile
- **THEN** CLI 输出结构化 `NO_PROFILE` payload
- **AND** payload 包含 `next_step`、`next_steps` 和注册链接

### Requirement: setup 支持新用户 credential 快速路径

本需求 MUST 按以下场景执行。

`cz-cli setup --credential <base64>` MUST 从注册 credential 写入 ClickZetta profile 和内置 LLM 配置。

#### Scenario: credential 有效

- **WHEN** 用户执行 `cz-cli setup --credential <base64_string>`
- **THEN** CLI 解码 credential，写入 `profiles.toml` 中的 profile 与 `llm.clickzetta`
- **AND** 设置默认 profile/LLM（若尚未设置）

#### Scenario: credential 无效

- **WHEN** credential 无法解码或缺少必要字段
- **THEN** CLI 返回结构化错误
- **AND** 不写入部分配置

### Requirement: setup 支持已有账号的渐进式发现

本需求 MUST 按以下场景执行。

已有账号路径 SHOULD 收集 username/password/account name 或 login URL/JDBC，并发现可用 service、instance、workspace、schema、vcluster。

#### Scenario: 非 TTY 缺少下一步字段

- **WHEN** 用户执行 `cz-cli setup --username u --password p --account-name a` 但还需要选择 workspace
- **THEN** CLI 返回下一步需要的字段或候选列表
- **AND** 不在非 TTY 中阻塞等待交互输入

#### Scenario: 网络错误

- **WHEN** discovery API 超时或网络不可达
- **THEN** CLI 返回网络/远端错误
- **AND** MUST 与“没有 profile”错误区分

### Requirement: Studio URL 驱动认证路由

本需求 MUST 按以下场景执行。

setup/discover SHOULD 从 Studio URL 识别账号模式、应用模式和自定义域路径，并选择正确登录 API。

#### Scenario: account URL

- **WHEN** URL 形如 `/accounts/{name}/login`
- **THEN** discovery 使用 account login 流程
- **AND** 解析出 account identifier

#### Scenario: app URL

- **WHEN** URL 形如 `/app/{instance}`
- **THEN** discovery 使用 app/loginSingle 或等价流程
- **AND** 解析出 instance identifier

#### Scenario: 未知 URL

- **WHEN** URL 不符合任何支持模式
- **THEN** CLI 快速失败并给出可修正提示
- **AND** 不进行无界重试

### Requirement: discovery 重试有界

本需求 MUST 按以下场景执行。

onboarding discovery MUST 对确定性错误快速失败，对瞬态错误使用有界重试。

#### Scenario: 确定性认证错误

- **WHEN** 用户名密码错误或 URL schema 不支持
- **THEN** CLI 不重试或只做最小重试
- **AND** 返回明确错误

#### Scenario: 瞬态错误

- **WHEN** API 返回临时网络错误、限流或 5xx
- **THEN** CLI 使用有限次数重试
- **AND** 超限后返回包含尝试信息的错误
