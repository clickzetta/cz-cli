# skill-install 规格说明

## 目的
定义 cz-cli 在安装/更新时如何分发其捆绑的 skill：

1. **内置 skill**（builtin）——供 cz-cli 自身的 agent 内核发现使用，安装到 `~/.clickzetta/skills/.builtin/`。
2. **外部 agent skill**（external-agent registration）——将名为 `cz-cli` 的 skill 注册给其它 AI 编码助手（Claude Code、Kiro、Codex、Cursor 等），安装到这些 agent 的 skill 目录下，使它们可以直接调用 cz-cli 操作 Lakehouse。

本规格覆盖三条安装入口：npm `postinstall.js`、`scripts/install.sh`（curl 安装）、`scripts/setup.sh`（手动/归档安装）。`cz-cli update` 不直接分发 skill，而是通过重新运行 install.sh 或包管理器（触发 `postinstall.js`）继承上述行为。

## 术语
- **捆绑 skill 源目录**：安装介质中包含各 skill 子目录（每个子目录含 `SKILL.md`）的 `skills/` 目录。`build.ts` 会把仓库 `skills/*`（含 `skills/cz-cli`）打包进每个平台产物的 `bin/skills/`。
- **归档根目录**：GitHub Release 平台归档解压后的顶层目录。所有平台归档均应直接包含二进制文件、`setup.sh`（如适用）和 `skills/`，不得额外包裹 `bin/` 目录。
- **外部 agent skill 目录**：
  - `~/.claude/skills`
  - `~/.kiro/skills`
  - `~/.cursor/skills`
  - `~/.codex/skills`
  - `~/.openclaw/workspace/skills`
  - `~/.singclaw/workspace/skills`
- **外部注册 skill 名单**：当前为 `cz-cli`（即 `skills/cz-cli`）。

## 需求

### 需求：内置 skill 安装到 .builtin（行为保持不变）

所有安装入口应在每次安装/更新时，先整体清空 `~/.clickzetta/skills/.builtin/`，再用全部捆绑 skill 重新填充。此行为不受外部 agent 注册逻辑影响而改变。

#### 场景：清空后重新填充内置 skill

- **WHEN** 安装介质中存在捆绑 skill 源目录，且 `~/.clickzetta/skills/.builtin/` 中存在上一次安装遗留的 skill 时
- **THEN** `.builtin/` 被整体清空，仅包含本次捆绑的全部 skill（遗留 skill 不再保留）

#### 场景：无捆绑 skill 时仍清空内置目录

- **WHEN** 安装介质中不存在任何捆绑 skill 时
- **THEN** `~/.clickzetta/skills/.builtin/` 仍存在且被清空，不残留旧 skill

#### 场景：Windows Release 归档保留顶层 skills

- **WHEN** 构建 Windows Release zip 归档时，平台 dist 的 `bin/skills/cz-cli/SKILL.md` 已存在
- **THEN** 解压该 zip 后顶层直接包含 `skills/cz-cli/SKILL.md`，install.sh、setup.sh 和 npm 发布准备脚本均可按同一目录结构发现捆绑 skill

#### 场景：Windows npm 平台包包含捆绑 skills

- **WHEN** npm 发布脚本处理 `cz-cli-windows-x64` artifact 且 artifact 中存在 `bin/skills/cz-cli/SKILL.md`
- **THEN** 生成的 `@clickzetta/cz-cli-win32-x64` 平台包在 `bin/skills/cz-cli/SKILL.md` 中包含同一份捆绑 skill，postinstall 可安装 `.builtin` 与外部 agent skill

#### 场景：Windows PowerShell 原生安装内置 skill

- **WHEN** 用户在 Windows PowerShell/CMD 原生环境执行 COS 发布的 `install.ps1`，且下载归档中包含顶层 `skills/` 目录
- **THEN** PowerShell 安装器不依赖 `setup.sh` 或 bash，也会清空并重新填充 `$HOME/.clickzetta/skills/.builtin/`

### 需求：将 cz-cli skill 注册到外部 agent 目录（先删除再安装）

