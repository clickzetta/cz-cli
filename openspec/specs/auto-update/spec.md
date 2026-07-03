# auto-update 规格说明

## Purpose
定义 cz-cli 何时自动更新自身、发布渠道如何选择更新流（版本来源和安装机制）、双文件更新状态模型，以及通知与升级行为。

## Governance

本规格是 install/update/自动更新行为的主契约。修改以下任一内容时，MUST 同步更新本规格并补充可验证场景：

- 自动更新启停判断、跳过命令、检查间隔、通知/升级策略
- `cz-cli autoupdate` 命令语义和持久化字段
- `update-check.json` 字段、写入时机或保留策略
- 显式版本安装/更新、降级保护、版本来源
- install/update 入口的 binary 清理和升级恢复行为

本规格中的“文件边界”和“入口边界”优先于下方各 Requirement 的叙述性文本；如果场景文本与边界冲突，必须先修正场景文本。

## State Files

自动更新相关持久化 MUST 遵循以下文件边界：

- `~/.clickzetta/install.json`：安装身份/渠道记忆文件，仅记录安装来源、安装路径、发布渠道、二进制版本等安装元数据。
- `~/.local/state/clickzetta/update-check.json`：自动更新状态文件，记录 `autoupdate`、`last_checked_at`、`last_result`、`latest_version`、`error` 等自动更新状态。
- 自动更新开关 `autoupdate` MUST 只写入并只从 `update-check.json` 读取，不得写入 `install.json`、`profiles.toml`、`czcli.json` 或通用 config 文件。
- `cz-cli autoupdate` 是修改自动更新开关的唯一 CLI 入口。

## Entry Boundaries

- `cz-cli autoupdate [true|false|notify]`：只读写 `update-check.json.autoupdate`，不执行版本检查，不触发升级。
- `cz-cli update`：手动更新入口，解析目标版本并执行安装；不得写入 `update-check.json`，除非其子流程实际进入自动更新路径。
- 自动更新路径：普通命令启动前的后台检查；可写入 `update-check.json` 的检查状态，但写入状态时 MUST 保留既有 `autoupdate` 值。
- 安装脚本和发布脚本：负责安装资产、安装元数据和版本指针；不得修改 `autoupdate`。

## Version Classes

- stable release：有效 semver，例如 `1.0.20`。
- nightly/dev release：`dev-v<major>.<minor>.<patch>.<timestamp>`，例如 `dev-v1.0.7.20260616190000`。
- local/dev build：非发布版本，例如 `local` 或本地开发构建版本。

自动更新对 stable release 运行。`dev-v...` 版本默认跳过自动更新，避免固定历史版本、夜间版本或开发验证版本被渠道指针覆盖。渠道解析仍允许 stable 当前版本升级到 nightly 的 `dev-v...` 目标版本。

## Requirements
### Requirement: 自动更新不受渠道限制

本需求 MUST 按以下场景执行。

自动更新应在任何真实 stable 安装上运行，不受发布渠道影响。启用条件由以下因素决定：更新未被禁用（通过自动更新状态文件中的 `autoupdate: false` 或环境变量 `CLICKZETTA_DISABLE_AUTOUPDATE` / `CZ_SKIP_UPDATE` / 一次性 `CLICKZETTA_SKIP_UPDATE_ONCE`），命令不在跳过列表中（`setup`、`update`、`autoupdate`、`uninstall`、`--help`/`-h`、`--version`/`-v`），已安装版本为 stable release，安装方式受支持，且检查间隔已到期。渠道值不应决定自动更新是否运行。

#### Scenario: Stable 安装执行升级

- **WHEN** `stable` 安装具有受支持的方式、有效的当前版本、可用的更新版本且间隔已到期时
- **THEN** 解析的操作为 `upgrade`

#### Scenario: Dev/本地构建被跳过

- **WHEN** 已安装版本不是有效 semver（例如 `local` 开发构建）时
- **THEN** 自动更新被跳过

#### Scenario: Nightly dev-v 已安装版本被跳过

- **WHEN** 已安装版本为 `dev-v1.0.7.20260616190000` 且命令为正常命令时
- **THEN** 自动更新被跳过，避免开发/夜间版本被 stable 自动覆盖

