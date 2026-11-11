# Data Agent

`cz-cli agent` 在上游 opencode 的 agent 运行时上跑一个 ClickZetta 的 `data_engineer` agent。它怎么被注入上游见 [扩展点](../opencode/extension-points.md)；这里讲 cz-cli 自己负责的部分。

- **提示词**：操作参考写在 [agent-system-prompt.ts](../../packages/cz-cli/src/agent-system-prompt.ts)，身份部分在 [agent-identity-prompt.ts](../../packages/cz-cli/src/agent-identity-prompt.ts)。通过 `CLICKZETTA_AGENT_SYSTEM_PROMPT` 交给 cz 插件，由插件在每次请求时加进 system prompt。
- **内置 skill**：从 `~/.clickzetta` 下的 `skill/`、`skills/` 目录逐个找 `SKILL.md`，把目录交给上游加载，见 [runtime-config.ts](../../packages/cz-cli/src/bootstrap/runtime-config.ts)。对外发布的 cz-cli skill 在仓库根目录的 [skills/cz-cli/SKILL.md](../../skills/cz-cli/SKILL.md)。
- **模型**：来自 `~/.clickzetta/llm.json`，见 [配置与连接](configuration.md)。

## 写操作门

会改数据的命令（写 SQL、部分 `table`、`fs` 命令）第一次运行时不执行，而是返回 `WRITE_NOT_ALLOWED` 和 `action_required`，要求先问用户，用户同意后再带 `--write` 重跑。实现在 [write-approval.ts](../../packages/cz-cli/src/commands/write-approval.ts)，SQL 是否算写操作由 SDK 的 [readonly.ts](../../packages/clickzetta-sdk/src/sql/readonly.ts) 判定。

这道门要靠调用方配合才有效。外部 Agent 若以跳过权限的方式调用 cz-cli，门不会拦住任何东西，见 [cli 容易踩的坑](pitfalls.md)。