当捆绑 skill 中存在外部注册名单中的 skill（当前为 `cz-cli`）时，每个安装入口应将该 skill 安装到全部外部 agent skill 目录。安装采用「先删除再安装」语义：对每个目标目录，先确保目录存在，再删除该目录下同名 skill 子目录，最后整体复制捆绑源中的该 skill。该操作必须是幂等的，且单个目录失败不应中断其余目录或整个安装流程。

#### 场景：注册到所有外部 agent 目录

- **WHEN** 捆绑 skill 中包含 `cz-cli` 且执行任一安装入口时
- **THEN** `~/.claude/skills/cz-cli`、`~/.kiro/skills/cz-cli`、`~/.cursor/skills/cz-cli`、`~/.codex/skills/cz-cli`、`~/.openclaw/workspace/skills/cz-cli`、`~/.singclaw/workspace/skills/cz-cli` 均存在且内容来自捆绑源（包含 `SKILL.md`）

#### 场景：Windows PowerShell 原生注册外部 agent skill

- **WHEN** 用户在 Windows PowerShell/CMD 原生环境执行 COS 发布的 `install.ps1`，且下载归档中包含 `skills/cz-cli/SKILL.md`
- **THEN** PowerShell 安装器不依赖 `setup.sh` 或 bash，也会将 `cz-cli` skill 注册到全部外部 agent skill 目录

#### 场景：先删除再安装覆盖旧内容

- **WHEN** 某外部 agent 目录下已存在旧版本 `cz-cli` skill（例如残留的过期 `SKILL.md` 或多余文件）时
- **THEN** 该目录下的旧 `cz-cli` 被整体删除后再写入新内容，不残留旧文件

#### 场景：目标父目录不存在时自动创建

- **WHEN** 用户尚未安装某个 agent（对应 skill 目录不存在）时
- **THEN** 安装入口创建该 skill 目录并写入 `cz-cli` skill，不因目录缺失而报错

#### 场景：捆绑源缺少 cz-cli 时不进行外部注册

- **WHEN** 捆绑 skill 源目录中不存在 `cz-cli` 时
- **THEN** 不向任何外部 agent 目录写入 `cz-cli`，且安装流程正常完成

#### 场景：单个目录失败不影响整体

- **WHEN** 写入某个外部 agent 目录因权限等原因失败时
- **THEN** 其余外部 agent 目录的安装继续进行，且整个安装/更新流程不被中断（npm postinstall 不致使 `npm install` 失败）

### 需求：清理废弃的旧 skill 名称

历史版本曾以 `czagent`、`czcli`、`cz-cli-v2` 等名称注册 skill。安装入口应从所有外部 agent 目录中删除这些废弃名称的 skill，但不重新安装它们（它们已被统一为 `cz-cli`）。

#### 场景：删除废弃别名

- **WHEN** 外部 agent 目录中存在 `czagent` / `czcli` / `cz-cli-v2` 等废弃名称的 skill 时
- **THEN** 这些废弃 skill 被删除，且不会被重新创建

### 需求：update 命令继承安装入口的 skill 分发行为

`cz-cli update` 不应自行实现 skill 分发逻辑。它通过重新运行 install.sh（curl 安装方式）或包管理器升级命令（npm/bun/pnpm/yarn 安装方式，触发 `postinstall.js`）来完成升级，从而自动继承内置 skill 与外部 agent skill 的安装行为。

#### 场景：curl 安装方式的更新

- **WHEN** 安装方式为 `curl` 且执行 `cz-cli update` 时
- **THEN** 重新运行的 install.sh 同时完成 `.builtin` 内置 skill 安装与 `cz-cli` 外部 agent 注册

#### 场景：包管理器安装方式的更新

- **WHEN** 安装方式为 npm/bun/pnpm/yarn 且执行 `cz-cli update` 时
- **THEN** 包管理器重新安装触发 `postinstall.js`，完成 `.builtin` 内置 skill 安装与 `cz-cli` 外部 agent 注册
