# cz-cli agent run — 异步 Non-TTY 模式设计

## 概述

在 non-TTY 环境下（如被外部 AI agent 调用时），`cz-cli agent run` 应以 fire-and-forget 语义执行：立即返回 session_id，调用方后续通过 session_id 查询状态并获取完整对话信息（含 thinking、tool_call、text 等全部 parts）。

## 动机

当 `cz-cli agent run` 作为 subagent 被 Claude Code 等外部 AI agent 调用时：
- 当前 a2a 模式会阻塞到 session 完成才返回结果
- 长时间运行的任务会导致调用方超时
- 调用方无法在任务运行中获取中间状态

异步模式允许：
1. 调用方快速获得 session_id 句柄
2. 按需轮询任务状态
3. 任务完成后拉取完整对话历史（含所有 parts 类型）

## 触发条件

异步模式在以下**任一**条件满足时激活：

| 条件 | 场景 |
|------|------|
| `--async` flag 显式传入 | TTY 和 non-TTY 下均可使用 |
| `!process.stdout.isTTY` 且 `--format` 为 `a2a` 或 `json` | 管道/CI/subagent 自动检测 |

优先级：`--async` flag 优先于 TTY 检测。若 `--no-async`（或未来需要），在 non-TTY 下仍可强制同步等待。

## API 设计

### Phase 1: 异步提交

```bash
# 显式
cz-cli agent run "analyze sales table" --async --format a2a --dangerously-skip-permissions

# 隐式（管道场景，stdout 非 TTY）
echo "analyze sales table" | cz-cli agent run --format a2a --dangerously-skip-permissions
```

**stdout 输出：**
```json
{
  "session_id": "01JXF3K...",
  "status": "running",
  "message": "Session submitted asynchronously"
}
```

进程以 exit code 0 退出。

### Phase 2: 状态查询

```bash
cz-cli agent session status <session_id>
```

**输出：**
```json
{
  "session_id": "01JXF3K...",
  "status": "idle",
  "updated_at": 1748160000000
}
```

状态值：
- `"busy"` — 任务运行中
- `"idle"` — 任务完成

### Phase 3: 获取完整对话

```bash
cz-cli agent export <session_id>
```

**输出结构（现有 export 命令，无需修改）：**
```json
{
  "info": {
    "id": "01JXF3K...",
    "title": "analyze sales table",
    "directory": "/path/to/project",
    "time": { "created": 1748160000000, "updated": 1748160030000 }
  },
  "messages": [
    {
      "info": { "id": "msg_001", "role": "user" },
      "parts": [
        { "type": "text", "id": "p1", "text": "analyze sales table" }
      ]
    },
    {
      "info": { "id": "msg_002", "role": "assistant" },
      "parts": [
        {
          "type": "reasoning",
          "id": "p2",
          "text": "Let me look at the sales table schema first...",
          "time": { "start": 1748160001000, "end": 1748160002000 }
        },
        {
          "type": "tool",
          "id": "p3",
          "tool": "bash",
          "state": {
            "status": "completed",
            "input": { "command": "cz-cli sql \"DESC sales\"" },
            "output": "column_name | data_type\n...",
            "title": "cz-cli sql \"DESC sales\""
          }
        },
        {
          "type": "tool",
          "id": "p4",
          "tool": "bash",
          "state": {
            "status": "completed",
            "input": { "command": "cz-cli sql \"SELECT COUNT(*) FROM sales\"" },
            "output": "1234567",
            "title": "cz-cli sql \"SELECT COUNT(*) FROM sales\""
          }
        },
        {
          "type": "text",
          "id": "p5",
          "text": "The sales table has 1,234,567 rows with columns...",
          "time": { "start": 1748160010000, "end": 1748160012000 }
        }
      ]
    }
  ]
}
```

### Parts 类型完整列表

| type | 说明 | 关键字段 |
|------|------|----------|
| `text` | LLM 最终文本回复 | `text`, `time` |
| `reasoning` | LLM thinking/reasoning blocks | `text`, `time` |
| `tool` | 工具调用（bash, read, write, edit, glob, grep, webfetch, etc.） | `tool`, `state.status`, `state.input`, `state.output` |
| `step-start` | 推理步骤开始标记 | `snapshot` |
| `step-finish` | 推理步骤结束标记 | `snapshot` |
| `patch` | 代码变更 diff | `hash`, `files` |
| `snapshot` | Git snapshot 标记 | `snapshot` |
| `subtask` | 子任务委派 | `prompt`, `description` |
| `file` | 文件附件 | `url`, `filename`, `source` |

