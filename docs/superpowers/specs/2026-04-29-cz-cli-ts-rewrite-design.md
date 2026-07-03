# cz-cli TypeScript 全量重写设计

## 背景

当前 cz-agent 项目（opencode fork）通过 `forward.ts` 将 Lakehouse 命令转发给打包的 Python cz-tool 二进制（cz-cli 的 PyInstaller 产物）。这带来体积大、环境脆弱、打包复杂等问题。

本次重写将 cz-cli 的所有逻辑用 TypeScript 重新实现，消除 Python 依赖。

## 核心发现

cz-cli 底层全部是 HTTP REST 调用，无私有协议：

1. **SQL 通路**（clickzetta-connector）：`/lh/submitJob`、`/lh/getJob`、`/lh/cancelJob`
2. **Studio 通路**（cz-mcp-server）：`/clickzetta-portal/`、`/ide-admin/v1/`、`/ide-authority/v1/` 共 50+ 端点
3. **AI Agent 通路**：`/ai/api/conversations`、`/ai/api/chat`、`/ai/health`

认证统一使用 `X-Clickzetta-Token` header + JSON body。

## 总体架构

```
用户
  │
  ▼
czcli (入口二进制, opencode CLI 改名)
  │
  ├─ czcli agent ...  ──→  opencode 逻辑 (TUI/session/AI)
  │                              │
  │                              ▼
  │                         cz-tool (内置 tool, spawn 进程调用)
  │                              │
  └─ czcli sql/task/...  ──→  cz-tool (内置二进制)
                                 │
                                 ▼
                          clickzetta-sdk (HTTP client)
                                 │
                                 ▼
                        ClickZetta Backend (REST API)
```

## 包结构

### `packages/clickzetta-sdk`

HTTP client 层，1:1 对齐 Python clickzetta-connector 和 cz-mcp-server 的行为。

```
packages/clickzetta-sdk/src/
  index.ts             — 公开 API 入口
  client.ts            — 统一 HTTP client（重试、超时、错误处理、header 注入）
  auth/
    login.ts           — loginSingle（PAT / 用户名密码）
    token.ts           — token 缓存、过期检测、自动刷新
    user.ts            — getCurrentUser、getUserConfig
  sql/
    submit.ts          — /lh/submitJob
    poll.ts            — /lh/getJob（轮询结果）
    cancel.ts          — /lh/cancelJob
    split.ts           — SQL 拆分（移植 Python utils.split_sql）
    types.ts           — QueryResult、JobStatus 等类型
  studio/
    task.ts            — task CRUD（add、getDetail、save、submit、offline 等）
    runs.ts            — 任务实例（list、getDetail、stop、rerun、complement）
    flow.ts            — flow DAG（getDag、createNode、bind、unbind、submit）
    attempts.ts        — attempt 记录和日志
    execute.ts         — adhoc 执行
    folder.ts          — 文件夹管理
    datasource.ts      — 数据源操作
    schedule.ts        — 调度任务
  workspace/
    workspace.ts       — listUserWorkspaces、切换 workspace
  agent/
    chat.ts            — AI Agent 对话（conversations、chat、health）
  config/
    region.ts          — 区域检测、base URL 解析
    connection.ts      — 连接配置解析（JDBC URL、环境变量、profile 优先级）
  types/
    index.ts           — 共享类型（ConnectionConfig、StudioConfig、AuthToken 等）
    api.ts             — API 响应类型（{ code, message, data }）
```

设计原则：
- 每个模块只做 HTTP 调用 + 类型转换，不含 CLI 逻辑
- `client.ts` 统一处理：重试（2 次，指数退避）、token 注入、错误码解析
- 所有方法返回强类型
- token 自动刷新（过期因子 0.8，与 Python 版一致）

### `packages/cz-cli`

cz-tool 的实现，对齐 Python cz-cli 的所有命令。CLI 框架使用 yargs（与 opencode 一致）。

