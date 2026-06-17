# output-format 规格说明

## Purpose
定义 cz-cli 的机器可读与人可读输出契约。Python 版本历史上的 `-o/--output` 已废弃；当前 TypeScript/Bun 版本 MUST 使用 `--format`，并保留 `ai_message` 作为 agent 面向的下一步提示。

## Requirements
### Requirement: 输出格式统一使用 --format

本需求 MUST 按以下场景执行。

所有命令 MUST 使用全局或命令级 `--format` 选择输出格式。旧的 `-o` 与 `--output` MUST NOT 继续作为输出格式入口。

#### Scenario: 用户使用当前输出参数

- **WHEN** 用户执行 `cz-cli sql --format table "SELECT 1"`
- **THEN** CLI 使用 table renderer 输出结果
- **AND** 命令成功时退出码为 0

#### Scenario: 用户使用废弃输出参数

- **WHEN** 用户执行 `cz-cli sql -o json "SELECT 1"` 或 `cz-cli sql --output json "SELECT 1"`
- **THEN** CLI 返回 usage error
- **AND** 错误 payload 的 `ai_message` MUST 指导调用方改用 `--format`

### Requirement: 格式集合保持稳定

本需求 MUST 按以下场景执行。

Lakehouse 命令 MUST 支持 `json`、`pretty`、`table`、`csv`、`text`、`jsonl`、`toon`；agent runtime 命令 MAY 只支持其帮助中声明的格式。

#### Scenario: Lakehouse 命令声明格式集合

- **WHEN** 用户执行 `cz-cli --help`
- **THEN** 全局 `--format` 帮助列出 `json|pretty|table|csv|text|jsonl|toon`
- **AND** 默认格式为 `json`

#### Scenario: agent runtime 命令格式不同

- **WHEN** 用户执行 `cz-cli agent run --help`
- **THEN** 该命令只承诺其帮助中列出的格式，例如 `default` 与 `json`
- **AND** 调用方 MUST NOT 假设所有全局 Lakehouse 格式都适用于 agent runtime 子命令

### Requirement: --field 字段抽取稳定

本需求 MUST 按以下场景执行。

`--field` MUST 支持从顶层、`data`、`data[0]` 与 `rows[0]` 抽取单字段，并支持点号路径与数组索引。

#### Scenario: 字段存在

- **WHEN** 命令输出 payload 包含 `data[0].name` 且用户指定 `--field data[0].name`
- **THEN** CLI 只输出该字段值
- **AND** 不再包裹完整 JSON payload

#### Scenario: 字段不存在

- **WHEN** 用户指定的 `--field` 在 payload 中不存在
- **THEN** CLI 输出空内容
- **AND** MUST NOT 输出占位字符串或抛出非业务异常

### Requirement: TOON 输出按 token 友好结构渲染

本需求 MUST 按以下场景执行。

TOON 输出 MUST 尽量把同构标量对象数组压缩为表格形态，并避免因为可选嵌套字段破坏主数组压缩。

#### Scenario: 同构标量数组压缩为表格

- **WHEN** payload 的主数据是键集合一致且值均为标量的对象数组
- **THEN** `--format toon` 输出 SHOULD 呈现 `key[N]{col1,col2}:` 形式
- **AND** 不应退化为逐项冗长展开

#### Scenario: 存在嵌套字段

- **WHEN** 主数组中的某些字段是数组或对象，例如 command examples
- **THEN** 渲染前 SHOULD 将这些异构字段移动到 sibling map
- **AND** 若数据模型本身必须嵌套，允许局部展开但不能破坏关键字段可读性

### Requirement: ai_message 作为 agent 指导保留

本需求 MUST 按以下场景执行。

结构化成功或错误 payload MAY 包含 `ai_message`；该字段 MUST 被视为给 agent 的下一步或截断提示。

#### Scenario: JSON/pretty/toon 输出

- **WHEN** 命令返回带 `ai_message` 的 payload
- **THEN** 结构化格式 MUST 保留该字段
- **AND** 调用方可以据此继续分页、调整参数或确认风险

#### Scenario: 表格或行格式输出

- **WHEN** 命令以 table/csv/text/jsonl 输出主数据
- **THEN** CLI MAY 将 `ai_message` 写入 stderr 或结构化辅助字段
- **AND** MUST NOT 因表格化而丢失重要下一步提示
