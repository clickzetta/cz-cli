# sql-execution 规格说明

## Purpose
定义 `cz-cli sql` 与 SQL job 状态/结果/profile 的行为。输出格式统一使用 `--format`，旧 Python 的 `-o` 不再支持。

## Requirements
### Requirement: SQL 命令 help 签名稳定

本需求 MUST 按以下场景执行。

`cz-cli sql --help` MUST 反映当前 yargs 参数，调用方必须以 help 为准。

#### Scenario: sql help

- **WHEN** 用户执行 `cz-cli sql --help`
- **THEN** usage 包含 `cz-cli sql [statement]` 和 `cz-cli sql status <job-id>`
- **AND** 选项包含 `--write`、`--with-schema`、`--truncate/--no-truncate`、`-f/--file`、`-e/--execute`、`--stdin`、`--sync/--no-sync`、`--async`、`--timeout`、`--variable`、`--set`、`--job-profile`、`--header/--no-header`、`--limit`、`-B/--batch`、`--dry-run`

#### Scenario: status help

- **WHEN** 用户执行 `cz-cli sql status --help` 或 `cz-cli status --help`
- **THEN** help MUST 说明这是 async SQL job status 查询
- **AND** 需要 `job-id` 参数

### Requirement: SQL 输入模式互斥并有优先级

本需求 MUST 按以下场景执行。

系统 MUST 支持 positional statement、`-e/--execute`、`-f/--file`、`--stdin` 输入，并按 help 声明的优先级解析。

#### Scenario: 位置 SQL

- **WHEN** 用户执行 `cz-cli sql "SELECT 1"`
- **THEN** 系统执行该 statement
- **AND** 返回查询结果或 job 状态

#### Scenario: 文件 SQL

- **WHEN** 用户执行 `cz-cli sql -f query.sql`
- **THEN** 系统读取文件内容并执行
- **AND** 文件不存在时返回可诊断错误

#### Scenario: stdin SQL

- **WHEN** 用户执行 `echo "SELECT 1" | cz-cli sql --stdin`
- **THEN** 系统从 stdin 读取 SQL
- **AND** 空 stdin 返回 usage/business error

### Requirement: 写入 SQL 必须显式授权

本需求 MUST 按以下场景执行。

写操作 MUST 需要 `--write`，危险 mutation guardrails MUST 在执行前生效。

#### Scenario: 写 SQL 未授权

- **WHEN** 用户执行 `cz-cli sql "INSERT INTO t VALUES(1)"` 且没有 `--write`
- **THEN** 系统拒绝执行
- **AND** 返回 write-protection 错误

#### Scenario: MERGE SQL 未授权

- **WHEN** 用户执行 `cz-cli sql "MERGE INTO t USING s ON t.id=s.id WHEN MATCHED THEN UPDATE SET v=s.v"` 且没有 `--write`
- **THEN** 系统拒绝执行
- **AND** 不提交 SQL job

#### Scenario: 危险 DELETE/UPDATE

- **WHEN** 用户执行没有 WHERE 或被 guardrail 判定危险的 DELETE/UPDATE
- **THEN** 系统在提交前拒绝
- **AND** 错误说明需要更具体条件或人工确认路径

### Requirement: 同步、异步与 job profile

本需求 MUST 按以下场景执行。

默认同步等待结果；`--async` 或 `--no-sync` MUST 返回 job 信息而不等待完整结果。

#### Scenario: 异步执行

- **WHEN** 用户执行 `cz-cli sql --async "SELECT * FROM huge_table"`
- **THEN** 系统提交 SQL 并返回 `job_id`/状态信息
- **AND** `ai_message` SHOULD 提示可用 `cz-cli sql status <job-id>`、`cz-cli job result <job-id>` 或 `cz-cli job profile <job-id>`

#### Scenario: 查询 job profile

- **WHEN** 用户执行 `cz-cli sql --job-profile <job_id>` 或 `cz-cli job profile <job_id>`
- **THEN** 系统返回 job profile 摘要
- **AND** 字段名称使用用户可理解的 domain 名称

### Requirement: 参数替换与 SQL hints

本需求 MUST 按以下场景执行。

`--variable KEY=VALUE` MUST 执行 SQL 模板替换；`--set KEY=VALUE` MUST 注入查询 hints。

