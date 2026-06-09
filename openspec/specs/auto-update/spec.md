# auto-update 规格说明

## 目的
定义 cz-cli 何时自动更新自身、发布渠道如何选择更新流（版本来源和安装机制）、双文件更新状态模型，以及通知与升级行为。

## 需求
### 需求：自动更新不受渠道限制

自动更新应在任何真实安装上运行，不受发布渠道影响。启用条件由以下因素决定：更新未被禁用（通过配置 `autoupdate: false` 或环境变量 `CLICKZETTA_DISABLE_AUTOUPDATE` / `CZ_SKIP_UPDATE` / 一次性 `CLICKZETTA_SKIP_UPDATE_ONCE`），命令不在跳过列表中（`setup`、`update`、`uninstall`、`--help`/`-h`、`--version`/`-v`），已安装版本为有效 semver，安装方式受支持，且检查间隔已到期。渠道值不应决定自动更新是否运行。

#### 场景：Stable 安装执行升级

- **WHEN** `stable` 安装具有受支持的方式、有效的当前版本、可用的更新版本且间隔已到期时
- **THEN** 解析的操作为 `upgrade`

#### 场景：Dev/本地构建被跳过

- **WHEN** 已安装版本不是有效 semver（例如 `local` 开发构建）时
- **THEN** 自动更新被跳过

#### 场景：真实安装在任何渠道下都不被跳过

- **WHEN** 命令为正常命令、未设置跳过环境变量且版本为有效 semver 时
- **THEN** 自动更新不被跳过，与渠道无关

### 需求：渠道选择更新流；安装方式不选择版本

发布渠道应是目标版本的唯一来源，始终从 cz-cli.ai 解析：`stable` 来自 `https://cz-cli.ai/api/stable`，`nightly` 来自 `https://cz-cli.ai/api/nightly`。安装方式不应影响版本解析——它仅选择升级机制（`stable` → `install.sh`；`nightly` → `install-nightly.sh`；托管包管理器使用其自身的安装命令）。特别地，版本解析不应查询 npm 仓库的 `latest` dist-tag，即使安装方式为 npm/pnpm/yarn/bun。`stable` 和 `nightly` 均可自动升级。

#### 场景：Stable 流端点

- **WHEN** 发布渠道为 `stable` 时
- **THEN** 最新版本从 `https://cz-cli.ai/api/stable` 获取，升级使用 stable 安装脚本

#### 场景：Nightly 流端点

- **WHEN** 发布渠道为 `nightly` 时
- **THEN** 最新版本从 `https://cz-cli.ai/api/nightly` 获取，升级使用 nightly 安装脚本

#### 场景：npm 安装方式不改变版本来源

- **WHEN** 安装方式为 npm/pnpm/yarn/bun 且渠道为 `stable` 时
- **THEN** 目标版本仍从 `https://cz-cli.ai/api/stable` 获取，不查询 npm 仓库进行版本解析

#### 场景：包管理器升级接收已解析的渠道

- **WHEN** 安装方式为 npm/pnpm/yarn/bun 且已解析的发布渠道为 `nightly` 时
- **THEN** 包管理器升级命令以 `CZ_CHANNEL=nightly` 执行
- **且** npm `postinstall.js` 持久化 `channel` = `nightly`

#### 场景：npm 缺少已解析的版本

- **WHEN** 渠道解析的版本尚未发布到 npm 仓库时
- **THEN** 包管理器升级可能失败，系统回退到该渠道的安装脚本

### 需求：双文件更新状态模型

系统应维护两个独立文件。`~/.clickzetta/install.json` 是渠道/身份记忆，由每次安装和更新入口写入。`~/.local/state/clickzetta/update-check.json`（XDG state）仅由自动更新路径写入，记录 `last_checked_at`、`last_result` 和 `latest_version`。判断自动更新是否发生应依赖 `update-check.json`，而非 `install.json.updated_at`。

#### 场景：手动更新不写入自动更新状态文件

- **WHEN** 用户运行 `cz-cli update` 时
- **THEN** `install.json` 被更新但 `update-check.json` 不被写入

#### 场景：自动更新记录其活动

- **WHEN** 自动更新路径执行检查时
- **THEN** `update-check.json` 被写入，包含 `last_checked_at` 和 `last_result`

### 需求：通知与升级

当有更新版本可用时，如果安装方式为受支持的托管方式之一（`curl`、`npm`、`pnpm`、`yarn`、`bun`）且自动更新已启用，系统应执行自动就地升级；否则应通知用户有更新可用。

