# opencode

cz-cli 跑在原样的上游 opencode 上，当前基线是 v1.17.11（记录在[补丁账本](../../packages/cz-cli/UPSTREAM-PATCHES.md)和 `packages/opencode/package.json`）。ClickZetta 的行为放在 `packages/cz-cli`，通过上游公开的扩展点接入。

上游包是 `packages/opencode`、`core`、`tui`、`schema` 和 `plugin`，原则上保持原样。非改不可的地方是侵入式补丁，必须加 `cz-cli change` 标记并登记到账本。

改动前先读 [opencode 容易踩的坑](pitfalls.md)。

- [扩展点](extension-points.md)：cz-cli 往上游注入了什么、从哪个入口注入。
- [上游补丁](upstream-patches.md)：侵入式改动的规则和换基线时的重验。
- [会话](session.md)：Session V2 的设计入口。

各上游包自己的开发说明在它们的 `AGENTS.md`：[opencode](../../packages/opencode/AGENTS.md)、[core 的工具](../../packages/core/src/tool/AGENTS.md)、[llm](../../packages/llm/AGENTS.md)、[测试](../../packages/opencode/test/AGENTS.md)。
