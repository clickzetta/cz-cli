# 内置技能与外部客户端接入

内置技能供 cz-cli 自身使用；外部 AI 客户端通过 `cz-cli mcp init` 接入。

## 当前行为

- 构建从仓库 `skills/` 及 `skills/external/` 收集带有 `SKILL.md` 的技能目录，复制到各平台产物的 `bin/skills/`。
- npm 安装、归档安装与生成的 PowerShell 安装器把随包技能写入 `~/.clickzetta/skills/.builtin/`。安装时重建该目录，避免旧版本技能残留。
- 安装器不再向 Claude Code、Codex 等外部客户端的技能目录自动安装 cz-cli 技能。它们清理旧的 `cz-cli`、`czagent`、`czcli`、`cz-cli-v2` 目录，并提示使用 MCP 接入。

## 维护约束

- `.builtin/` 属于安装器管理范围，不能把用户自建技能放进该目录；清理外部旧技能时只处理指定名称。
- 技能随平台产物交付，修改打包或安装布局时同时核对实际安装结果。
- 产品内置技能与本仓库维护 loop 的 docs、prompt 分开管理。

## 实现与验证入口

- [构建打包](../../packages/cz-cli/script/build.ts)、[归档安装](../../scripts/setup.sh)、[npm 安装](../../packages/npm/cz-cli/bin/postinstall.js)、[生成的安装器](../../scripts/cos-release.mjs)。
- [MCP 初始化](../../packages/cz-cli/src/commands/mcp-init.ts)、[MCP 初始化回归](../../packages/cz-cli/test/mcp-init.test.ts)。
- [安装资产回归](../../packages/cz-cli/test/runtime-assets-installers.test.ts)、[Windows 安装回归](../../packages/cz-cli/test/installer-windows.test.ts)。
