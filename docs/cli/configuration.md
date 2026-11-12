# 配置与连接

Profile 在 `~/.clickzetta/profiles.toml` 保存连接目标与认证选择，运行时再解析所需的身份和服务上下文。选择顺序为显式 `--profile`、`CZ_PROFILE`、持久默认值；进程内切换与修改持久默认值分别处理。

业务凭据、Analytics Agent 身份与 LLM API key 分别管理，模型配置存放在 `~/.clickzetta/llm.json`。共享上下文或新增查询接口时明确返回字段，不能直接公开配置文件和凭据。

- [Profile 存储](../../packages/cz-cli/src/connection/profile-store.ts)、[进程内选择](../../packages/cz-cli/src/connection/profile-context.ts)。
- [配置合并与认证选择](../../packages/cz-cli/src/connection/config.ts)。
- [运行时连接上下文](../../packages/cz-cli/src/connection/context.ts)。
- [LLM 配置](../../packages/cz-cli/src/llm/native-config.ts)。
- [认证](authentication.md)：当前登录与刷新行为。