#### Scenario: 真实安装在任何渠道下都不被跳过

- **WHEN** 命令为正常命令、未设置跳过环境变量且版本为有效 semver 时
- **THEN** 自动更新不被跳过，与渠道无关

### Requirement: 渠道选择更新流；安装方式不选择版本

本需求 MUST 按以下场景执行。

发布渠道应是目标版本的唯一来源，始终从 cz-cli.ai 解析：`stable` 来自 `https://cz-cli.ai/api/stable`，`nightly` 来自 `https://cz-cli.ai/api/nightly`。官网 API 的 channel 版本来源必须是 `META-INF/versions.json` 顶层 `stable`/`nightly` 字段，不得读取或创建额外的 `META-INF/stable`、`META-INF/nightly`、`META-INF/channels/<channel>/version` 指针对象。安装方式不应影响版本解析——它仅选择升级机制（`stable` → `install.sh`；`nightly` → `install-nightly.sh`；托管包管理器使用其自身的安装命令）。特别地，版本解析不应查询 npm 仓库的 `latest` dist-tag，即使安装方式为 npm/pnpm/yarn/bun。`stable` 和 `nightly` 均可自动升级。

#### Scenario: Stable 流端点

- **WHEN** 发布渠道为 `stable` 时
- **THEN** 最新版本从 `https://cz-cli.ai/api/stable` 获取，升级使用 stable 安装脚本

#### Scenario: stable API 读取 versions.json

- **WHEN** 自动更新请求 `https://cz-cli.ai/api/stable`
- **THEN** 官网读取 `META-INF/versions.json`
- **AND** 返回顶层 `stable` 字段中的版本
- **AND** 不读取 `META-INF/stable`
- **AND** 不读取 `META-INF/channels/stable/version`

#### Scenario: Nightly 流端点

- **WHEN** 发布渠道为 `nightly` 时
- **THEN** 最新版本从 `https://cz-cli.ai/api/nightly` 获取，升级使用 nightly 安装脚本

#### Scenario: nightly API 读取 versions.json

- **WHEN** 自动更新请求 `https://cz-cli.ai/api/nightly`
- **THEN** 官网读取 `META-INF/versions.json`
- **AND** 返回顶层 `nightly` 字段中的版本
- **AND** 不读取 `META-INF/nightly`
- **AND** 不读取 `META-INF/channels/nightly/version`

#### Scenario: Nightly dev-v 目标版本执行升级

- **WHEN** 当前安装版本为有效 semver、发布渠道为 `nightly`、最新版本为 `dev-v1.0.8.20260616200210` 且安装方式受支持时
- **THEN** 解析的操作为 `upgrade`

#### Scenario: npm 安装方式不改变版本来源

- **WHEN** 安装方式为 npm/pnpm/yarn/bun 且渠道为 `stable` 时
- **THEN** 目标版本仍从 `https://cz-cli.ai/api/stable` 获取，不查询 npm 仓库进行版本解析

#### Scenario: 包管理器升级接收已解析的渠道

- **WHEN** 安装方式为 npm/pnpm/yarn/bun 且已解析的发布渠道为 `nightly` 时
- **THEN** 包管理器升级命令以 `CZ_CHANNEL=nightly` 执行
- **且** npm `postinstall.js` 持久化 `channel` = `nightly`

#### Scenario: npm 缺少已解析的版本

- **WHEN** 渠道解析的版本尚未发布到 npm 仓库时
- **THEN** 包管理器升级可能失败，系统回退到该渠道的安装脚本

### Requirement: 显式目标版本允许降级

本需求 MUST 按以下场景执行。

当用户显式指定目标版本时，安装和更新入口应按该目标版本执行安装，即使当前已安装版本更新。该行为用于回滚和复现历史版本。只有自动解析渠道最新版本的路径应保留“目标版本必须更新”的判断，避免渠道指针意外回退导致静默降级。

#### Scenario: install.sh 显式版本允许降级

