# 方向与取舍

cz-cli 为人和 AI Agent 提供 ClickZetta Lakehouse 命令行入口。产品能力以[使用说明](../../README.md)和[当前命令实现](../../packages/cz-cli/src/commands/)为准。

- 保持适合脚本和 Agent 消费的输出、错误结构与退出状态。
- 通过直接命令、Data Agent 和 MCP 提供 Lakehouse 操作能力。
- ClickZetta 定制优先放在自身包，通过上游公开扩展点接入；边界见[上游补丁](../opencode/upstream-patches.md)和[扩展点](../opencode/extension-points.md)。

项目知识按领域保存在仓库 docs，通过索引按需读取。已确认的行为、约束和取舍更新到对应主题。
