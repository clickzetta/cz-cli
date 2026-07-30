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

`cz-cli analytics-agent table update <dataset-id> --domain-id <id>` MUST 支持修改一个已加入域的 dataset 的 `displayName` 与/或 `description`。CLI MUST 全部使用 Analytics Agent open API：先调用 `POST /open/api/v1/analytics-agent/datasets/list`（请求体 `{domainIds:[<domain-id>]}`）按 domain 校验 dataset 归属，再调用 `POST /open/api/v1/analytics-agent/datasets/update` 进行局部更新。open update 会在服务端加载现有详情并覆盖请求字段，因此 CLI MUST 只提交 `datasetId` 和用户提供的更新字段（`--name` → `displayName`、`--description` → `description`），不得继续依赖非 open 的 MVC dataset 接口。datasets/list 分页返回（默认 `pageSize=10`），因此归属校验 MUST 翻页读取该域的**全部** dataset（逐页 `pageNum` 递增直到取满 `total`/遇到短页），再在合并后的完整集合中按 `datasetId` 定位；MUST NOT 只读第一页——否则域内表数超过一页时，落在后续页的 dataset 会被误判为「不在此 domain」而报 not found。`--domain-id` MUST 提供；`--name` 与 `--description` MUST 至少提供其一；提供 `--name` 时其值 MUST 非空。

> 说明：`table add --display-name` 只在**新建** dataset 时设置显示名；对**已存在**的 dataset 后端会忽略。要改已有表的显示名或描述必须用本命令。
> 已知后端限制：旧的非 open `dataset/detail?datasetId=<id>` 对某些域的 dataset 返回 `CZD-20009`（列表能查到、详情查不到），因此本命令改用按域过滤的 open dataset list 作为归属校验源。
> 分页陷阱：datasets/list 默认每页 10 条。曾经只读第一页，导致域内第 11 张表起（第 2 页）的 dataset 更新时报 `dataset <id> not found in domain <domain-id>`——这不是后端异步索引问题，而是 CLI 未翻页。现要求翻页读全。

#### Scenario: 经 dataset/list 读取后更新 displayName

- **WHEN** 用户执行 `cz-cli analytics-agent table update 82 --domain-id 27 --name "投标事实表"`
- **THEN** CLI MUST 先调用 `POST /open/api/v1/analytics-agent/datasets/list`，请求体含 `domainIds=[27]`
- **且** 在结果中按 `datasetId=82` 确认 dataset 属于该 domain
- **且** 再调用 `POST /open/api/v1/analytics-agent/datasets/update`
- **且** update 请求体仅包含 `datasetId=82` 与 `displayName=投标事实表`，不提交 `completeSchema` 等完整对象字段

#### Scenario: 同时更新 displayName 与 description

- **WHEN** 用户执行 `cz-cli analytics-agent table update 82 --domain-id 27 --name "投标事实表" --description "招投标明细"`
- **THEN** update 请求体中 `displayName` 为 `投标事实表`，`description` 为 `招投标明细`

#### Scenario: 只更新 description 时保留原 displayName

- **WHEN** 用户执行 `cz-cli analytics-agent table update 82 --domain-id 27 --description "只改描述"`
- **THEN** update 请求体中 `description` 为 `只改描述`
- **且** 请求体不包含 `displayName`，由 open update 在服务端保留原显示名

#### Scenario: 更新落在 dataset/list 第二页的 dataset

- **WHEN** 某域有 13 张表（`dataset/list` 默认每页 10 条，共 2 页），目标 `datasetId` 在第 2 页
- **AND** 用户执行 `cz-cli analytics-agent table update <id> --domain-id <domain-id> --name X`
- **THEN** CLI MUST 翻页读取所有页
- **且** 在合并集合中定位到该 dataset 并成功 `dataset/update`
- **且** MUST NOT 因只读第一页而报 `dataset <id> not found in domain`

#### Scenario: dataset 不在指定 domain 中时报错

- **WHEN** 用户执行 `cz-cli analytics-agent table update 82 --domain-id 27 --name X`
- **AND** domain 27 的 dataset 列表中（含所有分页）没有 datasetId=82
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