```
packages/cz-cli/src/
  index.ts             — cz-tool 入口
  cli.ts               — yargs 命令注册
  commands/
    sql.ts             — SQL 执行（安全护栏、异步、变量替换）
    profile.ts         — profile CRUD + discover + list-workspaces
    schema.ts          — schema list / describe / create / drop
    table.ts           — table list / describe / preview / stats / history / create / drop
    workspace.ts       — workspace list / use
    task.ts            — task CRUD + flow 子命令组
    runs.ts            — runs list / detail / wait / logs / deps / stop / stats / refill
    attempts.ts        — attempts list / log
    agent.ts           — agent status / ask
    job.ts             — job 性能分析
    status.ts          — 版本和连接状态
    ai-guide.ts        — AI agent 命令参考输出
    install-skills.ts  — 安装 AI skills 到外部 agent
  connection/
    config.ts          — 连接配置解析（优先级链）
    profile-store.ts   — profiles.toml 读写
  output/
    formatter.ts       — 输出格式化（json / pretty / table / csv / jsonl / toon）
    masking.ts         — 敏感数据脱敏（手机、邮箱、密码、身份证）
  logger.ts            — 操作日志（sql-history.jsonl）
  guide-builder.ts     — AI guide 生成
  version.ts           — 版本号
```

#### 命令清单

| 命令 | 子命令 | Python 来源 |
|------|--------|-------------|
| `sql` | 直接执行，`--write`、`--async`、`-e`、`-f`、`--variable`、`--set`、`--job-profile` | commands/sql.py |
| `profile` | list、detail、create、update、delete、use、discover、list-workspaces、render-command | commands/profile.py + profile_bootstrap.py |
| `schema` | list、describe、create、drop | commands/schema.py |
| `table` | list、describe、preview、stats、history、create、drop | commands/table.py |
| `workspace` | current、use（`--persist`） | commands/workspace.py |
| `task` | list、list-folders、create、create-folder、content、save-content、save-config、deps、execute、online、offline | commands/task.py |
| `task flow` | dag、create-node、remove-node、bind、unbind、node-detail、node-save、node-save-config、submit、instances | commands/task.py |
| `runs` | list、detail、wait、logs、deps、stop、stats、refill | commands/runs.py |
| `attempts` | list、log | commands/attempts.py |
| `agent` | status、ask（`--conversation-id`） | commands/agent.py |
| `job` | 性能分析（当前 Python 版大部分注释） | commands/job.py |
| `status` | 显示版本、连接状态 | main.py |
| `ai-guide` | 输出 AI agent 命令参考（json / toon） | guide_builder.py |
| `install-skills` | 安装 AI skills 到外部 agent | commands/skills_installer.py |

#### 保留行为

- 全局选项：`--profile`、`--jdbc`、`--pat`、`--output`、`--debug`、`--silent`、`--verbose` 等自动注入
- 连接配置优先级：CLI 参数 > JDBC URL > 环境变量 > profile > 默认值
- SQL 安全护栏：`--write` 写保护、无 WHERE 拦截、自动 LIMIT 100、敏感数据脱敏
- 输出格式：json / pretty / table / csv / jsonl / toon
- 操作日志：`~/.clickzetta/sql-history.jsonl`
- Profile 存储：`~/.clickzetta/profiles.toml`

### `packages/opencode` 改动

#### 入口改名
- 二进制名从 `czagent` 改为 `czcli`（保留别名 `cz`、`cz-cli`、`clickzetta-cli`）
- 路由逻辑：`agent` 子命令走 opencode，其他转发给 cz-tool

#### 删除的代码
- `src/installation/index.ts` 中下载安装 Python cz-cli 的逻辑全部删除
- `src/cli/cmd/forward.ts` 重写，指向新的 TS cz-tool 二进制
- `src/profile/` 目录删除，profile 逻辑统一到 `packages/cz-cli`
- `src/cli/cmd/profile.ts` 删除，同上

#### cz-tool 内置 tool
- 在 `src/tool/` 下新增 `cz-tool.ts`，注册为 opencode 内置 tool
- 实现：spawn cz-tool 进程执行命令，返回结构化结果
- agent 在对话中可直接调用（与 bash、read、write 等 tool 并列）

