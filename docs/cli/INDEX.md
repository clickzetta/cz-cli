# cli

`packages/cz-cli` 和 `packages/clickzetta-sdk`：命令、输出、认证和 ClickZetta API。cz-cli 如何接入上游 opencode 见 [opencode](../opencode/INDEX.md)。

改动前先读 [cli 容易踩的坑](pitfalls.md)。

- [配置与连接](configuration.md)：Profile、运行时上下文和模型配置。
- [认证](authentication.md)：登录、凭据刷新和 OAuth。
- [SQL](sql.md)：执行、取消和资源清理。
- [作业信息](jobs.md)：Job profile 的展示、原始输出和文件导出。
- [文件操作](filesystem.md)：Volume 路径、传输和命令边界。
- [Skill 安装](skills.md)：安装目标与命令行为。
- [Analytics Agent](analytics-agent.md)：服务配置、知识库与对话。
- [Data Agent](data-agent.md)：data_engineer 提示词、内置 skill 和写操作门。
- [输出](output.md)：输出格式、错误结构和退出码。
