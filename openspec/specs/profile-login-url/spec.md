# profile-login-url 规格说明

## Purpose

定义 `cz-cli profile login-url` 如何根据现有 profile 生成用户可直接打开的网页登录 URL，并规定租户名解析、结构化输出和浏览器打开语义。

## Requirements

### Requirement: profile login-url 命令返回网页登录 URL

本需求 MUST 按以下场景执行。

CLI MUST provide `cz-cli profile login-url [name]` to generate a user-facing web login URL from a saved profile.

#### Scenario: 未传 profile 名称时使用默认 profile

- **WHEN** 用户执行 `cz-cli profile login-url`
- **THEN** CLI MUST read `default_profile`
- **AND** CLI MUST load that profile's connection settings to build the login URL result

#### Scenario: 显式指定 profile 名称

- **WHEN** 用户执行 `cz-cli profile login-url prod`
- **THEN** CLI MUST load profile `prod`
- **AND** CLI MUST return the resulting `web_login_url` together with the resolved `profile` name

#### Scenario: service 为 API 域名时生成账号站点 URL

- **WHEN** profile service is an API host such as `https://cn-shanghai-alicloud.api.clickzetta.com`
- **AND** CLI has a resolved tenant name
- **THEN** CLI MUST generate an account login URL with the tenant prefix and matching environment/domain

#### Scenario: service 为 account 域名时规范化输出

- **WHEN** profile service already points to an account host
- **AND** CLI has a resolved tenant name
- **THEN** CLI MUST return a normalized tenant-specific account login URL
- **AND** CLI MUST NOT return the raw service string as the final login URL

### Requirement: 租户名来源必须可控且可解释

本需求 MUST 按以下场景执行。

The command MUST resolve tenant name from explicit arguments, cached profile data, or optional remote lookup in a deterministic order.

#### Scenario: 显式 tenant-name 优先级最高

- **WHEN** 用户执行 `cz-cli profile login-url default --tenant-name vmhmdkcc`
- **THEN** CLI MUST use `vmhmdkcc` as the tenant name
- **AND** CLI MUST NOT perform remote tenant lookup
- **AND** output MUST set `tenant_name_source` to `arg`

#### Scenario: 使用 profile 中缓存的 tenant name

- **WHEN** profile already contains `tenant_name` or `account_display_name`
- **AND** 用户没有传 `--tenant-name`
- **THEN** CLI MUST use the cached tenant name
- **AND** CLI MUST NOT perform remote tenant lookup
- **AND** output MUST set `tenant_name_source` to `profile`

#### Scenario: 使用 PAT 远端解析 tenant name

- **WHEN** 用户执行 `cz-cli profile login-url default --resolve`
- **AND** profile contains PAT authentication
- **AND** profile does not already contain a tenant name
- **THEN** CLI MUST obtain a token with the existing PAT login flow
- **AND** CLI MUST call the current-user endpoint to resolve `accountDisplayName`
- **AND** output MUST set `tenant_name_source` to `resolved_pat`

#### Scenario: 使用用户名密码远端解析 tenant name

- **WHEN** 用户执行 `cz-cli profile login-url legacy --resolve`
- **AND** profile contains username/password authentication
- **AND** profile does not already contain a tenant name
- **THEN** CLI MUST authenticate with the existing username/password flow
- **AND** CLI MUST call the current-user endpoint to resolve `accountDisplayName`
- **AND** output MUST set `tenant_name_source` to `resolved_password`

#### Scenario: 未提供 tenant name 且未启用远端解析

- **WHEN** profile does not contain a tenant name
- **AND** 用户没有传 `--tenant-name`
- **AND** 用户没有启用 `--resolve`
- **THEN** CLI MUST return a structured error
- **AND** the error MUST tell the user to pass `--tenant-name` or `--resolve`

### Requirement: 命令输出必须适合脚本和人工使用

本需求 MUST 按以下场景执行。

The command MUST expose a stable, user-facing result shape instead of only printing a raw URL string.

#### Scenario: 返回结构化字段

- **WHEN** `cz-cli profile login-url [name]` succeeds
- **THEN** output MUST include `profile`
- **AND** output MUST include `service`
- **AND** output MUST include `instance`
- **AND** output MUST include `tenant_name`
- **AND** output MUST include `tenant_name_source`
- **AND** output MUST include `web_login_url`

#### Scenario: 浏览器打开成功或失败都打印 URL

- **WHEN** 用户执行 `cz-cli profile login-url default --open`
- **THEN** CLI MUST still output `web_login_url`
- **AND** CLI MAY additionally report whether the browser open attempt succeeded

### Requirement: 浏览器打开为 best-effort

本需求 MUST 按以下场景执行。

The command MAY open the system browser, but browser integration failures MUST NOT block the primary URL result.

#### Scenario: 打开浏览器成功

- **WHEN** 用户执行 `cz-cli profile login-url default --open`
- **AND** the local browser command succeeds
- **THEN** CLI MUST return the normal success payload
- **AND** output MUST indicate that the browser was opened

#### Scenario: 打开浏览器失败

- **WHEN** 用户执行 `cz-cli profile login-url default --open`
- **AND** the local browser command fails or is unavailable
- **THEN** CLI MUST still return the normal login URL result
- **AND** CLI MUST NOT convert the command into a fatal error only because browser opening failed
