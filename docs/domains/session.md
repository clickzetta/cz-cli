# 会话

会话核心的设计入口如下，改动前按涉及的边界读取；开发维护循环的任务状态与业务 Session 分开。

- [Session V2](../../specs/v2/session.md)：持久输入、执行协调、历史与 Context Epoch。
- [模型与 Provider](../../specs/v2/provider-model.md)、[Provider 策略](../../specs/v2/provider-policy.md)。
- [配置](../../specs/v2/config.md)、[工具](../../specs/v2/tools.md)、[指令](../../specs/v2/instructions.md)。
- [Catalog 与配置生命周期](../../specs/v2/catalog-config-plugin-lifecycle.md)。

仓库级 V2 不变量见 [AGENTS.md](../../AGENTS.md#v2-session-core)。设计中的后续事项不能当作已实现能力。
