# 扩展点

cz-cli 往上游注入的东西集中在 [opencode-injection.ts](../../packages/cz-cli/src/bootstrap/opencode-injection.ts)，文件开头的注释表是完整清单，新增注入时先更新它。注入分两层，故意不合并：

- **基础层** `applyBaseOpencodeEnv()`：每条 cz-cli 命令都会跑，必须在上游读取任何 flag 之前执行。
  - `OPENCODE_DISABLE_AUTOUPDATE=1`：关掉上游自动更新。
  - `OPENCODE_DISABLE_PROJECT_CONFIG=1`：默认关掉项目级配置和指令发现，用户显式设了就不覆盖。
  - `OPENCODE_OTLP_*`、`OPENCODE_SERVICE_NAME=cz-agent`：遥测默认值。
- **agent 层** `applyAgentRuntimeInjection()`：只在 agent 运行时跑，普通命令（如 `cz-cli sql`）不承担这些配置。
  - `OPENCODE_CONFIG`：指向 `~/.clickzetta/llm.json`。
  - `OPENCODE_CONFIG_CONTENT`：provider、cz 插件、skill 路径、`data_engineer` 默认 agent 和模型，见 [runtime-config.ts](../../packages/cz-cli/src/bootstrap/runtime-config.ts)。
  - `OPENCODE_TUI_CONFIG`：品牌和额度插件。
  - `CLICKZETTA_AGENT_SYSTEM_PROMPT`：由 cz 插件在每次请求时加进 system prompt。
  - Worker 环境变量补丁：把完整的 `process.env` 带进 TUI 的 server Worker。

## 其他接入方式

- **插件**：[opencode-plugin/server.ts](../../packages/cz-cli/src/opencode-plugin/server.ts) 合并了 system prompt、profile 提醒、出站请求头、OTel 四个插件，用到的 hook 有 `event`、`config`、`chat.headers`、`shell.env`、`experimental.chat.messages.transform`、`experimental.chat.system.transform`、`experimental.chat.llm`。插件能看到哪些事件见 [opencode 容易踩的坑](pitfalls.md)。
- **命令替换**：`agent-cmd/tui.ts` 包了一层上游的 TUI 命令，`agent-cmd/run.ts` 替换了上游的 `run`，都在 `bootstrap/runtime.ts` 注册。
- **环境变量镜像**：`env-shim.ts` 把 `CLICKZETTA_*` 镜像成 `OPENCODE_*`，显式设置的 `OPENCODE_*` 优先。只在编译入口加载。
- **构建时**：`script/build.ts` 写死 `OPENCODE_WORKER_PATH` 指向 cz 的 worker。

## 各入口拿到了什么

| 入口 | 基础层 | agent 层 | 说明 |
| --- | --- | --- | --- |
| `cz-cli agent`（交互 TUI）、`agent run`、`agent session/stats/export/llm`、`llm`、`serve` | 有 | 有 | 都经 `run-cli.ts` 的 `delegateToAgentRuntime` 进入 `runtime.ts` 的 `main` |
| `mcp serve` | 有 | 有 | 普通命令，自己在 `commands/mcp.ts` 补调 agent 层，另设 `OPENCODE_ERROR_DETAIL=1` |
| 其他普通命令（`sql`、`table`、`fs`…） | 有 | 无 | 故意不加载 agent 配置 |
| 开发入口 `bun run src/main.ts` | 普通命令没有 | 同编译版 | 不加载 `env-shim`，普通命令也拿不到基础层，现象可能和二进制不同 |

新增入口时，确认它在这张表里落在哪一行，并补一条测试（参考 `test/mcp-serve-injection.test.ts`、`test/flag-injection-visibility.test.ts`）。
