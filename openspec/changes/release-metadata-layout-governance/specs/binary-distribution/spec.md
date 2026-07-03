## ADDED Requirements

### Requirement: 安装入口通过 manifest recorded URL 下载归档

安装入口 MUST 区分当前渠道安装和显式历史版本安装。当前渠道版本 MUST 从 `META-INF/versions.json` 顶层 `stable`/`nightly` 字段解析，当前渠道安装资产 MAY 从 `META-INF/channels/<channel>/bootstrap.*` 或 `META-INF/channels/<channel>/manifest.json` 读取。显式历史版本安装 MUST 从 `META-INF/releases/<version>/manifest.json` 读取，并使用 manifest 中记录的 `platforms[platform].url` 下载平台归档。

#### Scenario: 默认 stable 安装使用 channel 安装资产

- **WHEN** 用户执行默认 stable 安装命令
- **THEN** 安装入口使用 `META-INF/channels/stable/bootstrap.sh` 或 `META-INF/channels/stable/manifest.json`
- **AND** 该资产对应 `META-INF/versions.json` 顶层 `stable` 字段指向的版本

#### Scenario: 显式历史版本安装使用 release manifest

- **WHEN** 用户显式安装历史版本 `1.0.18`
- **THEN** 安装入口读取 `META-INF/releases/1.0.18/manifest.json`
- **AND** 下载 URL 来自 `manifest.platforms[platform].url`
- **AND** 不根据 bucket、prefix、version、platform 或 archive 名称拼接公开 COS URL

#### Scenario: Windows 显式历史版本安装不读取私有 bootstrap

- **WHEN** Windows 用户显式安装历史版本 `1.0.18`
- **THEN** PowerShell 安装入口读取 `META-INF/releases/1.0.18/manifest.json`
- **AND** 不请求私有构建产物目录下的 `1.0.18/bootstrap.ps1`
