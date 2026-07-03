# release-channel 规格说明

## Purpose
定义 cz-cli 的发布渠道（`stable`/`nightly`）：其允许的值和默认值、解析优先级、与 opencode 的 `InstallationChannel` 的隔离，以及每个安装/更新入口必须持久化的 `install.json` schema。

## File Boundary

本规格只定义发布渠道和安装身份元数据。`~/.clickzetta/install.json` MUST NOT 承载自动更新开关、检查时间、检查结果或最新版本缓存；这些字段属于 auto-update 规格中的 `~/.local/state/clickzetta/update-check.json`。如果 install/update 代码需要同时修改安装元数据和自动更新状态，MUST 分别遵守两个规格的文件边界。

## Distribution Data Boundary

本规格同时定义 COS 发布元数据和官网安装代理的访问边界。COS 二进制归档是私有对象；消费端不得用公开 COS URL 或拼接路径下载归档。

COS 发布元数据入口分为三类，职责不得混用：

- 渠道指针：`META-INF/versions.json` 是唯一渠道指针文件；其中顶层 `stable` 和 `nightly` 字段分别记录当前 stable/nightly 版本。不得再创建 `META-INF/stable`、`META-INF/nightly`、`META-INF/channels/<channel>/version` 等额外 channel 指针对象。
- 当前渠道安装资产：`META-INF/channels/<channel>/bootstrap.*` 和 `META-INF/channels/<channel>/manifest.json`，仅缓存 `versions.json` 当前指向版本的安装入口和 manifest，供默认安装使用。
- 历史版本入口：`META-INF/releases/<version>/manifest.json`，用于用户显式指定历史版本安装；release manifest 内的 `platforms[platform].url` 是平台归档的长期 presigned URL。

`META-INF/releases/<version>/bootstrap.*` 可以作为发布产物写入 COS，用于审计、回填或兼容旧发布结构；但官网、CLI update、install shim 等消费端 MUST NOT 通过拼接公开 COS 归档 URL 下载二进制，也 MUST NOT 绕过 manifest 中记录的 `platforms[platform].url`。显式版本安装如果缺少 `META-INF/releases/<version>/manifest.json`，必须失败并提示该 installer 当前无法下载该版本，而不是回退猜测私有归档路径。

## Requirements
### Requirement: 发布渠道与 opencode InstallationChannel 隔离

本需求 MUST 按以下场景执行。

cz-cli 应维护一个独立于 opencode 构建时 `InstallationChannel` 常量的发布渠道概念。发布渠道不得从 `InstallationChannel` 派生，更新子系统不得读取 `InstallationChannel` 来确定发布流。opencode 的 `InstallationChannel` 及其消费者（按渠道区分的数据库路径、遥测 `deployment.environment.name`、`isLocal()`/`isPreview()`、插件版本固定）必须不受影响。

#### Scenario: 更新子系统不引用 InstallationChannel

- **当** 更新/自动更新代码解析发布渠道时
- **则** 值从 `CZ_CHANNEL`、`install.json` 或默认值计算得出，而非从 `InstallationChannel`

#### Scenario: opencode 渠道消费者不变

- **当** 发布渠道在 `stable` 和 `nightly` 之间切换时
- **则** 由 `InstallationChannel` 派生的 SQLite 数据库路径、遥测环境和开发模式检测保持不变

### Requirement: 允许的渠道值和默认值

本需求 MUST 按以下场景执行。

发布渠道应为 `stable` 或 `nightly` 之一。`stable` 应为所有面向用户安装的默认值。未知或遗留值（例如 `latest`）在读取时应强制转换为 `stable`。

#### Scenario: 未知值强制转换为 stable

- **当** `install.json` 包含 `"channel": "latest"` 时
- **则** 解析的发布渠道为 `stable`

#### Scenario: 未设置时的默认值

- **当** 未设置 `CZ_CHANNEL` 环境变量且 `install.json` 无可用渠道时
- **则** 解析的发布渠道为 `stable`

### Requirement: 渠道解析优先级

本需求 MUST 按以下场景执行。

发布渠道的解析优先级为：`CZ_CHANNEL` 环境变量，然后 `~/.clickzetta/install.json` 中的 `channel`，然后 `stable`。

#### Scenario: 环境变量覆盖 install.json

- **当** `install.json` 有 `"channel": "nightly"` 且设置了 `CZ_CHANNEL=stable` 时
- **则** 解析的发布渠道为 `stable`