#### Scenario: 变量替换

- **WHEN** 用户执行 `cz-cli sql --variable id=1 "SELECT * FROM t WHERE id = <id>"`
- **THEN** 系统将变量替换为对应值后提交
- **AND** 缺失变量返回错误而不是提交未替换模板

#### Scenario: SQL set flags

- **WHEN** 用户执行 `cz-cli sql --set cz.sql.timezone=UTC "SELECT CURRENT_TIMESTAMP"`
- **THEN** 系统将 hint 传给 SQL 执行层
- **AND** 无效 KEY=VALUE 形式返回 usage error

### Requirement: 结果限制、截断和表格输出

本需求 MUST 按以下场景执行。

`--limit`、`--no-limit`、`--truncate`、`--no-truncate` 是 sql 命令级参数，不是全局输出层能力。

#### Scenario: 默认限制

- **WHEN** 查询返回大量结果且用户未指定 `--no-limit`
- **THEN** CLI 默认最多返回 help 中声明的行数
- **AND** `ai_message` SHOULD 提示如何扩大或取消限制

#### Scenario: 无 header 批处理输出

- **WHEN** 用户执行 `cz-cli sql -N -B --format table "SELECT 1; SELECT 2"`
- **THEN** 系统按批处理语义执行多条语句
- **AND** 表格/行格式不输出 header

### Requirement: SQL 网关提交与轮询请求与 Java/JDBC 保持关键字段及重试语义对齐

本需求 MUST 按以下场景执行。

`cz-cli sql` 通过 `/lh/submitJob` 提交 SQL 时，MUST 补齐与官方 Java/JDBC 一致的关键 header、请求体字段与重试语义，避免因请求形状或重试策略差异触发单域或 dedicated 路由兼容性问题。

#### Scenario: 提交 SQL 时自动带上实例与请求标识头

- **WHEN** 用户执行 `cz-cli sql "SELECT 1"`
- **THEN** `/lh/submitJob` 请求 MUST 带上 `instanceName`
- **AND** 请求 MUST 带上 `requestId` 与 `X-Request-ID`
- **AND** 若已生成 job id，请求 SHOULD 同时带上 `jobId` header 便于网关关联日志

#### Scenario: submitJob 使用 Java/JDBC 风格的 job id

- **WHEN** CLI 为 SQL 生成新的 Lakehouse job id
- **THEN** job id MUST 与 Java `CZRequestIdGenerator` 对齐，使用 `17位时间戳 + base36 后缀`
- **AND** 同一次重试链路中的 `/lh/submitJob` 与 `/lh/getJob` MUST 复用同一个 job id

#### Scenario: contextJson 与 jdbcDomain 使用 Java 连接上下文中的 endpoint

- **WHEN** 用户执行 `cz-cli sql "SELECT current_workspace() AS workspace"`
- **THEN** `clientContext.contextJson.host` MUST 使用 Java `CZConnectContext.endpoint` 对应的真实 service endpoint，而不是 `null`
- **AND** `clientContext.contextJson.user` MUST 优先使用连接上下文中的用户名
- **AND** 当可推导出 JDBC domain 时，请求 MUST 同时填充 `jobDesc.jdbcDomain`

#### Scenario: submitJob 遇到 Java 定义的可恢复异常时继续走 Lakehouse 重试链路

- **WHEN** `/lh/submitJob` 首次返回 `CZLH-60023`
- **THEN** CLI MUST 继续使用同一个 Lakehouse job id 重试 `/lh/submitJob`
- **AND** CLI MUST NOT 调用 Studio adhoc 执行或取数接口

#### Scenario: submitJob 遇到状态未知后继续轮询同一个 Lakehouse job

- **WHEN** `/lh/submitJob` 返回 `CZLH-60022`
- **THEN** CLI MUST 继续轮询 `/lh/getJob`
- **AND** `/lh/getJob` 请求体 MUST 使用 Java/JDBC 风格的 `getResultRequest.jobId.instanceId` 与 `jdbcDomain`
- **AND** 当 `/lh/getJob` 返回 `CZLH-60005` 时，CLI MUST 回到 `/lh/submitJob` 重试，而不是改走 Studio
