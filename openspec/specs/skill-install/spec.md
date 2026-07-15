# skill-install 规格说明

## Purpose
定义 cz-cli 在安装/更新时如何分发其捆绑的 skill：

1. **内置 skill**（builtin）——供 cz-cli 自身的 agent 内核发现使用，安装到 `~/.clickzetta/skills/.builtin/`。

外部 AI 编码助手（Claude Code、Cursor、Codex 等）**不再**通过自动安装 skill 接入 cz-cli；它们改由 MCP 集成——用户运行 `cz-cli mcp init` 将 cz-cli 注册为 MCP server。安装入口不再向外部 agent skill 目录写入 `cz-cli` skill，只负责清理历史遗留（见「清理外部 agent 目录遗留 skill」需求）。

本规格覆盖三条安装入口：npm `postinstall.js`、`scripts/install.sh`（curl 安装）、`scripts/setup.sh`（手动/归档安装）。`cz-cli update` 不直接分发 skill，而是通过重新运行 install.sh 或包管理器（触发 `postinstall.js`）继承上述行为。

## 术语
- **捆绑 skill 源目录**：安装介质中包含各 skill 子目录（每个子目录含 `SKILL.md`）的 `skills/` 目录。`build.ts` 会把仓库 `skills/*` 打包进每个平台产物的 `bin/skills/`。
- **归档根目录**：GitHub Release 平台归档解压后的顶层目录。所有平台归档均应直接包含二进制文件、`setup.sh`（如适用）和 `skills/`，不得额外包裹 `bin/` 目录。
- **外部 agent skill 目录**（仅用于清理遗留）：
  - `~/.claude/skills`
  - `~/.agents/skills`
  - `~/.kiro/skills`
  - `~/.cursor/skills`
  - `~/.codex/skills`
  - `~/.openclaw/workspace/skills`
  - `~/.singclaw/workspace/skills`
- **待清理 skill 名单**：`cz-cli` 及历史别名 `czagent`、`czcli`、`cz-cli-v2`。

## Requirements
### Requirement: 内置 skill 安装到 .builtin（行为保持不变）

本需求 MUST 按以下场景执行。

所有安装入口应在每次安装/更新时，先整体清空 `~/.clickzetta/skills/.builtin/`，再用全部捆绑 skill 重新填充。此行为不受外部 agent 注册逻辑影响而改变。

#### Scenario: 清空后重新填充内置 skill

- **WHEN** 安装介质中存在捆绑 skill 源目录，且 `~/.clickzetta/skills/.builtin/` 中存在上一次安装遗留的 skill 时
- **THEN** `.builtin/` 被整体清空，仅包含本次捆绑的全部 skill（遗留 skill 不再保留）

#### Scenario: 无捆绑 skill 时仍清空内置目录

- **WHEN** 安装介质中不存在任何捆绑 skill 时
- **THEN** `~/.clickzetta/skills/.builtin/` 仍存在且被清空，不残留旧 skill

#### Scenario: Windows Release 归档保留顶层 skills

- **WHEN** 构建 Windows Release zip 归档时，平台 dist 的 `bin/skills/cz-cli/SKILL.md` 已存在
- **THEN** 解压该 zip 后顶层直接包含 `skills/cz-cli/SKILL.md`，install.sh、setup.sh 和 npm 发布准备脚本均可按同一目录结构发现捆绑 skill

#### Scenario: Windows npm 平台包包含捆绑 skills

- **WHEN** npm 发布脚本处理 `cz-cli-windows-x64` artifact 且 artifact 中存在 `bin/skills/cz-cli/SKILL.md`
- **THEN** 生成的 `@clickzetta/cz-cli-win32-x64` 平台包在 `bin/skills/cz-cli/SKILL.md` 中包含同一份捆绑 skill，postinstall 可安装 `.builtin` 内置 skill

#### Scenario: Windows PowerShell 原生安装内置 skill

- **WHEN** 用户在 Windows PowerShell/CMD 原生环境执行 COS 发布的 `install.ps1`，且下载归档中包含顶层 `skills/` 目录
- **THEN** PowerShell 安装器不依赖 `setup.sh` 或 bash，也会清空并重新填充 `$HOME/.clickzetta/skills/.builtin/`

### Requirement: 清理外部 agent 目录遗留 skill（不再注册）

本需求 MUST 按以下场景执行。

安装入口**不再**向外部 agent skill 目录注册 `cz-cli` skill（外部集成改由 `cz-cli mcp init` 走 MCP）。相反，每个安装入口应从所有外部 agent skill 目录中删除待清理名单中的 skill（`cz-cli` 及历史别名 `czagent`、`czcli`、`cz-cli-v2`），且不重新写入任何 skill。该清理必须幂等，单个目录失败不应中断其余目录或整个安装流程。

#### Scenario: 删除外部目录中的 cz-cli skill 与废弃别名

- **WHEN** 执行任一安装入口，且某外部 agent 目录中存在 `cz-cli` 或 `czagent` / `czcli` / `cz-cli-v2` 时
- **THEN** 这些 skill 被删除，且不会被重新创建；不向任何外部 agent 目录写入 `cz-cli`

#### Scenario: 外部目录不存在时不报错

- **WHEN** 用户未安装某个 agent（对应 skill 目录不存在）时
- **THEN** 安装入口跳过该目录、不创建它，也不因缺失而报错

#### Scenario: 单个目录失败不影响整体

- **WHEN** 清理某个外部 agent 目录因权限等原因失败时
- **THEN** 其余外部 agent 目录的清理继续进行，且整个安装/更新流程不被中断（npm postinstall 不致使 `npm install` 失败）

#### Scenario: Windows PowerShell 原生清理外部 agent skill

- **WHEN** 用户在 Windows PowerShell/CMD 原生环境执行 COS 发布的 `install.ps1` 时
- **THEN** PowerShell 安装器不依赖 `setup.sh` 或 bash，也会从全部外部 agent skill 目录删除 `cz-cli` 及废弃别名，且不重新注册

### Requirement: update 命令继承安装入口的 skill 分发行为

本需求 MUST 按以下场景执行。

`cz-cli update` 不应自行实现 skill 分发逻辑。它通过重新运行 install.sh（curl 安装方式）或包管理器升级命令（npm/bun/pnpm/yarn 安装方式，触发 `postinstall.js`）来完成升级，从而自动继承内置 skill 安装与外部 agent 目录清理行为。

#### Scenario: curl 安装方式的更新

- **WHEN** 安装方式为 `curl` 且执行 `cz-cli update` 时
- **THEN** 重新运行的 install.sh 同时完成 `.builtin` 内置 skill 安装与外部 agent 目录遗留 skill 清理

#### Scenario: 包管理器安装方式的更新

- **WHEN** 安装方式为 npm/bun/pnpm/yarn 且执行 `cz-cli update` 时
- **THEN** 包管理器重新安装触发 `postinstall.js`，完成 `.builtin` 内置 skill 安装与外部 agent 目录遗留 skill 清理