#### Scenario: 环境变量未设置时使用 install.json

- **当** `CZ_CHANNEL` 未设置且 `install.json` 有 `"channel": "nightly"` 时
- **则** 解析的发布渠道为 `nightly`

### Requirement: install.json schema 和持久化契约

本需求 MUST 按以下场景执行。

每个安装或更新入口——打包的 `setup.sh`、`scripts/install.sh`、npm `postinstall.js`、`cz-cli update` 命令和自动更新路径——应创建或更新 `~/.clickzetta/install.json`。文件应包含 `version`（元数据 schema 版本，当前为 `1`）、`installed_path`、`channel`、`binary_version` 和 `updated_at`。`version` 字段为元数据 schema 版本，与 `binary_version`（cz-cli 程序版本）不同；更改文件结构应递增 `version`。

#### Scenario: setup.sh 持久化渠道

- **当** `setup.sh` 在设置了 `CZ_VERSION` 且未设置 `CZ_CHANNEL` 的情况下运行时
- **则** `install.json` 写入 `channel` = `stable` 和 `binary_version` = 已安装版本

#### Scenario: CZ_CHANNEL 覆盖被持久化

- **当** `setup.sh` 以 `CZ_CHANNEL=nightly` 运行时
- **则** `install.json` 写入 `channel` = `nightly`

#### Scenario: npm postinstall 持久化显式渠道

- **当** npm `postinstall.js` 以 `CZ_CHANNEL=nightly` 运行时
- **则** `install.json` 写入 `channel` = `nightly`

#### Scenario: scripts install 使用渠道进行版本解析

- **当** `scripts/install.sh` 在未指定显式版本且 `CZ_CHANNEL=nightly` 的情况下运行时
- **则** 已安装的 `binary_version` 从 `https://cz-cli.ai/api/nightly` 解析
- **且** `install.json` 写入 `channel` = `nightly`

#### Scenario: 更新的渠道在写入时被保留

- **当** 调用 `writeInstallMetadata` 且 `install.json` 已有 `channel` 时
- **则** 现有渠道被保留，除非提供了显式渠道，且永远不被 `InstallationChannel` 替换

#### Scenario: 更新写入已解析的渠道

- **当** `cz-cli update` 或自动更新路径在解析 `channel` = `nightly` 后完成升级时
- **则** `install.json` 写入 `channel` = `nightly`

#### Scenario: install.json 不承载自动更新状态

- **当** 任意安装或更新入口写入 `install.json` 时
- **则** `install.json` 不包含 `autoupdate`、`last_checked_at`、`last_result`、`latest_version` 或 `error`

### Requirement: dev 发布版本格式

本需求 MUST 按以下场景执行。

dev 发布应使用 `dev-v<major>.<minor>.<patch>.<timestamp>` 格式，例如 `dev-v1.0.7.20260616200210`。发布入口不得再生成或接受旧的 `v<major>.<minor>.<patch>-dev.<timestamp>` 标签格式作为 dev 发布。dev 发布的 GitHub tag、GitHub release、COS 版本目录和 `versions.json.nightly` 版本值应保持同一个 `dev-v...` 字符串。

#### Scenario: make 生成 dev tag

- **当** 执行 `make tag-dev VERSION=1.0.7 DEV_SUFFIX=20260616200210` 时
- **则** git tag 和 push 使用 `dev-v1.0.7.20260616200210`

#### Scenario: release workflow 识别 dev tag

- **当** release workflow 收到 `dev-v1.0.7.20260616200210` tag 时
- **则** 将其判定为 dev 发布，并将下游 version 保持为 `dev-v1.0.7.20260616200210`

#### Scenario: 旧 dev tag 被拒绝

- **当** release workflow 收到 `v1.0.7-dev.20260616200210` tag 时
- **则** 版本校验失败，不发布旧格式 dev 版本

#### Scenario: nightly channel 写入 dev-v 版本

- **当** COS 发布脚本以 `--version dev-v1.0.7.20260616200210` 运行且未提升 stable 时
- **则** `META-INF/versions.json` 的顶层 `nightly` 字段写入 `dev-v1.0.7.20260616200210`
- **AND** 不创建 `META-INF/nightly` 或 `META-INF/channels/nightly/version` 指针对象

#### Scenario: nightly channel 不被同基础版本的旧 dev 构建覆盖

