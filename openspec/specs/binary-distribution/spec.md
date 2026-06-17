# binary-distribution 规格说明

## Purpose
迁移 Python/PyInstaller 分发规格到当前 TypeScript/Bun 重写版本。当前分发链路包含 Bun 编译平台二进制、GitHub Release/COS 发布、npm 主包与平台包、curl 安装脚本和 PowerShell 安装入口。

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

`scripts/install.sh` 与 Windows PowerShell 安装入口 MUST 根据发布渠道解析 manifest/bootstrap 并下载安装到 `~/.clickzetta/bin` 或指定目录。

#### Scenario: curl 安装

- **WHEN** 用户执行 `curl -fsSL https://cz-cli.ai/install.sh | sh`
- **THEN** 脚本检测平台、解析版本、下载归档、安装 binary 和 skills
- **AND** 写入 install metadata 供 update/auto-update 使用

#### Scenario: 下载失败

- **WHEN** manifest、archive 或校验下载失败
- **THEN** 安装脚本输出 URL、目标路径和错误原因
- **AND** 不留下不可执行的半安装 binary 覆盖可用版本

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
