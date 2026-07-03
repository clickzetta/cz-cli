## ADDED Requirements

### Requirement: channel API 从 versions.json 解析

官网 channel API MUST 从 `META-INF/versions.json` 顶层字段解析当前版本。`/api/stable` MUST 返回 `versions.json.stable`，`/api/nightly` MUST 返回 `versions.json.nightly`。实现不得读取或创建 `META-INF/stable`、`META-INF/nightly`、`META-INF/channels/<channel>/version` 等额外 channel 指针对象。

#### Scenario: stable API 读取 versions.json

- **WHEN** 自动更新请求 `https://cz-cli.ai/api/stable`
- **THEN** 官网读取 `META-INF/versions.json`
- **AND** 返回顶层 `stable` 字段中的版本
- **AND** 不读取 `META-INF/stable`
- **AND** 不读取 `META-INF/channels/stable/version`

#### Scenario: nightly API 读取 versions.json

- **WHEN** 自动更新请求 `https://cz-cli.ai/api/nightly`
- **THEN** 官网读取 `META-INF/versions.json`
- **AND** 返回顶层 `nightly` 字段中的版本
- **AND** 不读取 `META-INF/nightly`
- **AND** 不读取 `META-INF/channels/nightly/version`

### Requirement: Windows 指定版本更新使用 versioned PowerShell 入口

Windows 上的显式目标版本更新 MUST 下载带 version 查询参数的 PowerShell 安装入口，使官网能够按 release manifest 渲染目标版本脚本。

#### Scenario: Windows update target 下载 versioned install.ps1

- **WHEN** Windows 用户执行 `cz-cli update -t 1.0.18`
- **THEN** update 命令下载 `https://cz-cli.ai/install.ps1?version=1.0.18`
- **AND** 不下载未带 version 查询参数的 `https://cz-cli.ai/install.ps1` 作为目标版本安装脚本
