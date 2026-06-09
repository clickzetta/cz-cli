# release-channel 规格说明

## 目的
定义 cz-cli 的发布渠道（`stable`/`nightly`）：其允许的值和默认值、解析优先级、与 opencode 的 `InstallationChannel` 的隔离，以及每个安装/更新入口必须持久化的 `install.json` schema。

## 需求
### 需求：发布渠道与 opencode InstallationChannel 隔离

cz-cli 应维护一个独立于 opencode 构建时 `InstallationChannel` 常量的发布渠道概念。发布渠道不得从 `InstallationChannel` 派生，更新子系统不得读取 `InstallationChannel` 来确定发布流。opencode 的 `InstallationChannel` 及其消费者（按渠道区分的数据库路径、遥测 `deployment.environment.name`、`isLocal()`/`isPreview()`、插件版本固定）必须不受影响。

#### 场景：更新子系统不引用 InstallationChannel

- **当** 更新/自动更新代码解析发布渠道时
- **则** 值从 `CZ_CHANNEL`、`install.json` 或默认值计算得出，而非从 `InstallationChannel`

#### 场景：opencode 渠道消费者不变

- **当** 发布渠道在 `stable` 和 `nightly` 之间切换时
- **则** 由 `InstallationChannel` 派生的 SQLite 数据库路径、遥测环境和开发模式检测保持不变

### 需求：允许的渠道值和默认值

发布渠道应为 `stable` 或 `nightly` 之一。`stable` 应为所有面向用户安装的默认值。未知或遗留值（例如 `latest`）在读取时应强制转换为 `stable`。

#### 场景：未知值强制转换为 stable

- **当** `install.json` 包含 `"channel": "latest"` 时
- **则** 解析的发布渠道为 `stable`

#### 场景：未设置时的默认值

- **当** 未设置 `CZ_CHANNEL` 环境变量且 `install.json` 无可用渠道时
- **则** 解析的发布渠道为 `stable`

### 需求：渠道解析优先级

发布渠道的解析优先级为：`CZ_CHANNEL` 环境变量，然后 `~/.clickzetta/install.json` 中的 `channel`，然后 `stable`。

#### 场景：环境变量覆盖 install.json

- **当** `install.json` 有 `"channel": "nightly"` 且设置了 `CZ_CHANNEL=stable` 时
- **则** 解析的发布渠道为 `stable`

#### 场景：环境变量未设置时使用 install.json

- **当** `CZ_CHANNEL` 未设置且 `install.json` 有 `"channel": "nightly"` 时
- **则** 解析的发布渠道为 `nightly`

### 需求：install.json schema 和持久化契约

每个安装或更新入口——打包的 `setup.sh`、`scripts/install.sh`、npm `postinstall.js`、`cz-cli update` 命令和自动更新路径——应创建或更新 `~/.clickzetta/install.json`。文件应包含 `version`（元数据 schema 版本，当前为 `1`）、`installed_path`、`channel`、`binary_version` 和 `updated_at`。`version` 字段为元数据 schema 版本，与 `binary_version`（cz-cli 程序版本）不同；更改文件结构应递增 `version`。

#### 场景：setup.sh 持久化渠道

- **当** `setup.sh` 在设置了 `CZ_VERSION` 且未设置 `CZ_CHANNEL` 的情况下运行时
- **则** `install.json` 写入 `channel` = `stable` 和 `binary_version` = 已安装版本

#### 场景：CZ_CHANNEL 覆盖被持久化

- **当** `setup.sh` 以 `CZ_CHANNEL=nightly` 运行时
- **则** `install.json` 写入 `channel` = `nightly`

#### 场景：npm postinstall 持久化显式渠道

- **当** npm `postinstall.js` 以 `CZ_CHANNEL=nightly` 运行时
- **则** `install.json` 写入 `channel` = `nightly`

#### 场景：scripts install 使用渠道进行版本解析

- **当** `scripts/install.sh` 在未指定显式版本且 `CZ_CHANNEL=nightly` 的情况下运行时
- **则** 已安装的 `binary_version` 从 `https://cz-cli.ai/api/nightly` 解析
- **且** `install.json` 写入 `channel` = `nightly`

#### 场景：更新的渠道在写入时被保留

- **当** 调用 `writeInstallMetadata` 且 `install.json` 已有 `channel` 时
- **则** 现有渠道被保留，除非提供了显式渠道，且永远不被 `InstallationChannel` 替换

#### 场景：更新写入已解析的渠道

- **当** `cz-cli update` 或自动更新路径在解析 `channel` = `nightly` 后完成升级时
- **则** `install.json` 写入 `channel` = `nightly`