## 实现变更

### 1. 新增 `--async` flag

**文件：** `packages/cz-cli/src/commands/agent.ts`

在 `run` 子命令的 builder 中新增：
```typescript
.option("async", {
  type: "boolean",
  describe: "Submit asynchronously and return session ID immediately (default in non-TTY with a2a/json format)"
})
```

### 2. 修改 run command handler

**文件：** `packages/opencode/src/cli/cmd/run.ts`

在 `execute()` 函数中，判断异步模式：

```typescript
const isAsync = args.async || (!process.stdout.isTTY && (args.format === "a2a" || args.format === "json"))

if (isAsync) {
  // 1. 创建 session
  const sessionID = await session(sdk)
  if (!sessionID) {
    process.stdout.write(JSON.stringify({ error: "Session not found" }) + EOL)
    process.exit(1)
  }

  // 2. 异步提交 prompt（fire-and-forget）
  await sdk.session.promptAsync({
    sessionID,
    agent,
    model: args.model ? Provider.parseModel(args.model) : undefined,
    variant: args.variant,
    parts: [...files, { type: "text", text: message }],
  })

  // 3. 立即返回 session_id
  const output = {
    session_id: sessionID,
    status: "running",
    message: "Session submitted asynchronously",
  }
  process.stdout.write(JSON.stringify(output) + EOL)
  return
}
```

### 3. 确保 agent runtime 在异步提交后不退出

当使用 `--async` 时，`bootstrap()` 启动的 agent runtime 需要在后台继续运行以处理 session。

两种策略：
- **attach 模式（推荐）：** 如果已有 agent server 运行，直接 attach 并提交，server 继续处理
- **detach 模式：** 如果没有 server，启动 server 后 detach CLI 进程（server 作为 daemon 继续运行）

现有架构中 `bootstrap()` 会启动一个 in-process server。异步模式下需要确保：
1. 如果有已运行的 server（通过 lock file 检测），使用 `--attach` 连接
2. 如果没有，启动 server 并在 prompt 提交后让 server 继续运行（不随 CLI 退出而终止）

### 4. main.ts 参数传递

**文件：** `packages/opencode/src/main.ts`

确保 `--async` flag 被正确解析并传递到 RunCommand handler。

## 外部 Agent 使用流程

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Claude Code    │     │   cz-cli agent   │     │  Agent Runtime  │
│  (调用方)       │     │   run --async    │     │  (后台 server)  │
└────────┬────────┘     └────────┬─────────┘     └────────┬────────┘
         │                       │                         │
         │  cz-cli agent run    │                         │
         │  "analyze sales"     │                         │
         │  --async --format a2a│                         │
         │──────────────────────>│                         │
         │                       │  promptAsync()          │
         │                       │────────────────────────>│
         │                       │                         │
         │  {session_id, status} │                         │
         │<──────────────────────│                         │
         │                       │  (CLI exits)            │
         │                       X                         │
         │                                                 │
         │  (等待/做其他事)                                 │  (处理中...)
         │                                                 │
         │  cz-cli agent session status <id>               │
         │────────────────────────────────────────────────>│
         │  {status: "idle"}                               │
         │<────────────────────────────────────────────────│
         │                                                 │
         │  cz-cli agent export <id>                       │
         │────────────────────────────────────────────────>│
         │  {info, messages: [{parts: [thinking, tool, text]}]}
         │<────────────────────────────────────────────────│
         │                                                 │
```

## 边界条件

1. **session 已 busy：** `promptAsync` 会返回错误，CLI 应输出 `{error: "session busy"}`
2. **server 未运行：** 异步模式需要 server 在后台运行。如果没有 server，CLI 应启动一个 detached server 或报错引导用户先启动
3. **超时：** 调用方自行决定 poll 间隔和超时策略
4. **权限请求：** 异步模式下必须配合 `--dangerously-skip-permissions`，否则 session 会卡在 permission.asked 状态

## 不在本次范围

- Webhook/callback 通知机制（未来可加）
- 实时 SSE 事件流的 CLI 封装（已有 SDK 支持，但 CLI 层面暂不暴露）
- 多 session 并发管理 UI