`cz-cli analytics-agent table semantics set` MUST 调用 dataset 维度的 Analytics Agent open API，对单个字段做结构化语义更新。命令 MUST 优先暴露常用扁平字段，不要求用户手写内部 DTO，也不把内部 JSON body 作为主路径。`alias` MAY 接受空白字符串以便清空/删除别名；`--semantic-type`、`--intended-type`、`--dict-code` 若提供则 MUST 非空。

#### Scenario: 更新字段语义成功

- **WHEN** 用户执行 `cz-cli analytics-agent table semantics set 195 31 --alias 订单日期 --description "订单日期" --semantic-type DATE_AND_TIME --intended-type DIM --intended-type FILTER`
- **THEN** CLI 调用 `PUT /open/api/v1/analytics-agent/datasets/195/semantics/31`
- **且** 请求体包含 `alias`、`description`、`semanticType`、`intendedTypes`
- **且** 命令输出包含更新后的字段语义摘要

#### Scenario: 缺少更新字段时拒绝请求

- **WHEN** 用户执行 `cz-cli analytics-agent table semantics set 195 31`
- **THEN** 命令返回参数错误
- **且** 不发送后端请求

#### Scenario: alias 为空时允许请求

- **WHEN** 用户执行 `cz-cli analytics-agent table semantics set 195 31 --alias "   "`
- **THEN** CLI MUST 发送请求
- **且** 请求体包含 `alias=["   "]`

#### Scenario: semantic-type 为空时本地拒绝

- **WHEN** 用户执行 `cz-cli analytics-agent table semantics set 195 31 --semantic-type "   "`
- **THEN** CLI MUST 在发请求前返回 `USAGE_ERROR`

#### Scenario: intended-type 为空时本地拒绝

- **WHEN** 用户执行 `cz-cli analytics-agent table semantics set 195 31 --intended-type "   "`
- **THEN** CLI MUST 在发请求前返回 `USAGE_ERROR`

#### Scenario: dict-code 为空时本地拒绝

- **WHEN** 用户执行 `cz-cli analytics-agent table semantics set 195 31 --dict-code "   "`
- **THEN** CLI MUST 在发请求前返回 `USAGE_ERROR`

#### Scenario: 重复 intended-type 被收集为数组

- **WHEN** 用户执行 `cz-cli analytics-agent table semantics set 195 31 --intended-type DIM --intended-type FILTER`
- **THEN** 请求体中的 `intendedTypes` 为 `["DIM","FILTER"]`

### Requirement: table semantics prop 支持轻量单属性更新

`cz-cli analytics-agent table semantics prop` MUST 支持按 positional `property + value` 更新单个字段属性，用于轻量修改隐藏、描述、语义类型等单一属性。`property` MUST 非空；`value` 对 `alias` 与 `description` MAY 为空以支持清空，其他属性的 `value` MUST 非空。

#### Scenario: 更新单个布尔属性

- **WHEN** 用户执行 `cz-cli analytics-agent table semantics prop 195 31 hidden true`
- **THEN** CLI 调用 `POST /open/api/v1/analytics-agent/datasets/195/semantics/31/prop`
- **且** 请求体包含 `property=hidden`
- **且** 请求体中的 `value` 为布尔值 `true`

#### Scenario: 更新单个数组属性

- **WHEN** 用户执行 `cz-cli analytics-agent table semantics prop 195 31 intendedTypes "[\"DIM\",\"FILTER\"]"`
- **THEN** CLI 调用 `POST /open/api/v1/analytics-agent/datasets/195/semantics/31/prop`
- **且** 请求体中的 `value` 为数组

#### Scenario: alias value 为空时允许请求

- **WHEN** 用户执行 `cz-cli analytics-agent table semantics prop 195 31 alias "   "`
- **THEN** CLI MUST 发送请求
- **且** 请求体包含 `property=alias` 与原始空白 `value`

#### Scenario: property 为空时本地拒绝

- **WHEN** 用户执行 `cz-cli analytics-agent table semantics prop 195 31 "   " x`
- **THEN** CLI MUST 在发请求前返回 `USAGE_ERROR`

#### Scenario: 非 alias/description 的 value 为空时本地拒绝

- **WHEN** 用户执行 `cz-cli analytics-agent table semantics prop 195 31 semanticType "   "`
- **THEN** CLI MUST 在发请求前返回 `USAGE_ERROR`

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
