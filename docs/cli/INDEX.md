# cli

`packages/cz-cli` 和 `packages/clickzetta-sdk`：命令、输出、认证和 ClickZetta API。cz-cli 如何接入上游 opencode 见 [opencode](../opencode/INDEX.md)。

改动前先读 [cli 容易踩的坑](pitfalls.md)。

- [配置与连接](configuration.md)：Profile、运行时上下文和模型配置。
- [认证](authentication.md)：登录、凭据刷新和 OAuth。
- [SQL](sql.md)：执行、取消和资源清理。
- [作业信息](jobs.md)：Job profile 的展示、原始输出和文件导出。
- [文件操作](filesystem.md)：Volume 路径、传输和命令边界。
- [技能加载与外部客户端接入](skills.md)：发布期技能打包、本地 skill 加载、旧外部技能清理与 `cz-cli mcp init`。
- [Analytics Agent](analytics-agent.md)：服务配置、知识库与对话。
- [Data Agent](data-agent.md)：data_engineer 提示词、skill 加载和写操作门。
- [输出](output.md)：输出格式、错误结构和退出码。

- [Task scheduling](task-scheduling.md): schedule activation modes and preservation.