- **WHEN** 当前已安装版本为 `1.0.20` 且用户执行 `curl -fsSL https://cz-cli.ai/install | bash -s -- --version 1.0.18` 时
- **THEN** 安装器继续安装 `1.0.18`
- **AND** 不因当前版本更新而跳过安装
- **AND** 历史版本安装资产解析遵守 release-channel 规格中的 `META-INF/releases/<version>/manifest.json` 与 presigned archive URL 契约

#### Scenario: update 显式 target 允许降级

- **WHEN** 当前已安装版本为 `1.0.20` 且用户执行 `cz-cli update -t 1.0.18` 时
- **THEN** update 命令继续安装 `1.0.18`
- **AND** 不返回 `refuse_downgrade`
- **AND** update 入口不得自行拼接 COS 公开 URL 或直接读取 versioned COS 对象

#### Scenario: Windows update 显式 target 使用 versioned PowerShell 安装入口

- **WHEN** Windows 用户执行 `cz-cli update -t 1.0.18` 时
- **THEN** update 命令下载 `https://cz-cli.ai/install.ps1?version=1.0.18`
- **AND** 不下载未带 version 查询参数的 `https://cz-cli.ai/install.ps1` 作为目标版本安装脚本
- **AND** 官网安装入口读取 `META-INF/releases/1.0.18/manifest.json`
- **AND** PowerShell 安装脚本通过 `/download/1.0.18/win32-x64` 间接使用 manifest 内记录的 presigned archive URL

#### Scenario: 自动解析版本不静默降级

- **WHEN** 当前已安装版本为 `1.0.20` 且渠道最新版本解析为 `1.0.18`，用户未显式指定目标版本时
- **THEN** update 命令拒绝降级
- **AND** 提示用户使用 `--target` 显式指定回滚版本

### Requirement: 自动更新顶级命令

本需求 MUST 按以下场景执行。

自动更新开关属于自动更新自身状态，不应放在通用 `config` 顶级命令或 ClickZetta profile/连接配置下，以免边界混淆。CLI 应提供专用顶级命令写入自动更新状态文件 `~/.local/state/clickzetta/update-check.json` 的 `autoupdate` 字段，并复用自动更新状态读取逻辑。允许值为 `true`、`false`、`notify`；其中 `false` 关闭自动检查和自动升级，`notify` 仅提示不升级。命令名为 `autoupdate`，不提供 `auto-update` 别名。

#### Scenario: 关闭自动更新

- **WHEN** 用户执行 `cz-cli autoupdate false`
- **THEN** `~/.local/state/clickzetta/update-check.json` 写入 `"autoupdate": false`
- **AND** 后续自动更新路径跳过检查

#### Scenario: 调整自动更新时不先触发自动更新

- **WHEN** 用户执行 `cz-cli autoupdate false` 时
- **THEN** CLI 不在执行该命令前触发自动更新检查
- **AND** 用户可以在当前版本上完成关闭操作

#### Scenario: 不写入通用配置文件

- **WHEN** 用户执行 `cz-cli autoupdate notify` 时
- **THEN** CLI 只写入 `~/.local/state/clickzetta/update-check.json`
- **AND** 不创建或修改 `~/.clickzetta/czcli.json`、`~/.clickzetta/profiles.toml` 或 `install.json`

#### Scenario: 不提供 auto-update 别名

- **WHEN** 用户执行 `cz-cli auto-update false` 时
- **THEN** CLI 将其视为未知命令

#### Scenario: 查看自动更新配置

- **WHEN** 用户执行 `cz-cli autoupdate`
- **THEN** 输出当前 `autoupdate` 配置值
- **AND** 如果未配置则输出默认值 `true`

#### Scenario: 非 dev 版本发现更新时提示关闭方式

- **WHEN** stable semver 安装发现可用更新时
- **THEN** 自动更新提示包含 `cz-cli autoupdate false`

### Requirement: 双文件更新状态模型

本需求 MUST 按以下场景执行。

系统应维护两个独立文件。`~/.clickzetta/install.json` 是渠道/身份记忆，由每次安装和更新入口写入。`~/.local/state/clickzetta/update-check.json`（XDG state）由自动更新路径和 `cz-cli autoupdate` 写入，记录 `autoupdate`、`last_checked_at`、`last_result`、`latest_version` 和 `error`。判断自动更新是否发生应依赖 `update-check.json`，而非 `install.json.updated_at`。

