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

### Requirement: table columns 作为 semantics list 的扁平别名

`cz-cli analytics-agent table columns <dataset-id>` MUST 作为 `table semantics list <dataset-id>` 的扁平别名，调用同一个 dataset 语义 open API 并返回相同结果，用于缩短查看数据集列语义的命令层级。

#### Scenario: columns 别名命中与 semantics list 相同的端点

- **WHEN** 用户执行 `cz-cli analytics-agent table columns 195`
- **THEN** CLI 调用 `GET /open/api/v1/analytics-agent/datasets/195/semantics`
- **且** 输出包含每个字段的 `attrId`、`attrCode`、`semanticType`、`description`、`hidden`
- **且** 输出与 `cz-cli analytics-agent table semantics list 195` 一致

### Requirement: table update 修改已加入域的表的显示名与描述

`cz-cli analytics-agent table update <dataset-id> --domain-id <id>` MUST 支持修改一个已加入域的 dataset 的 `displayName` 与/或 `description`。由于后端 `dataset/update` 接口需要**完整的 dataset 对象**，CLI MUST 采用 read-modify-write。read 源 MUST 使用 `POST /api/v1/dataset/list`（请求体 `{domainIds:[<domain-id>]}`）而**不是** `dataset/detail`——后者对部分域的 dataset 会返回 `CZD-20009`「数据集不存在」。CLI MUST 在 list 结果中按 `datasetId` 定位完整对象，仅改写用户提供的字段（`--name` → `displayName`、`--description` → `description`），再 `POST /api/v1/dataset/update` 把整个对象提交回去，不得只发部分字段（否则会清空其它字段）。`--domain-id` MUST 提供；`--name` 与 `--description` MUST 至少提供其一；提供 `--name` 时其值 MUST 非空。

> 说明：`table add --display-name` 只在**新建** dataset 时设置显示名；对**已存在**的 dataset 后端会忽略。要改已有表的显示名或描述必须用本命令。
> 已知后端限制：`dataset/detail?datasetId=<id>` 对某些域的 dataset 返回 `CZD-20009`（列表能查到、详情查不到），因此本命令改用按域过滤的 `dataset/list` 作为 read 源。

#### Scenario: 经 dataset/list 读取后更新 displayName

- **WHEN** 用户执行 `cz-cli analytics-agent table update 82 --domain-id 27 --name "投标事实表"`
- **THEN** CLI MUST 先调用 `POST /api/v1/dataset/list`，请求体含 `domainIds=[27]`
- **且** 在结果中按 `datasetId=82` 定位完整对象
- **且** 再调用 `POST /api/v1/dataset/update`，请求体为该完整对象且 `displayName` 改为 `投标事实表`
- **且** 请求体保留其它字段（如 `description`、`tableName`、`completeSchema`）

#### Scenario: 同时更新 displayName 与 description

- **WHEN** 用户执行 `cz-cli analytics-agent table update 82 --domain-id 27 --name "投标事实表" --description "招投标明细"`
- **THEN** 提交的对象中 `displayName` 为 `投标事实表`，`description` 为 `招投标明细`

#### Scenario: 只更新 description 时保留原 displayName

- **WHEN** 用户执行 `cz-cli analytics-agent table update 82 --domain-id 27 --description "只改描述"`
- **THEN** 提交的对象中 `description` 为 `只改描述`，`displayName` 保持列表中的原值

#### Scenario: dataset 不在指定 domain 中时报错

- **WHEN** 用户执行 `cz-cli analytics-agent table update 82 --domain-id 27 --name X`
- **AND** domain 27 的 dataset 列表中没有 datasetId=82
- **THEN** CLI MUST 报错说明该 dataset 不在此 domain 中，且不调用 update

#### Scenario: 缺少 --domain-id 时本地拒绝

- **WHEN** 用户执行 `cz-cli analytics-agent table update 82 --name X`
- **THEN** CLI MUST 在发请求前返回 `USAGE_ERROR`

#### Scenario: 既不给 --name 也不给 --description 时本地拒绝

- **WHEN** 用户执行 `cz-cli analytics-agent table update 82 --domain-id 27`
- **THEN** CLI MUST 在发请求前返回 `USAGE_ERROR`

#### Scenario: 空 --name 本地拒绝

- **WHEN** 用户执行 `cz-cli analytics-agent table update 82 --domain-id 27 --name "   "`
- **THEN** CLI MUST 在发请求前返回 `USAGE_ERROR`

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
