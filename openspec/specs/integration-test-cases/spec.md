# integration-test-cases 规格说明

## Purpose
迁移 Python 版本 YAML 集成测试场景为当前 TypeScript/Bun 仓库的测试要求。行为变更应优先在 `packages/cz-cli/test` 或 `packages/opencode/test` 中添加真实实现测试，避免只 mock 命令层。

## Requirements
### Requirement: SQL 集成场景覆盖只读与写保护

本需求 MUST 按以下场景执行。

SQL 命令测试 MUST 覆盖只读成功和写入未授权失败。

#### Scenario: 只读 SQL 成功

- **WHEN** 测试执行 `cz-cli sql "SELECT 1"` 或等价函数路径
- **THEN** 断言输出包含结果数据
- **AND** 退出码为 0

#### Scenario: 写 SQL 被阻止

- **WHEN** 测试执行写入 SQL 且没有 `--write`
- **THEN** 断言返回 write-protection 错误
- **AND** 未调用实际提交路径

### Requirement: profile 场景覆盖列表和详情

本需求 MUST 按以下场景执行。

profile 测试 MUST 覆盖 profile 文件读写、默认 profile 和敏感字段遮蔽。

#### Scenario: profile list

- **WHEN** 测试 home 下存在多个 profiles
- **THEN** `profile list` 返回所有 profile 名称和默认标记
- **AND** 不泄露 password/PAT

#### Scenario: profile detail

- **WHEN** 测试查询指定 profile
- **THEN** 输出包含连接字段
- **AND** 敏感字段仍被遮蔽或仅在明确 raw/debug 模式出现

### Requirement: schema/table/workspace 场景覆盖命令形状

本需求 MUST 按以下场景执行。

基础 Lakehouse 元数据命令测试 SHOULD 覆盖 help 签名、参数解析和空态。

#### Scenario: schema list

- **WHEN** 测试执行 `schema list`
- **THEN** 断言输出是数组/表格友好的结构
- **AND** 空列表不报错

#### Scenario: table list

- **WHEN** 测试执行 `table list --schema public`
- **THEN** 断言 schema 参数传入下游
- **AND** `--format table` 可渲染

#### Scenario: workspace current 已删除

- **WHEN** 测试执行 `workspace current`
- **THEN** 断言返回 `USAGE_ERROR`
- **AND** `workspace --help` 不再暴露该子命令

### Requirement: task/runs 场景覆盖常用 agent 工作流

本需求 MUST 按以下场景执行。

任务和运行实例测试 MUST 覆盖列表、内容保存、依赖解析、run 列表和日志。

#### Scenario: task content/save-content

- **WHEN** 测试保存并读取 task content
- **THEN** 内容保持原文
- **AND** 同时提供 `--content` 与 `-f` 时失败

#### Scenario: runs list 分页

- **WHEN** 测试执行 `runs list --limit 10`
- **THEN** 参数映射为 page-size 或后端限制
- **AND** 输出 count 与数据条数一致

### Requirement: 测试文件与当前工具链兼容

本需求 MUST 按以下场景执行。

测试 MUST 从包目录运行，不能依赖仓库根目录 `npm test`。

#### Scenario: cz-cli 包测试

- **WHEN** 修改 `packages/cz-cli` 行为
- **THEN** 从 `packages/cz-cli` 运行相关 `bun test <test-file>`
- **AND** 运行 `bun typecheck`

#### Scenario: opencode 包测试

- **WHEN** 修改 agent runtime、安装、skill 或 update 行为
- **THEN** 从 `packages/opencode` 运行相关 `bun test <test-file>`
- **AND** 运行 `bun typecheck`
