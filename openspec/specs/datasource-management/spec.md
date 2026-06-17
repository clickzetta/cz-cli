# datasource-management 规格说明

## Purpose
定义外部数据源命令族。该能力是当前 TypeScript 版本新增/扩展的 Lakehouse 操作入口，需与 task sync 创建流程配合。

## Requirements
### Requirement: Datasource 命令 help 签名稳定

本需求 MUST 按以下场景执行。

`datasource` 命令族 MUST 通过 help 暴露当前子命令。

#### Scenario: datasource group help

- **WHEN** 用户执行 `cz-cli datasource --help`
- **THEN** help 显示 `list`、`catalogs <datasource>`、`objects <datasource> <catalog>`、`describe`、`test`、`sample`、`check-cdc`
- **AND** 全局连接与输出格式参数可用

#### Scenario: 参数缺失

- **WHEN** 用户执行 `cz-cli datasource objects ds` 缺少 catalog
- **THEN** CLI 返回 usage error
- **AND** 不调用远端 API

### Requirement: 数据源发现按层级展开

本需求 MUST 按以下场景执行。

系统 MUST 支持 data source -> catalog/namespace -> object 的逐层发现。

#### Scenario: 列出 catalogs

- **WHEN** 用户执行 `cz-cli datasource catalogs mysql1 --format json`
- **THEN** 系统返回该数据源下 catalog/namespace/database 列表
- **AND** 字段名称适合 table 输出

#### Scenario: 列出 objects

- **WHEN** 用户执行 `cz-cli datasource objects mysql1 sales`
- **THEN** 系统返回 sales catalog 下的 table/topic/collection 列表
- **AND** 空结果返回 count 0

### Requirement: 数据源详情、连通性和样例数据可查询

本需求 MUST 按以下场景执行。

系统 MUST 支持 describe、test、sample 用于 agent 生成同步任务配置。

#### Scenario: describe object

- **WHEN** 用户执行 `cz-cli datasource describe mysql1 sales orders`
- **THEN** 系统返回字段、类型、主键或可用元数据

#### Scenario: 连接测试失败

- **WHEN** 用户执行 `cz-cli datasource test mysql1` 且连接失败
- **THEN** CLI 返回业务错误
- **AND** 错误中包含数据源名称和远端诊断

### Requirement: CDC 前置检查可执行

本需求 MUST 按以下场景执行。

`check-cdc` MUST 检查数据源是否满足实时同步前置条件。

#### Scenario: CDC 检查通过

- **WHEN** 用户执行 `cz-cli datasource check-cdc mysql1`
- **THEN** 输出 binlog/WAL/replication slot 等检查项结果
- **AND** agent 可据此继续创建 realtime sync task

#### Scenario: CDC 检查失败

- **WHEN** 检查项不满足
- **THEN** CLI 返回结构化失败项
- **AND** `ai_message` SHOULD 指导修复或选择 batch sync