#### 保留不动
- TUI、session、provider、storage、server、config 等全部不动
- 配置文件路径不变（`~/.clickzetta/czagent.json`）

#### opencode 直接调 SDK
- profile 验证连接：从 shell out 改为直接调 `clickzetta-sdk` 的 sql 模块

## 构建与分发

- `packages/clickzetta-sdk` — 纯库，被其他包引用
- `packages/cz-cli` — Bun 编译为 `cz-tool` 二进制
- `packages/opencode` — Bun 编译为 `czcli` 二进制，构建时将 cz-tool 打包到产物目录
- 产物结构：`czcli` + `cz-tool/cz-tool`（与当前结构一致）
- `setup.sh` 安装时释放两个二进制到正确路径

## HTTP 端点清单

### 认证

| 端点 | 方法 | 用途 |
|------|------|------|
| `/clickzetta-portal/user/loginSingle` | POST | 登录（PAT / 用户名密码） |
| `/clickzetta-portal/user/getCurrentUser` | POST | 获取当前用户信息 |
| `/clickzetta-portal/user/getUserConfig` | POST | 获取用户配置 |
| `/clickzetta-portal/service/getInstanceByName` | GET | 按名称获取实例 |

### SQL 执行

| 端点 | 方法 | 用途 |
|------|------|------|
| `/lh/submitJob` | POST | 提交 SQL 任务 |
| `/lh/getJob` | POST | 查询任务状态/结果 |
| `/lh/cancelJob` | POST | 取消任务 |

### Workspace

| 端点 | 方法 | 用途 |
|------|------|------|
| `/ide-authority/v1/workspace/listUserWorkspaces` | POST | 列出用户 workspace |

### Task 开发

| 端点 | 方法 | 用途 |
|------|------|------|
| `/ide-admin/v1/dataFile/addAndReturnId` | POST | 创建任务 |
| `/ide-admin/v1/ai/mcp/listFolders` | POST | 列出文件夹 |
| `/ide-admin/v1/ai/mcp/listFiles` | POST | 列出文件 |
| `/ide-admin/v1/dataFileConfiguration/saveDataFileConfiguration` | POST | 保存任务内容和配置 |
| `/ide-admin/v1/dataFile/getDetail` | GET | 获取任务详情 |
| `/ide-admin/v1/dataFileConfiguration/getFileConfigurationDetail` | POST | 获取任务配置详情 |
| `/ide-admin/v1/dataFile/submit` | POST | 发布任务 |
| `/ide-admin/v1/adhoc/execute` | POST | 临时执行 |

### 任务实例 (Runs)

| 端点 | 方法 | 用途 |
|------|------|------|
| `/ide-admin/v1/taskInst/list` | POST | 列出任务实例 |
| `/ide-admin/v1/taskInst/getDetail` | POST | 获取实例详情 |
| `/ide-admin/v1/taskInst/stopTaskInstance` | POST | 停止实例 |
| `/ide-admin/v1/taskInst/reRunTaskInstance` | POST | 重跑实例 |

### Flow 任务

| 端点 | 方法 | 用途 |
|------|------|------|
| `/ide-admin/v1/flow/getDag` | POST | 获取 DAG |
| `/ide-admin/v1/flow/node/create` | POST | 创建节点 |
| `/ide-admin/v1/flow/node/bind` | POST | 绑定依赖 |
| `/ide-admin/v1/flow/node/unbind` | POST | 解绑依赖 |
| `/ide-admin/v1/flow/node/remove` | POST | 删除节点 |
| `/ide-admin/v1/flow/submit` | POST | 发布 flow |
| `/ide-admin/v1/flow/inst/listWithExtraInfo` | POST | 列出 flow 实例 |

### AI Agent

| 端点 | 方法 | 用途 |
|------|------|------|
| `/ai/api/conversations` | POST | 创建对话 |
| `/ai/api/chat` | POST | 发送消息 |
| `/ai/health` | GET | 健康检查 |