#### Scenario: 手动更新不写入自动更新状态文件

- **WHEN** 用户运行 `cz-cli update` 时
- **THEN** `install.json` 被更新但 `update-check.json` 不被写入

#### Scenario: 自动更新记录其活动

- **WHEN** 自动更新路径执行检查时
- **THEN** `update-check.json` 被写入，包含 `last_checked_at` 和 `last_result`

#### Scenario: 自动更新状态写入保留开关

- **WHEN** `update-check.json` 已包含 `"autoupdate": "notify"` 且自动更新路径写入检查结果时
- **THEN** 写入后的 `update-check.json` 仍保留 `"autoupdate": "notify"`

### Requirement: 通知与升级

本需求 MUST 按以下场景执行。

当有更新版本可用时，如果安装方式为受支持的托管方式之一（`curl`、`npm`、`pnpm`、`yarn`、`bun`）且自动更新已启用，系统应执行自动就地升级；否则应通知用户有更新可用。

#### Scenario: 不受支持的方式执行通知

- **WHEN** 有更新版本可用但安装方式不受支持时
- **THEN** 解析的操作为 `notify`

#### Scenario: 仅通知配置

- **WHEN** `autoupdate` 配置为 `notify` 时
- **THEN** 通知用户有可用更新，不执行自动升级

#### Scenario: 安装脚本失败时输出诊断内容

- **WHEN** `cz-cli update` 通过安装脚本升级且脚本以非零状态退出时
- **THEN** 错误信息包含退出码
- **AND** 错误信息包含安装脚本 stderr/stdout 中的诊断摘要

#### Scenario: Windows 手动恢复命令使用 PowerShell

- **WHEN** Windows 用户运行 `cz-cli update` 且自动升级失败或无法检查版本时
- **THEN** 手动恢复提示使用 PowerShell `install.ps1` 命令
- **AND** 不提示 Unix `curl | bash` 命令

#### Scenario: Windows 自动升级使用 PowerShell 安装脚本

- **WHEN** Windows 用户通过 `cz-cli update` 使用安装脚本升级时
- **THEN** 自动升级下载 `install.ps1` 或 `install-nightly.ps1`
- **AND** 使用 PowerShell 执行安装脚本，而不是 Unix `sh`

### Requirement: 安装方式检测优先使用 which 路径

本需求 MUST 按以下场景执行。

安装方式检测（`resolveUpdateInstallMethod`）应以 `which cz-cli` 解析的路径为首要判断依据，而非 `process.execPath`。这确保升级命令作用于用户实际执行的 binary 位置。仅当 `which` 结果无法识别时，才 fallback 到 `process.execPath`。

#### Scenario: which 路径为 npm 全局安装

- **WHEN** `which cz-cli` 解析到 npm prefix 下的路径或其 symlink 目标含 `node_modules` 时
- **THEN** 安装方式为 `npm`，使用 `npm install -g` 升级

#### Scenario: which 路径为 install.sh 安装

- **WHEN** `which cz-cli` 解析到 `~/.local/bin/` 时
- **THEN** 安装方式为 `curl`，使用 install.sh 升级

#### Scenario: 路径无法 realpath 时仍识别为自管安装

- **WHEN** 当前 binary 路径为 `~/.local/bin/cz-cli` 且路径暂时无法解析 realpath 时
- **THEN** 安装方式仍为 `curl`，不因 realpath 失败退化为 `unknown`

#### Scenario: macOS 路径大小写不一致时仍识别为自管安装

- **WHEN** 当前 binary 路径为 `~/.Local/bin/cz-cli` 这类大小写不同的自管安装路径时
- **THEN** 安装方式仍为 `curl`，不因路径大小写差异退化为 `unknown`

#### Scenario: realpath 后 HOME 路径前缀变化时仍识别为自管安装

- **WHEN** 当前 binary 的 realpath 与 HOME 路径前缀写法不同（例如 symlink 或 macOS `/var` 与 `/private/var`）时
- **THEN** 安装方式仍为 `curl`，不因路径规范化差异退化为 `unknown`

#### Scenario: which 无法识别时 fallback 到 execPath

