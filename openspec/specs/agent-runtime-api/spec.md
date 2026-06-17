# agent-runtime-api 规格说明

## Purpose
迁移 Python 版本 agent chat 与 HTTP API 规格到当前 opencode/cz-cli agent runtime。当前用户入口是 `cz-cli agent`、`cz-cli agent run`、`cz-cli serve` 与 agent session 命令，不再是 `cz agent ask`。

## Requirements
### Requirement: agent run 提供单次自然语言入口

本需求 MUST 按以下场景执行。

CLI MUST 提供 `cz-cli agent run <prompt>`，用于向 agent runtime 发送单次自然语言请求并返回完成结果或会话 ID。

#### Scenario: 单次请求完成

- **WHEN** 用户执行 `cz-cli agent run "show tables"`
- **THEN** CLI 创建或复用 agent session 并提交 prompt
- **AND** 默认输出为人类可读格式，`--format json` 输出结构化事件或结果

#### Scenario: LLM 未配置

- **WHEN** 用户在未配置可用 LLM 时执行 `cz-cli agent run "..."`
- **THEN** CLI 返回 `NO_ACTIVE_LLM` 指导
- **AND** 指导必须区分 LLM 配置与 Lakehouse profile 配置

### Requirement: agent status 通过 session 子命令表达

本需求 MUST 按以下场景执行。

当前 runtime SHOULD 通过 `cz-cli agent session status <sessionID>` 查询会话忙闲与最近进度，而不是 Python 旧版 `cz agent status` 健康检查。

#### Scenario: 查询会话状态

- **WHEN** 用户执行 `cz-cli agent session status <sessionID> --format json`
- **THEN** CLI 返回 session 状态、最近 progress 和是否 idle/busy 的结构化信息

#### Scenario: 等待会话空闲

- **WHEN** 用户执行 `cz-cli agent session status <sessionID> --wait`
- **THEN** CLI 阻塞并流式输出去重后的 NDJSON progress
- **AND** 长时间无进展时返回 timeout 语义而非永久挂起

### Requirement: headless server 透出 agent API

本需求 MUST 按以下场景执行。

`cz-cli serve` MUST 启动 headless agent server，并通过 opencode HTTP API 处理会话、消息、文件、技能和状态。

#### Scenario: 启动 server

- **WHEN** 用户执行 `cz-cli serve --hostname 127.0.0.1 --port 4096`
- **THEN** CLI 启动 agent server 并输出监听地址
- **AND** 服务端复用现有 opencode session/runtime，不重复实现 agent 逻辑

#### Scenario: 端口不可用

- **WHEN** 指定端口已被占用或 server 启动失败
- **THEN** CLI 返回非零退出码和可诊断错误
- **AND** 不吞掉底层启动失败原因

### Requirement: 配置通过 profiles 与 LLM 配置分离

本需求 MUST 按以下场景执行。

Lakehouse profile 与 LLM provider 配置 MUST 分离：`[profiles.*]` 保存 ClickZetta 连接，`[llm.*]` 保存 agent 模型配置。

#### Scenario: 选择 Lakehouse profile

- **WHEN** 用户执行 `cz-cli agent run "..." --profile staging`
- **THEN** agent 子进程将该 profile 的 ClickZetta 连接信息注入运行环境
- **AND** 不改变默认 profile

#### Scenario: 缺少 Lakehouse profile

- **WHEN** agent 或工具需要执行 Lakehouse 命令但没有 profile
- **THEN** CLI 返回 `NO_PROFILE` 或等价结构化指导
- **AND** 提示 `cz-cli setup` 路径
