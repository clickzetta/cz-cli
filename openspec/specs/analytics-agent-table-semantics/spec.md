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

### Requirement: table semantics set 支持结构化更新字段语义

`cz-cli analytics-agent table semantics set` MUST 调用 dataset 维度的 Analytics Agent open API，对单个字段做结构化语义更新。命令 MUST 支持直接传常用语义字段，而不要求用户手写内部 DTO。

#### Scenario: 更新字段语义成功

- **WHEN** 用户执行 `cz-cli analytics-agent table semantics set 195 31 --semantic-type DATE_AND_TIME --semantic-type-properties "{\"dataFormat\":\"yyyy-MM-dd\"}" --description "订单日期" --intended-types "[\"DIM\",\"FILTER\"]"`
- **THEN** CLI 调用 `PUT /open/api/v1/analytics-agent/datasets/195/semantics/31`
- **且** 请求体包含 `semanticType`、`semanticTypeProperties`、`description`、`intendedTypes`
- **且** 命令输出包含更新后的字段语义摘要

#### Scenario: 缺少更新字段时拒绝请求

- **WHEN** 用户执行 `cz-cli analytics-agent table semantics set 195 31`
- **THEN** 命令返回参数错误
- **且** 不发送后端请求

#### Scenario: 结构化 JSON 参数非法时拒绝请求

- **WHEN** 用户执行 `cz-cli analytics-agent table semantics set 195 31 --semantic-type-properties "{bad json}"`
- **THEN** 命令返回参数错误
- **且** 错误信息明确指出非法 JSON 参数
- **且** 不发送后端请求

### Requirement: table semantics prop 支持单属性更新

`cz-cli analytics-agent table semantics prop` MUST 支持按 `property + value` 更新单个字段属性，用于轻量修改隐藏、描述、语义类型等单一属性。

#### Scenario: 更新单个布尔属性

- **WHEN** 用户执行 `cz-cli analytics-agent table semantics prop 195 31 --property hidden --value true`
- **THEN** CLI 调用 `POST /open/api/v1/analytics-agent/datasets/195/semantics/31/prop`
- **且** 请求体包含 `property=hidden`
- **且** 请求体中的 `value` 为布尔值 `true`

#### Scenario: 更新单个数组属性

- **WHEN** 用户执行 `cz-cli analytics-agent table semantics prop 195 31 --property intendedTypes --value "[\"DIM\",\"FILTER\"]"`
- **THEN** CLI 调用 `POST /open/api/v1/analytics-agent/datasets/195/semantics/31/prop`
- **且** 请求体中的 `value` 为数组

#### Scenario: 不支持的 property 返回明确错误

- **WHEN** 用户调用 `POST /open/api/v1/analytics-agent/datasets/195/semantics/31/prop`，请求体中 `property=unknownFlag`
- **THEN** 后端返回参数错误
- **且** 错误信息明确指出该 property 不受支持

#### Scenario: 缺少 property 时拒绝请求

- **WHEN** 用户执行 `cz-cli analytics-agent table semantics prop 195 31 --value true`
- **THEN** 命令返回参数错误
- **且** 不发送后端请求