- **当** `META-INF/versions.json.nightly` 当前指向 `dev-v1.0.7.20260616200210` 时
- **且** COS 发布脚本尝试写入 `dev-v1.0.7.20260616190000`
- **则** downgrade guard 识别后者更旧，不覆盖 `versions.json.nightly`
- **AND** 不更新 `META-INF/channels/nightly/manifest.json` 或 `META-INF/channels/nightly/bootstrap.*`

### Requirement: channel downgrade guard 同时保护指针和安装资产

本需求 MUST 按以下场景执行。

发布或 promote 修改 channel 时，MUST 先基于 `META-INF/versions.json` 当前 channel 字段判断是否降级。若目标版本低于当前 channel 版本，MUST 拒绝或跳过该 channel promote，且不得修改 `versions.json` 或 `META-INF/channels/<channel>/*`。

#### Scenario: stable 发布降级时不覆盖 channel 资产

- **WHEN** `versions.json.stable` 当前为 `1.0.21` 且发布脚本尝试将 `1.0.20` 指向 `stable`
- **THEN** 发布脚本不覆盖 `META-INF/versions.json` 顶层 `stable` 字段
- **AND** 不覆盖 `META-INF/channels/stable/manifest.json`
- **AND** 不覆盖 `META-INF/channels/stable/bootstrap.sh`
- **AND** 不覆盖 `META-INF/channels/stable/bootstrap.ps1`

#### Scenario: promote 降级时不复制 release 资产

- **WHEN** `versions.json.stable` 当前为 `1.0.21` 且 promote 脚本尝试将 `1.0.18` 提升为 `stable`
- **THEN** promote 脚本返回拒绝降级错误
- **AND** 不复制 `META-INF/releases/1.0.18/manifest.json` 到 `META-INF/channels/stable/manifest.json`
- **AND** 不修改 `META-INF/versions.json`

### Requirement: 版本级安装资产

本需求 MUST 按以下场景执行。

COS 发布脚本应同时写入当前渠道安装资产和版本级安装资产。渠道级资产（`META-INF/channels/<channel>/bootstrap.*`、`manifest.json`）用于默认安装 `versions.json` 当前指向的版本；版本级资产（`META-INF/releases/<version>/bootstrap.*`、`manifest.json`）用于用户显式指定历史版本安装，避免 `/install.sh` 永远只能安装当前 channel 版本。历史版本入口必须读取 `META-INF/releases/<version>/manifest.json`，再通过 manifest 中记录的平台 archive presigned URL 下载归档。

#### Scenario: stable 发布写入版本级 bootstrap

- **当** COS 发布脚本以 `--version 1.0.21 --promote-stable` 运行时
- **则** 在 `1.0.21` 不低于 `versions.json.stable` 的前提下，写入 `META-INF/channels/stable/bootstrap.sh`
- **AND** 写入 `META-INF/releases/1.0.21/bootstrap.sh`
- **AND** 两者内容均安装 `1.0.21`

#### Scenario: stable 发布写入版本级 manifest

- **当** COS 发布脚本以 `--version 1.0.21 --promote-stable` 运行时
- **则** 在 `1.0.21` 不低于 `versions.json.stable` 的前提下，写入 `META-INF/channels/stable/manifest.json`
- **AND** 写入 `META-INF/releases/1.0.21/manifest.json`
- **AND** `META-INF/releases/1.0.21/manifest.json` 的 `platforms[platform].url` 记录平台归档的 presigned URL

#### Scenario: channel 指针只存在于 versions.json

- **WHEN** 发布或 promote 将版本 `1.0.21` 指向 `stable` 时
- **THEN** `META-INF/versions.json` 顶层 `stable` 字段写入 `1.0.21`
- **AND** 不创建 `META-INF/stable`
- **AND** 不创建 `META-INF/channels/stable/version`

#### Scenario: 当前 channel 安装资产写入 channels 目录

- **WHEN** 发布或 promote 将版本 `1.0.21` 指向 `stable` 时
- **THEN** 写入 `META-INF/channels/stable/manifest.json`
- **AND** 写入 `META-INF/channels/stable/bootstrap.sh`
- **AND** 写入 `META-INF/channels/stable/bootstrap.ps1`
- **AND** 这些资产内容对应 `versions.json.stable` 指向的版本

#### Scenario: 历史版本安装读取 release manifest

