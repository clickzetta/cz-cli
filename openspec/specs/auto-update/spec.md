# auto-update 规格说明

## 目的
定义 cz-cli 何时自动更新自身、发布渠道如何选择更新流（版本来源和安装机制）、双文件更新状态模型，以及通知与升级行为。

## 需求
### 需求：自动更新不受渠道限制

自动更新应在任何真实安装上运行，不受发布渠道影响。启用条件由以下因素决定：更新未被禁用（通过配置 `autoupdate: false` 或环境变量 `CLICKZETTA_DISABLE_AUTOUPDATE` / `CZ_SKIP_UPDATE` / 一次性 `CLICKZETTA_SKIP_UPDATE_ONCE`），命令不在跳过列表中（`setup`、`update`、`uninstall`、`--help`/`-h`、`--version`/`-v`），已安装版本为有效 semver，安装方式受支持，且检查间隔已到期。渠道值不应决定自动更新是否运行。

#### 场景：Stable 安装执行升级

- **当** `stable` 安装具有受支持的方式、有效的当前版本、可用的更新版本且间隔已到期时
- **则** 解析的操作为 `upgrade`

#### 场景：Dev/本地构建被跳过

- **当** 已安装版本不是有效 semver（例如 `local` 开发构建）时
- **则** 自动更新被跳过

#### 场景：真实安装在任何渠道下都不被跳过

- **当** 命令为正常命令、未设置跳过环境变量且版本为有效 semver 时
- **则** 自动更新不被跳过，与渠道无关

### 需求：渠道选择更新流；安装方式不选择版本

发布渠道应是目标版本的唯一来源，始终从 cz-cli.ai 解析：`stable` 来自 `https://cz-cli.ai/api/stable`，`nightly` 来自 `https://cz-cli.ai/api/nightly`。安装方式不应影响版本解析——它仅选择升级机制（`stable` → `install.sh`；`nightly` → `install-nightly.sh`；托管包管理器使用其自身的安装命令）。特别地，版本解析不应查询 npm 仓库的 `latest` dist-tag，即使安装方式为 npm/pnpm/yarn/bun。`stable` 和 `nightly` 均可自动升级。

#### 场景：Stable 流端点

- **当** 发布渠道为 `stable` 时
- **则** 最新版本从 `https://cz-cli.ai/api/stable` 获取，升级使用 stable 安装脚本

#### 场景：Nightly 流端点

- **当** 发布渠道为 `nightly` 时
- **则** 最新版本从 `https://cz-cli.ai/api/nightly` 获取，升级使用 nightly 安装脚本

#### 场景：npm 安装方式不改变版本来源

- **当** 安装方式为 npm/pnpm/yarn/bun 且渠道为 `stable` 时
- **则** 目标版本仍从 `https://cz-cli.ai/api/stable` 获取，不查询 npm 仓库进行版本解析

#### 场景：包管理器升级接收已解析的渠道

- **当** 安装方式为 npm/pnpm/yarn/bun 且已解析的发布渠道为 `nightly` 时
- **则** 包管理器升级命令以 `CZ_CHANNEL=nightly` 执行
- **且** npm `postinstall.js` 持久化 `channel` = `nightly`

#### 场景：npm 缺少已解析的版本

- **当** 渠道解析的版本尚未发布到 npm 仓库时
- **则** 包管理器升级可能失败，系统回退到该渠道的安装脚本

### 需求：双文件更新状态模型

系统应维护两个独立文件。`~/.clickzetta/install.json` 是渠道/身份记忆，由每次安装和更新入口写入。`~/.local/state/clickzetta/update-check.json`（XDG state）仅由自动更新路径写入，记录 `last_checked_at`、`last_result` 和 `latest_version`。判断自动更新是否发生应依赖 `update-check.json`，而非 `install.json.updated_at`。

#### 场景：手动更新不写入自动更新状态文件

- **当** 用户运行 `cz-cli update` 时
- **则** `install.json` 被更新但 `update-check.json` 不被写入

#### 场景：自动更新记录其活动

- **当** 自动更新路径执行检查时
- **则** `update-check.json` 被写入，包含 `last_checked_at` 和 `last_result`

### 需求：通知与升级

当有更新版本可用时，如果安装方式为受支持的托管方式之一（`curl`、`npm`、`pnpm`、`yarn`、`bun`）且自动更新已启用，系统应执行自动就地升级；否则应通知用户有更新可用。

#### 场景：不受支持的方式执行通知

- **当** 有更新版本可用但安装方式不受支持时
- **则** 解析的操作为 `notify`

#### 场景：仅通知配置

- **当** `autoupdate` 配置为 `notify` 时
- **则** 通知用户有可用更新，不执行自动升级
