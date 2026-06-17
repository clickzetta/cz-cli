# table-management 规格说明

## Purpose
定义 `cz-cli table` 命令族：`list`、`describe`、`preview`、`stats`、`history`、`create`、`drop`。

## Requirements
### Requirement: Table 命令 help 签名稳定

本需求 MUST 按以下场景执行。

`table` 命令族 MUST 通过 help 暴露当前子命令和参数。

#### Scenario: table group help

- **WHEN** 用户执行 `cz-cli table --help`
- **THEN** help 显示 `list`、`describe <name>`、`preview <name>`、`stats <name>`、`history [name]`、`create [ddl]`、`drop <name>`
- **AND** 全局 `--format` 可用

#### Scenario: create help

- **WHEN** 用户执行 `cz-cli table create --help`
- **THEN** help MUST 说明支持 inline DDL 或文件输入（如果当前实现提供 `--from-file`/等价参数）
- **AND** 调用方以实际 help 为准

### Requirement: 列出 tables

本需求 MUST 按以下场景执行。

系统 MUST 列出当前或指定 schema 中的表。

#### Scenario: 列出全部表

- **WHEN** 用户执行 `cz-cli table list --format table`
- **THEN** 系统返回表名称和 schema 等主要字段
- **AND** 表格列为一行一表

#### Scenario: 过滤和限制

- **WHEN** 用户执行 `cz-cli table list --schema public --like 'order%' --limit 50`
- **THEN** 系统应用 schema、like 和 limit 过滤（若命令 help 声明这些参数）
- **AND** 未声明的过滤参数 MUST 返回 usage error

### Requirement: 描述和预览表

本需求 MUST 按以下场景执行。

系统 MUST 支持表结构描述和数据预览。

#### Scenario: 描述表

- **WHEN** 用户执行 `cz-cli table describe orders`
- **THEN** 系统返回列、类型和可用元数据

#### Scenario: 预览限制

- **WHEN** 用户执行 `cz-cli table preview orders --limit 10`
- **THEN** 系统最多返回 10 行
- **AND** limit 非法时返回 usage/business error

### Requirement: 表统计和历史

本需求 MUST 按以下场景执行。

系统 MUST 支持表统计和历史查询。

#### Scenario: 表统计

- **WHEN** 用户执行 `cz-cli table stats orders`
- **THEN** 系统返回 row count 或 job summary 等统计字段

#### Scenario: 表历史为空

- **WHEN** 用户执行 `cz-cli table history missing --limit 100` 且没有历史记录
- **THEN** 系统返回空列表或 not found
- **AND** 错误/空态必须可区分

### Requirement: 创建和删除表

本需求 MUST 按以下场景执行。

系统 MUST 支持通过 DDL 创建表和删除表。

#### Scenario: inline DDL 创建

- **WHEN** 用户执行 `cz-cli table create "CREATE TABLE t(a INT)"`
- **THEN** 系统执行 DDL
- **AND** 返回执行结果

#### Scenario: drop 失败

- **WHEN** 用户执行 `cz-cli table drop orders` 但权限不足或表不存在
- **THEN** CLI 返回业务错误
- **AND** 不输出误导性成功
