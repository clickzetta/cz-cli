# 技能加载与外部客户端接入

`cz-cli` 当前不再随包捆绑任何内置 skill；`cz-cli agent` 加载用户本地安装的技能与外部 AI 客户端接入 cz-cli 是两条完全独立的路径：

## 当前行为

- **本地 `cz-cli agent` 加载用户安装的技能**：运行时扫描 `~/.clickzetta/skill/` 与 `~/.clickzetta/skills/` 下带有 `SKILL.md` 的目录并交给上游加载。
- **安装器对 `.builtin/` 目录的清理与托管**：构建脚本仅在仓库 `skills/` 或 `skills/external/` 下存在 `SKILL.md` 目录时才会打包技能（当前已移除历史 `skills/cz-cli/`，随包技能数为 0）。npm 安装、归档安装与生成的 PowerShell 安装器在安装/升级时会重建 `~/.clickzetta/skills/.builtin/`，从而清空旧版本遗留的随包技能。
- **外部 AI 客户端通过 MCP 接入**：安装器不再向 Claude Code、Codex、Cursor 等外部客户端的技能目录写入技能，而是在升级时清理旧的 `cz-cli`、`czagent`、`czcli`、`cz-cli-v2` 目录，并引导运行 `cz-cli mcp init` 注册 MCP 服务。

## 维护约束

- `.builtin/` 属于安装器重建托管范围，不能把用户自建技能放进该目录（用户自建或手动安装的技能应放在 `~/.clickzetta/skills/` 的其他子目录）；清理外部旧技能时只处理指定名称。
- 修改技能加载、打包或安装清理逻辑时，同时核对产物归档内容与升级后的实际目录状态。
- 产品侧技能加载与本仓库维护 loop 的 docs、prompt 分开管理。

## 实现与验证入口

- [运行时技能发现](../../packages/cz-cli/src/bootstrap/runtime-config.ts)、[构建打包](../../packages/cz-cli/script/build.ts)、[归档安装](../../scripts/setup.sh)、[npm 安装](../../packages/npm/cz-cli/bin/postinstall.js)、[生成的安装器](../../scripts/cos-release.mjs)。
- [MCP 初始化](../../packages/cz-cli/src/commands/mcp-init.ts)、[MCP 初始化回归](../../packages/cz-cli/test/mcp-init.test.ts)。
- [安装资产与旧技能清理回归](../../packages/cz-cli/test/runtime-assets-installers.test.ts)、[Windows 安装回归](../../packages/cz-cli/test/installer-windows.test.ts)。
