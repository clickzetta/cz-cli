## ADDED Requirements

### Requirement: COS 发布元数据布局职责唯一

COS 发布元数据 MUST 使用无重名、无重复事实来源的布局。`META-INF/versions.json` MUST 是唯一 channel 指针文件；顶层 `stable` 和 `nightly` 字段分别记录当前 stable/nightly 版本。`META-INF/channels/<channel>/` MUST 只保存当前 channel 安装资产，不得保存 `version` 指针。`META-INF/releases/<version>/` MUST 保存历史版本安装资产。

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

### Requirement: channel downgrade guard 同时保护指针和安装资产

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

### Requirement: 显式历史版本安装只读取 release manifest

显式版本安装 MUST 以 `META-INF/releases/<version>/manifest.json` 为入口，并通过 manifest 内记录的 `platforms[platform].url` 下载归档。若 release manifest 缺失，MUST 明确失败并提示该 installer 当前无法下载该版本，请下载使用最新版。

#### Scenario: Unix 显式历史版本读取 release manifest

- **WHEN** 用户请求 `/install.sh?version=1.0.18`
- **THEN** 官网读取 `META-INF/releases/1.0.18/manifest.json`
- **AND** 生成的 shell 脚本使用 `/download/1.0.18/<platform>` 下载归档
- **AND** 不读取私有构建产物目录下的 `1.0.18/bootstrap.sh`

#### Scenario: PowerShell 显式历史版本读取 release manifest

- **WHEN** 用户请求 `/install.ps1?version=1.0.18`
- **THEN** 官网读取 `META-INF/releases/1.0.18/manifest.json`
- **AND** 生成的 PowerShell 脚本使用 `/download/1.0.18/win32-x64` 下载归档
- **AND** 不读取私有构建产物目录下的 `1.0.18/bootstrap.ps1`

#### Scenario: 历史版本缺少 release manifest 时提示过期

- **WHEN** 用户请求安装 `1.0.18` 且 `META-INF/releases/1.0.18/manifest.json` 不存在
- **THEN** 官网返回明确失败
- **AND** 错误提示说明该版本无法由当前 installer 下载，请下载使用最新版
- **AND** 不回退拼接私有 COS 归档路径