- **WHEN** `which cz-cli` 路径既非包管理器安装也非 install.sh 安装时
- **THEN** 使用 `process.execPath` 作为判断依据

### Requirement: 升级前事前清除遮蔽 binary

本需求 MUST 按以下场景执行。

在执行升级之前，系统应检测 `which cz-cli` 解析的路径是否会遮蔽新安装的 binary。如果该路径不在我们管理的安装目录中，应在升级前通过适当方式移除它，确保升级完成后 `which cz-cli` 立即指向新版本。

`install.sh` 和 `update.ts` 共享相同的二步抽象：

1. **`is_package_manager_binary` / `isPackageManagerBinary`** — 判断路径是否为包管理器安装（路径或 symlink 目标含 `node_modules`、`.bun`、或在 npm prefix 下）
2. **`remove_shadowing_binary` / `removeStaleBinary`** — 根据类型选择清理方式：npm 全局用 `npm uninstall -g`，bun 全局用 `bun remove -g`，普通文件用 `rm -f` / `unlinkSync`

#### Scenario: npm binary 遮蔽 install.sh 安装

- **WHEN** `which cz-cli` 指向 npm 全局 binary 且升级 fallback 到 install.sh 时
- **THEN** 升级前执行 `npm uninstall -g @clickzetta/cz-cli` 移除遮蔽 binary

#### Scenario: bun binary 遮蔽

- **WHEN** `which cz-cli` 指向 bun 全局 binary 时
- **THEN** 升级前执行 `bun remove -g @clickzetta/cz-cli` 移除遮蔽 binary

#### Scenario: PATH 中的 cz-cli 不可用

- **WHEN** `which cz-cli` 解析到某个路径但该路径执行 `cz-cli --version` 失败或无输出时
- **THEN** 安装或升级必须失败
- **AND** 错误信息提示用户清理该 PATH 项或删除损坏文件
- **AND** 安装或升级不得基于该不可用路径继续清理其他 binary

#### Scenario: install.sh 同样事前清除

- **WHEN** `scripts/install.sh` 运行且 `which -a cz-cli` 包含非 `$INSTALL_DIR` 的路径时
- **THEN** 对每个遮蔽 binary，若为 npm/bun 安装则执行对应 `uninstall -g`，否则 `rm -f`，确保安装后 `which` 指向新 binary

#### Scenario: check_version 仅对自管路径生效

- **WHEN** `command -v cz-cli` 指向非 `$INSTALL_DIR` 的路径时
- **THEN** `check_version` 不做版本比较，不跳过安装

### Requirement: 升级后 binary 位置一致性

本需求 MUST 按以下场景执行。

`cz-cli update` 通过 install.sh 升级时，新 binary 必须最终出现在 `which cz-cli` 解析的路径上。由于线上旧版 install.sh 可能安装到不同目录（如 `~/.local/bin`），update 命令应：

1. 通过 `CZ_INSTALL_DIR` 环境变量告知 install.sh 安装到当前 binary 目录（新版 install.sh 支持）
2. 升级后验证 `which cz-cli --version` 是否为目标版本，若不是则从已知候选路径（`~/.local/bin`）找到新 binary 并拷贝到 `which` 路径

#### Scenario: install.sh 安装到不同目录

- **WHEN** install.sh 将 binary 安装到与 `which cz-cli` 不同的目录时
- **THEN** update 命令将新 binary 拷贝到 `which cz-cli` 路径，确保版本一致

#### Scenario: 升级后 restart binary 不可用

- **WHEN** 自动更新执行安装脚本后，原重启路径和已知候选路径都无法执行目标版本 `cz-cli --version`
- **THEN** 自动更新必须记录为 `upgrade-failed`
- **AND** 不得写入 `upgrade-succeeded` 或重启用户命令

#### Scenario: 自动更新恢复重启路径

- **WHEN** 自动更新通过 install.sh 完成升级但原 `process.execPath` 路径已被清理或不是目标版本时
- **THEN** 自动更新从已知自管安装目录找到目标版本 binary 并拷贝回原重启路径

#### Scenario: 重启时首次执行被 SIGKILL