#### 场景：不受支持的方式执行通知

- **WHEN** 有更新版本可用但安装方式不受支持时
- **THEN** 解析的操作为 `notify`

#### 场景：仅通知配置

- **WHEN** `autoupdate` 配置为 `notify` 时
- **THEN** 通知用户有可用更新，不执行自动升级

### 需求：安装方式检测优先使用 which 路径

安装方式检测（`resolveUpdateInstallMethod`）应以 `which cz-cli` 解析的路径为首要判断依据，而非 `process.execPath`。这确保升级命令作用于用户实际执行的 binary 位置。仅当 `which` 结果无法识别时，才 fallback 到 `process.execPath`。

#### 场景：which 路径为 npm 全局安装

- **WHEN** `which cz-cli` 解析到 npm prefix 下的路径或其 symlink 目标含 `node_modules` 时
- **THEN** 安装方式为 `npm`，使用 `npm install -g` 升级

#### 场景：which 路径为 install.sh 安装

- **WHEN** `which cz-cli` 解析到 `~/.cz-cli/bin/` 或 `~/.local/bin/` 时
- **THEN** 安装方式为 `curl`，使用 install.sh 升级

#### 场景：which 无法识别时 fallback 到 execPath

- **WHEN** `which cz-cli` 路径既非包管理器安装也非 install.sh 安装时
- **THEN** 使用 `process.execPath` 作为判断依据

### 需求：升级前事前清除遮蔽 binary

在执行升级之前，系统应检测 `which cz-cli` 解析的路径是否会遮蔽新安装的 binary。如果该路径不在我们管理的安装目录中，应在升级前通过适当方式移除它，确保升级完成后 `which cz-cli` 立即指向新版本。

`install.sh` 和 `update.ts` 共享相同的二步抽象：

1. **`is_package_manager_binary` / `isPackageManagerBinary`** — 判断路径是否为包管理器安装（路径或 symlink 目标含 `node_modules`、`.bun`、或在 npm prefix 下）
2. **`remove_shadowing_binary` / `removeStaleBinary`** — 根据类型选择清理方式：npm 全局用 `npm uninstall -g`，bun 全局用 `bun remove -g`，普通文件用 `rm -f` / `unlinkSync`

#### 场景：npm binary 遮蔽 install.sh 安装

- **WHEN** `which cz-cli` 指向 npm 全局 binary 且升级 fallback 到 install.sh 时
- **THEN** 升级前执行 `npm uninstall -g @clickzetta/cz-cli` 移除遮蔽 binary

#### 场景：bun binary 遮蔽

- **WHEN** `which cz-cli` 指向 bun 全局 binary 时
- **THEN** 升级前执行 `bun remove -g @clickzetta/cz-cli` 移除遮蔽 binary

#### 场景：install.sh 同样事前清除

- **WHEN** `scripts/install.sh` 运行且 `which -a cz-cli` 包含非 `$INSTALL_DIR` 的路径时
- **THEN** 对每个遮蔽 binary，若为 npm/bun 安装则执行对应 `uninstall -g`，否则 `rm -f`，确保安装后 `which` 指向新 binary

#### 场景：check_version 仅对自管路径生效

- **WHEN** `command -v cz-cli` 指向非 `$INSTALL_DIR` 的路径时
- **THEN** `check_version` 不做版本比较，不跳过安装

### 需求：升级后 binary 位置一致性

`cz-cli update` 通过 install.sh 升级时，新 binary 必须最终出现在 `which cz-cli` 解析的路径上。由于线上旧版 install.sh 可能安装到不同目录（如 `~/.local/bin`），update 命令应：

1. 通过 `CZ_INSTALL_DIR` 环境变量告知 install.sh 安装到当前 binary 目录（新版 install.sh 支持）
2. 升级后验证 `which cz-cli --version` 是否为目标版本，若不是则从已知候选路径（`~/.cz-cli/bin`、`~/.local/bin`）找到新 binary 并拷贝到 `which` 路径

#### 场景：install.sh 安装到不同目录

- **WHEN** install.sh 将 binary 安装到与 `which cz-cli` 不同的目录时
- **THEN** update 命令将新 binary 拷贝到 `which cz-cli` 路径，确保版本一致

#### 场景：CZ_INSTALL_DIR 覆盖安装目录

- **WHEN** `CZ_INSTALL_DIR` 环境变量被设置时
- **THEN** install.sh 使用该值作为安装目录而非默认的 `$HOME/.cz-cli/bin`
