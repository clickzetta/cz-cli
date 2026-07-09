# analytics-agent datasource 规格说明

## Purpose
定义 `cz-cli analytics-agent datasource load` 的用户可见参数面，确保多 domain 绑定使用重复 `--domain-id` 输入，而不是要求用户手写 JSON 数组或内部 body。

## Requirements

### Requirement: datasource show-table 兼容 browse path 输入并在层级数据源上要求明确 path

`cz-cli analytics-agent datasource show-table` MUST 兼容直接复用 `browse` 输出的 `workspace:.../schema:.../table:...` 路径字符串。当目标数据源是多层级 browse 模型时，CLI MUST 在缺少 scope 的情况下拒绝直接发起重请求，提示用户补 `--path` 或直接传 browse path。

#### Scenario: show-table 接受 browse path 位置参数

- **WHEN** 用户执行 `cz-cli analytics-agent datasource show-table 11 workspace:ws/schema:ods/table:orders`
- **THEN** CLI 调用 `GET /open/api/v1/datasources/11/tables/orders`
- **且** query 中自动带上 `path=workspace:ws/schema:ods`

#### Scenario: 多层级数据源缺少 path 时本地拦截

- **WHEN** 用户执行 `cz-cli analytics-agent datasource show-table 11 orders`
- **AND** `datasource meta` 返回 browse levels 为 `workspace/schema/table`
- **THEN** CLI 返回参数错误
- **且** 错误信息要求用户补 `--path` 或直接复用 browse path
- **且** 不发送真正的 `show-table` 请求

### Requirement: datasource search-tables 在多层级数据源上要求显式搜索 scope

`cz-cli analytics-agent datasource search-tables` 在多层级 browse 数据源上 MUST 要求用户显式提供 `--path`，避免直接扫全量 workspace/schema 造成超时。

#### Scenario: 多层级数据源未传 path 时拒绝全局搜索

- **WHEN** 用户执行 `cz-cli analytics-agent datasource search-tables 11 --keyword orders`
- **AND** `datasource meta` 返回 browse levels 为 `workspace/schema/table`
- **THEN** CLI 返回参数错误
- **且** 错误信息要求补 `--path`
- **且** 不发送真正的 `search-tables` 请求

### Requirement: datasource load 使用重复 domain-id 参数

`cz-cli analytics-agent datasource load` MUST 支持重复 `--domain-id` 输入，并将其组装为请求体中的 `domainIds` 数组。普通用户主路径不应再暴露 `--domain-ids` 或 `--body`。

#### Scenario: load 用重复 domain-id 组装数组

- **WHEN** 用户执行 `cz-cli analytics-agent datasource load 11 --table-name orders --path workspace:w/schema:s --domain-id 195 --domain-id 196`
- **THEN** CLI 调用 datasource load open API
- **且** 请求体中的 `domainIds` 为 `[195,196]`

#### Scenario: load 传入非法 domain-id 时本地拒绝

- **WHEN** 用户执行 `cz-cli analytics-agent datasource load 11 --table-name orders --path workspace:w/schema:s --domain-id abc`
- **THEN** CLI MUST 在发请求前直接返回 `USAGE_ERROR`
- **且** 错误信息 MUST 明确说明 `--domain-id` 必须是正整数

#### Scenario: help 不再暴露 domain-ids 和 body

- **WHEN** 用户执行 `cz-cli analytics-agent datasource load --help`
- **THEN** help 中不包含 `--domain-ids`
- **且** help 中不包含 `--body`

### Requirement: datasource load 在多层级数据源上要求明确 path

当目标数据源是多层级 browse 模型时，`cz-cli analytics-agent datasource load` MUST 在缺少 scope 的情况下拒绝直接发起加载请求，提示用户补 `--path` 或把 browse path 直接写进 `--table-name`。

#### Scenario: load 缺少 path 时本地拦截

- **WHEN** 用户执行 `cz-cli analytics-agent datasource load 11 --table-name orders --domain-id 195`
- **AND** `datasource meta` 返回 browse levels 为 `workspace/schema/table`
- **THEN** CLI 返回参数错误
- **且** 错误信息要求补 `--path` 或把 browse path 直接写进 `--table-name`
- **且** 不发送真正的 `load` 请求