- **当** 用户请求安装 `1.0.18` 且该版本不再是 stable/nightly 当前指针时
- **则** 官网安装入口读取 `META-INF/releases/1.0.18/manifest.json`
- **AND** 生成的 shell 脚本使用 `/download/1.0.18/<platform>` 下载归档
- **AND** 不读取私有构建产物目录下的 `1.0.18/bootstrap.sh`
- **AND** PowerShell 入口不读取私有构建产物目录下的 `1.0.18/bootstrap.ps1`
- **AND** 不拼接公开 COS 归档 URL

#### Scenario: 历史版本缺少 release manifest

- **当** 用户请求安装 `1.0.18` 且 `META-INF/releases/1.0.18/manifest.json` 不存在
- **则** 官网安装入口返回明确失败
- **AND** 面向用户的错误提示说明该 installer 当前无法下载该版本，请下载使用最新版
- **AND** 不回退读取私有构建产物目录下的 `1.0.18/bootstrap.sh`
- **AND** 不回退读取私有构建产物目录下的 `1.0.18/bootstrap.ps1`
- **AND** 不回退使用 `META-INF/channels/stable/manifest.json`，除非 `versions.stable` 当前正等于 `1.0.18`

#### Scenario: PowerShell 历史版本入口通过 release manifest 渲染

- **当** Windows 用户请求 `/install.ps1?version=1.0.18`
- **则** 官网安装入口读取 `META-INF/releases/1.0.18/manifest.json`
- **AND** 生成的 PowerShell 脚本将 `win32-x64` 归档 URL 写为 `/download/1.0.18/win32-x64`
- **AND** 下载路由再重定向到 manifest 内记录的长期 presigned archive URL

#### Scenario: 下载路由只使用 manifest 内记录的归档 URL

- **当** 官网 `/download/1.0.18/darwin-arm64` 处理下载请求时
- **则** 先加载 `META-INF/releases/1.0.18/manifest.json`
- **AND** 重定向到 `manifest.platforms["darwin-arm64"].url`
- **AND** 不拼接 COS bucket、path prefix、version、platform 或 archive 名称生成归档 URL

#### Scenario: promote 同步 channel 安装资产

- **当** COS promote 脚本将 `1.0.18` 提升为 `stable` 时
- **则** 先校验 `META-INF/releases/1.0.18/manifest.json`
- **AND** 如果 `1.0.18` 低于当前 `versions.json.stable`，则拒绝 promote，且不修改 `versions.json` 或 `META-INF/channels/stable/*`
- **AND** 复制 `META-INF/releases/1.0.18/manifest.json` 到 `META-INF/channels/stable/manifest.json`
- **AND** 复制 `META-INF/releases/1.0.18/bootstrap.sh` 到 `META-INF/channels/stable/bootstrap.sh`
- **AND** 复制 `META-INF/releases/1.0.18/bootstrap.ps1` 到 `META-INF/channels/stable/bootstrap.ps1`
- **AND** 更新 `META-INF/versions.json` 顶层 `stable` 字段和对应 `channel_tags`
- **AND** 不创建 `META-INF/stable` 或 `META-INF/channels/stable/version` 指针对象

#### Scenario: nightly 发布写入 dev-v 版本级资产

- **当** COS 发布脚本以 `--version dev-v1.0.21.20260703120000` 运行时
- **则** 在该版本不低于 `versions.json.nightly` 的前提下，写入 `META-INF/channels/nightly/bootstrap.sh`
- **AND** 写入 `META-INF/releases/dev-v1.0.21.20260703120000/bootstrap.sh`
- **AND** 写入 `META-INF/releases/dev-v1.0.21.20260703120000/manifest.json`

#### Scenario: 历史版本资产写入 releases 目录

- **WHEN** 发布版本 `1.0.21` 时
- **THEN** 写入 `META-INF/releases/1.0.21/manifest.json`
- **AND** 写入 `META-INF/releases/1.0.21/bootstrap.sh`
- **AND** 写入 `META-INF/releases/1.0.21/bootstrap.ps1`
- **AND** `META-INF/releases/1.0.21/manifest.json` 的 `platforms[platform].url` 记录平台归档的长期 presigned URL

#### Scenario: nightly dev-v 指针只更新 versions.json

- **WHEN** 发布版本 `dev-v1.0.21.20260703120000` 并指向 `nightly` 时
- **THEN** `META-INF/versions.json` 顶层 `nightly` 字段写入 `dev-v1.0.21.20260703120000`
- **AND** 不创建 `META-INF/nightly`
- **AND** 不创建 `META-INF/channels/nightly/version`