- **WHEN** 自动更新完成后重启命令且首次执行新 binary 被系统以 `SIGKILL` 终止时
- **THEN** 自动更新仅重试一次重启命令，并使用重试后的退出码作为最终退出码

#### Scenario: 重启命令自身失败

- **WHEN** 重启后的用户命令正常返回非零退出码时
- **THEN** 自动更新不将该退出码改写为 `0`

#### Scenario: CZ_INSTALL_DIR 覆盖安装目录

- **WHEN** `CZ_INSTALL_DIR` 环境变量被设置时
- **THEN** install.sh 使用该值作为安装目录而非默认的 `$HOME/.local/bin`

### Requirement: cz-agent 便捷 wrapper 安装位置一致

本需求 MUST 按以下场景执行。

所有安装方式安装 `cz-agent` 便捷 wrapper 时，必须使用与主 binary 一致的、位于 PATH 上的自管目录 `~/.local/bin`，不得使用已废弃的 `~/.cz-cli/bin`。`install.sh` 和 `setup.sh` 将其写入 `${INSTALL_DIR}`（默认 `~/.local/bin`），npm postinstall 同样写入 `~/.local/bin`。

#### Scenario: npm postinstall 安装 cz-agent wrapper

- **WHEN** npm 包的 postinstall 脚本执行完成时
- **THEN** `cz-agent` wrapper 被写入 `~/.local/bin/cz-agent` 并具有可执行权限

#### Scenario: 不再使用废弃的 .cz-cli/bin 目录

- **WHEN** npm postinstall 安装 `cz-agent` wrapper 时
- **THEN** 不在 `~/.cz-cli/bin` 下创建 `cz-agent`

### Requirement: Windows PowerShell 安装入口兼容默认系统 shell

本需求 MUST 按以下场景执行。

Windows `install.ps1` 安装入口必须使用 Windows PowerShell 5.1 可解析的语法，并必须提供不依赖 `irm` alias 的兼容下载执行命令。

#### Scenario: Windows PowerShell 5.1 可解析安装脚本

- **WHEN** 用户在 Windows PowerShell 5.1 中下载并执行 `install.ps1`
- **THEN** 脚本解析阶段不因 PowerShell 7 专用语法失败

#### Scenario: 旧 PowerShell 无 irm alias 时仍有安装命令

- **WHEN** 用户环境中不存在 `irm` alias
- **THEN** 安装说明提供基于 `Net.WebClient.DownloadString` 的命令执行 `install.ps1`

### Requirement: Windows 安装成功后注册 User PATH

本需求 MUST 按以下场景执行。

Windows `install.ps1` 安装成功后必须将安装目录注册到当前用户 PATH，并必须同步当前 PowerShell 进程的 `$env:Path`。如果 PATH 注册失败，脚本必须保留已安装 binary 并输出手动修复提示。

#### Scenario: 默认安装目录写入 User PATH

- **WHEN** `install.ps1` 将 `cz-cli.exe` 安装到默认目录 `$HOME\.local\bin` 且该目录不在 User PATH 中
- **THEN** 脚本将该目录追加到 User PATH
- **AND** 写入 PATH 的目录使用 Windows 本地路径格式而不是 `$HOME\.local/bin` 这类混合分隔符格式
- **AND** 当前 PowerShell 进程可通过 `cz-cli` 解析到安装目录中的 binary

#### Scenario: INSTALL_DIR 覆盖目录写入 User PATH

- **WHEN** `INSTALL_DIR` 环境变量指定自定义安装目录且该目录不在 User PATH 中
- **THEN** 脚本将该自定义目录追加到 User PATH

#### Scenario: 已安装 binary 但 PATH 缺失时重跑安装器

- **WHEN** `$HOME\.local\bin\cz-cli.exe` 已经是目标版本但该目录不在 User PATH 或当前进程 PATH 中
- **THEN** 脚本将该目录追加到 User PATH
- **AND** 当前 PowerShell 进程可通过 `cz-cli` 解析到安装目录中的 binary
- **AND** 脚本不重新下载安装包

#### Scenario: PATH 已包含安装目录时不重复追加

- **WHEN** User PATH 已包含大小写不同或带尾随分隔符的安装目录
- **THEN** 脚本不重复追加该目录
