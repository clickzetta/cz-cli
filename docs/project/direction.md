# 方向与取舍

cz-cli 为人和 AI Agent 提供 ClickZetta Lakehouse 命令行入口。产品能力以[使用说明](../../README.md)和[当前命令实现](../../packages/cz-cli/src/commands/)为准。

- 保持适合脚本和 Agent 消费的输出、错误结构与退出状态。
- 通过直接命令、Data Agent 和 MCP 提供 Lakehouse 操作能力。
- ClickZetta 定制优先放在自身包，通过上游公开扩展点接入；边界见[上游补丁](../opencode/upstream-patches.md)和[扩展点](../opencode/extension-points.md)。

项目知识按领域保存在仓库 docs，通过索引按需读取。已确认的行为、约束和取舍更新到对应主题；任务日志与执行进度保存在本机运行记录中。

开发自维护由两个常驻会话承担：Worker 统一处理 GitHub 与飞书的反馈，Curator 每天回看实际发生的事、整理共享记忆，并把发现的代码问题提成 issue 交给 Worker，具体约定见[维护导航](../maintenance/INDEX.md)。
