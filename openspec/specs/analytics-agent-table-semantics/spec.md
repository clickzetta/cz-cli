# analytics-agent table semantics 规格说明

## Purpose
定义 `cz-cli analytics-agent table semantics` 命令组与对应 open API 的行为，确保数据集字段语义查看与更新能力在 Analytics Agent 路径下可用，并保持与现有 open token 鉴权风格一致。

## Requirements

### Requirement: table semantics list 列出指定数据集的字段语义

`cz-cli analytics-agent table semantics list` MUST 调用 dataset 维度的 Analytics Agent open API，并返回指定数据集字段的语义信息列表。

#### Scenario: 列出字段语义

- **WHEN** 用户执行 `cz-cli analytics-agent table semantics list 195`
- **THEN** CLI 调用 `GET /open/api/v1/analytics-agent/datasets/195/semantics`
- **且** 请求包含 open token 鉴权和 `tenantId` query
- **且** 输出包含每个字段的 `attrId`、`attrCode`、`semanticType`、`description`、`hidden`

### Requirement: table semantics get 查看单个字段语义详情

`cz-cli analytics-agent table semantics get` MUST 支持按 `datasetId + attrId` 查看单个字段的语义详情。

#### Scenario: 查看字段语义详情

- **WHEN** 用户执行 `cz-cli analytics-agent table semantics get 195 31`
- **THEN** CLI 调用 `GET /open/api/v1/analytics-agent/datasets/195/semantics/31`
- **且** 输出包含 `attrId`、`attrCode`、`alias`、`description`、`semanticType`、`semanticTypeProperties`、`intendedTypes`

#### Scenario: 不存在的字段返回明确错误

- **WHEN** 用户调用 `GET /open/api/v1/analytics-agent/datasets/195/semantics/999999`
- **THEN** 后端返回字段不存在错误
- **且** CLI 不把该错误误判成路由或鉴权问题

### Requirement: table semantics set 支持扁平化常用字段更新

`cz-cli analytics-agent table semantics set` MUST 调用 dataset 维度的 Analytics Agent open API，对单个字段做结构化语义更新。命令 MUST 优先暴露常用扁平字段，不要求用户手写内部 DTO，也不把内部 JSON body 作为主路径。

#### Scenario: 更新字段语义成功

- **WHEN** 用户执行 `cz-cli analytics-agent table semantics set 195 31 --alias 订单日期 --description "订单日期" --semantic-type DATE_AND_TIME --intended-type DIM --intended-type FILTER`
- **THEN** CLI 调用 `PUT /open/api/v1/analytics-agent/datasets/195/semantics/31`
- **且** 请求体包含 `alias`、`description`、`semanticType`、`intendedTypes`
- **且** 命令输出包含更新后的字段语义摘要

#### Scenario: 缺少更新字段时拒绝请求

- **WHEN** 用户执行 `cz-cli analytics-agent table semantics set 195 31`
- **THEN** 命令返回参数错误
- **且** 不发送后端请求

#### Scenario: 重复 intended-type 被收集为数组

- **WHEN** 用户执行 `cz-cli analytics-agent table semantics set 195 31 --intended-type DIM --intended-type FILTER`
- **THEN** 请求体中的 `intendedTypes` 为 `["DIM","FILTER"]`

### Requirement: table semantics prop 支持轻量单属性更新

`cz-cli analytics-agent table semantics prop` MUST 支持按 positional `property + value` 更新单个字段属性，用于轻量修改隐藏、描述、语义类型等单一属性。

#### Scenario: 更新单个布尔属性

- **WHEN** 用户执行 `cz-cli analytics-agent table semantics prop 195 31 hidden true`
- **THEN** CLI 调用 `POST /open/api/v1/analytics-agent/datasets/195/semantics/31/prop`
- **且** 请求体包含 `property=hidden`
- **且** 请求体中的 `value` 为布尔值 `true`

#### Scenario: 更新单个数组属性

- **WHEN** 用户执行 `cz-cli analytics-agent table semantics prop 195 31 intendedTypes "[\"DIM\",\"FILTER\"]"`
- **THEN** CLI 调用 `POST /open/api/v1/analytics-agent/datasets/195/semantics/31/prop`
- **且** 请求体中的 `value` 为数组

#### Scenario: dataset-id 非法时本地拒绝 prop 请求

- **WHEN** 用户执行 `cz-cli analytics-agent table semantics prop abc 31 hidden true`
- **THEN** CLI MUST 在发请求前直接返回 `USAGE_ERROR`
- **且** 错误信息 MUST 明确说明 `--dataset-id` 必须是正整数

#### Scenario: attr-id 非法时本地拒绝 prop 请求

- **WHEN** 用户执行 `cz-cli analytics-agent table semantics prop 195 abc hidden true`
- **THEN** CLI MUST 在发请求前直接返回 `USAGE_ERROR`
- **且** 错误信息 MUST 明确说明 `--attr-id` 必须是正整数

#### Scenario: 不支持的 property 返回明确错误

- **WHEN** 用户调用 `POST /open/api/v1/analytics-agent/datasets/195/semantics/31/prop`，请求体中 `property=unknownFlag`
- **THEN** 后端返回参数错误
- **且** 错误信息明确指出该 property 不受支持

#### Scenario: 缺少 property 或 value 时拒绝请求

- **WHEN** 用户执行 `cz-cli analytics-agent table semantics prop 195 31`
- **THEN** 命令返回参数错误
- **且** 不发送后端请求
