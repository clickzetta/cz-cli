# schema-management 规格说明

## Purpose
定义 `cz-cli schema` 命令族：`list`、`describe`、`create`、`drop`。

## Requirements
### Requirement: Schema 命令 help 签名稳定

本需求 MUST 按以下场景执行。

`schema` 命令族 MUST 通过 help 暴露准确子命令和参数。

#### Scenario: schema group help

- **WHEN** 用户执行 `cz-cli schema --help`
- **THEN** help 显示 `list`、`describe <name>`、`create <name>`、`drop <name>`
- **AND** 全局连接与输出选项可见

#### Scenario: 未知子命令

- **WHEN** 用户执行 `cz-cli schema missing`
- **THEN** CLI 返回 usage error
- **AND** 提示查看 `cz-cli schema --help`

### Requirement: 列出 schemas

本需求 MUST 按以下场景执行。

系统 MUST 能列出当前 workspace/instance 下可见 schema。

#### Scenario: 列出全部 schema

- **WHEN** 用户执行 `cz-cli schema list --format json`
- **THEN** 系统返回 schema 列表
- **AND** table 格式下关键字段位于顶层行

#### Scenario: 结果为空

- **WHEN** 当前上下文没有可见 schema
- **THEN** 系统返回空列表和 count 0
- **AND** 不输出错误占位符

### Requirement: 描述 schema

本需求 MUST 按以下场景执行。

系统 MUST 支持按名称获取 schema 元数据。

#### Scenario: schema 存在

- **WHEN** 用户执行 `cz-cli schema describe public`
- **THEN** 系统返回 schema 名称、owner/metadata 等可用信息

#### Scenario: schema 不存在

- **WHEN** 用户描述不存在的 schema
- **THEN** CLI 返回 not found 或 SQL/SDK 错误
- **AND** 错误中包含请求的 schema 名称

### Requirement: 创建和删除 schema

本需求 MUST 按以下场景执行。

系统 MUST 支持创建和删除 schema，并把破坏性操作以清晰错误暴露。

#### Scenario: 创建 schema

- **WHEN** 用户执行 `cz-cli schema create analytics`
- **THEN** 系统执行创建语句或 API
- **AND** 返回创建结果

#### Scenario: 删除失败

- **WHEN** 用户执行 `cz-cli schema drop analytics` 但 schema 非空或权限不足
- **THEN** CLI 返回业务错误
- **AND** 不把失败渲染成成功空结果
