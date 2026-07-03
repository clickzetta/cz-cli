# binary-distribution 规格说明

## Purpose
迁移 Python/PyInstaller 分发规格到当前 TypeScript/Bun 重写版本。当前分发链路包含 Bun 编译平台二进制、GitHub Release/COS 发布、npm 主包与平台包、curl 安装脚本和 PowerShell 安装入口。

## Release Asset Boundary

二进制归档发布到 COS 后按私有对象处理。安装入口、更新入口和官网下载代理不得自行拼接 COS 公开 URL 下载归档；必须使用 release-channel 规格定义的 manifest/presigned URL 契约。当前渠道版本必须从 `META-INF/versions.json` 的顶层 `stable`/`nightly` 字段解析；当前渠道安装可使用 `META-INF/channels/<channel>/bootstrap.*` 或 `META-INF/channels/<channel>/manifest.json` 作为该指针版本的安装资产；显式历史版本安装必须先读取 `META-INF/releases/<version>/manifest.json`，再使用 manifest 中的 `platforms[platform].url` 下载平台归档。

## Requirements
### Requirement: Bun 编译产物按平台打包

本需求 MUST 按以下场景执行。

release 构建 MUST 为目标平台生成 `cz-cli` 或 `cz-cli.exe` 二进制，并携带 setup/install 所需资源。

#### Scenario: 构建平台归档

- **WHEN** CI 或 release 脚本构建 `darwin-arm64`、`linux-x64`、`win32-x64` 等平台
- **THEN** 产物包含可执行 binary、setup 脚本和捆绑 skills
- **AND** archive 命名使用 `cz-cli-<version>-<platform>.<ext>` 或发布脚本约定格式

#### Scenario: 平台不支持

- **WHEN** 用户或脚本请求不支持的平台
- **THEN** 构建/安装入口返回明确错误
- **AND** 不下载错误架构的 binary

### Requirement: 安装脚本支持 COS/GitHub Release 渠道

本需求 MUST 按以下场景执行。

`scripts/install.sh` 与 Windows PowerShell 安装入口 MUST 根据发布渠道解析 manifest/bootstrap 并下载安装到 `~/.clickzetta/bin` 或指定目录。默认渠道安装从 `META-INF/versions.json` 顶层 `stable`/`nightly` 字段解析当前版本，并读取 `META-INF/channels/<channel>/bootstrap.*` 或 `META-INF/channels/<channel>/manifest.json`。显式历史版本安装从 `META-INF/releases/<version>/manifest.json` 读取，并使用 manifest 中记录的 `platforms[platform].url` 下载平台归档。

#### Scenario: curl 安装

- **WHEN** 用户执行 `curl -fsSL https://cz-cli.ai/install.sh | sh`
- **THEN** 脚本检测平台、解析版本、下载归档、安装 binary 和 skills
- **AND** 写入 install metadata 供 update/auto-update 使用

#### Scenario: 下载失败

- **WHEN** manifest、archive 或校验下载失败
- **THEN** 安装脚本输出 URL、目标路径和错误原因
- **AND** 不留下不可执行的半安装 binary 覆盖可用版本

#### Scenario: 私有 COS 归档通过 recorded URL 下载

- **WHEN** 安装入口需要下载 COS 上的 `cz-cli-<version>-<platform>.<ext>` 归档
- **THEN** 下载 URL 来自 manifest 中记录的 `platforms[platform].url`
- **AND** 该 URL 是发布流程生成并记录的 presigned URL
- **AND** 安装入口不根据 bucket、prefix、version、platform 或 archive 名称拼接公共 COS URL

#### Scenario: 默认 stable 安装使用 channel 安装资产

- **WHEN** 用户执行默认 stable 安装命令
- **THEN** 安装入口使用 `META-INF/channels/stable/bootstrap.sh` 或 `META-INF/channels/stable/manifest.json`
- **AND** 该资产对应 `META-INF/versions.json` 顶层 `stable` 字段指向的版本

#### Scenario: 显式历史版本安装依赖 versioned manifest

- **WHEN** 用户显式安装历史版本 `1.0.18`
- **THEN** 入口先按 release-channel 规格读取 `META-INF/releases/1.0.18/manifest.json`
- **AND** 下载 URL 来自 `manifest.platforms[platform].url`
- **AND** 不直接请求私有构建产物目录下的 `1.0.18/bootstrap.sh`
- **AND** Windows PowerShell 入口不直接请求私有构建产物目录下的 `1.0.18/bootstrap.ps1`
- **AND** 不拼接公开 COS 归档 URL

### Requirement: npm 包结构使用主包加平台包

本需求 MUST 按以下场景执行。

npm 分发 MUST 使用 `@clickzetta/cz-cli` 主包和 `@clickzetta/cz-cli-<platform>` 平台包，postinstall 负责选择/准备 binary。

#### Scenario: 平台包可用

- **WHEN** 用户安装 `@clickzetta/cz-cli` 且当前平台包存在
- **THEN** postinstall 将对应平台 binary 准备到可执行路径
- **AND** 安装 bundled skills

#### Scenario: 平台包缺失

- **WHEN** 当前平台没有匹配平台包或下载失败
- **THEN** postinstall 返回可诊断错误
- **AND** SHOULD 提供 curl 安装或手动下载替代路径

### Requirement: macOS 安装处理 Gatekeeper

本需求 MUST 按以下场景执行。

macOS 安装入口 MUST 清除 quarantine 并进行 best-effort ad-hoc signing，详细行为由 `macos-gatekeeper` 规格约束。

#### Scenario: quarantine 存在

- **WHEN** 下载得到的 binary 带有 `com.apple.quarantine`
- **THEN** 安装脚本清除该属性并尝试 codesign
- **AND** 首次运行不应因 Gatekeeper 被 kill

#### Scenario: codesign 不可用

- **WHEN** codesign 或 xattr 不可用
- **THEN** 安装仍可继续
- **AND** 输出 best-effort 诊断

### Requirement: 安装脚本维护 PATH 和遮蔽 binary

本需求 MUST 按以下场景执行。

安装/更新 MUST 检查 PATH 中现有 `cz-cli`，避免 npm/bun/旧路径遮蔽当前安装。

#### Scenario: PATH 中存在旧 binary

- **WHEN** `command -v cz-cli` 指向不可用或旧包管理器路径
- **THEN** 安装/更新入口提示或清理遮蔽路径（按 auto-update 规格）
- **AND** 安装后当前 shell 或后续 shell 可找到新 binary

#### Scenario: 自定义安装目录

- **WHEN** 用户通过 `CZ_INSTALL_DIR`/`INSTALL_DIR` 指定目录
- **THEN** binary 安装到指定目录
- **AND** PATH 修复逻辑使用该目录

### Requirement: 分发集成测试覆盖真实安装介质

本需求 MUST 按以下场景执行。

安装与分发变更 MUST 有脚本级或构建级验证。

#### Scenario: shell 脚本语法验证

- **WHEN** 修改 `scripts/install.sh` 或 `scripts/setup.sh`
- **THEN** MUST 运行 `bash -n` 和相关函数 smoke test
- **AND** 输出验证结果

#### Scenario: 平台产物验证

- **WHEN** 修改构建/发布脚本
- **THEN** SHOULD 构建本地 binary 或 dry-run release
- **AND** 验证 archive 中包含 binary、setup 脚本和 skills
