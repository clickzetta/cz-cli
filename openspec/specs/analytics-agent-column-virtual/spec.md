# analytics-agent column virtual 规格说明

## Purpose
定义 `cz-cli analytics-agent column virtual` 命令组与对应 open API 的行为，确保虚拟列编译、创建、删除和列表能力在 Analytics Agent 路径下可用，并保持与现有 open token 鉴权风格一致。

## Requirements

### Requirement: column virtual compile 走 dataset 维度 open API 并支持 expression 主路径

`cz-cli analytics-agent column virtual compile` MUST 调用 dataset 维度的 Analytics Agent open API。命令 MUST 支持 `--dataset-id`、`--name`、`--type`，并以 `--expression` 作为主输入；当用户未传 `--expression` 时，MUST 支持 `--logic-rule` 兼容输入。

当 profile 中存在 Analytics Agent 专用 open token 上下文时，CLI MUST 优先使用该上下文里的 `token`、`tenant_id`、`user_id`，而不是回退到普通 studio 登录态推导出的 tenant。

#### Scenario: 使用 expression 编译虚拟列

- **WHEN** 用户执行 `cz-cli analytics-agent column virtual compile --dataset-id 195 --name profit_rate --type double --expression "amount / qty"`
- **THEN** CLI 调用 `POST /open/api/v1/analytics-agent/datasets/195/virtual-columns/compile`
- **且** 请求体包含 `name`、`type`、`expression`
- **且** 命令输出包含 `datasetId`、`name`、`type` 和试运行样本值

#### Scenario: 使用 logic-rule 兼容输入编译虚拟列

- **WHEN** 用户执行 `cz-cli analytics-agent column virtual compile --dataset-id 195 --name profit_rate --type double --logic-rule "{\"expression\":\"amount / qty\"}"`
- **THEN** CLI 仍然调用 `POST /open/api/v1/analytics-agent/datasets/195/virtual-columns/compile`
- **且** 请求体包含 `logicRule`
- **且** 不要求同时传 `--expression`

#### Scenario: compile 的 body 不是合法 JSON 时拒绝请求

- **WHEN** 用户执行 `cz-cli analytics-agent column virtual compile --dataset-id 195 --name profit_rate --type double --body "{bad json}"`
- **THEN** 命令返回参数错误
- **且** 不发送后端请求

#### Scenario: profile 中已有 open token 上下文时优先使用该 tenant

- **WHEN** 当前 profile 的 `agent.token`、`agent.tenant_id`、`agent.user_id` 已配置
- **THEN** CLI 对 `column virtual compile` 的请求 query MUST 使用 `agent.tenant_id`
- **且** `Authorization` MUST 使用 `agent.token`

### Requirement: column virtual set 创建并持久化虚拟列

`cz-cli analytics-agent column virtual set` MUST 调用 Analytics Agent open API 创建并持久化虚拟列。第一版 MUST 只支持新增，不应暗示更新已有虚拟列。

#### Scenario: 创建虚拟列成功

- **WHEN** 用户执行 `cz-cli analytics-agent column virtual set --dataset-id 195 --name profit_rate --type double --expression "amount / qty"`
- **THEN** CLI 调用 `POST /open/api/v1/analytics-agent/datasets/195/virtual-columns`
- **且** 请求体包含 `name`、`type`、`expression`
- **且** 命令输出包含已创建虚拟列的 `attrId`、`datasetId`、`name`、`type`

#### Scenario: 缺少表达式输入时拒绝请求

- **WHEN** 用户执行 `cz-cli analytics-agent column virtual set --dataset-id 195 --name profit_rate --type double`
- **THEN** 命令返回参数错误
- **且** 不发送后端请求

#### Scenario: set 的 body 不是合法 JSON 时拒绝请求

- **WHEN** 用户执行 `cz-cli analytics-agent column virtual set --dataset-id 195 --name profit_rate --type double --body "{bad json}"`
- **THEN** 命令返回参数错误
- **且** 不发送后端请求

### Requirement: column virtual list 只返回虚拟列

`cz-cli analytics-agent column virtual list` MUST 只返回指定数据集中的虚拟列，而不是整张表的全部字段。命令 SHOULD 支持通过 positional 或 `--dataset-id` 指定数据集。

#### Scenario: 列出虚拟列

- **WHEN** 用户执行 `cz-cli analytics-agent column virtual list 195`
- **THEN** CLI 调用 `GET /open/api/v1/analytics-agent/datasets/195/virtual-columns`
- **且** 输出只包含带虚拟列规则的字段
- **且** 每条结果包含 `attrId`、`datasetId`、`name`、`type`、`expression`

#### Scenario: 普通字段不会出现在列表中

- **WHEN** 数据集同时包含普通字段和虚拟列
- **THEN** `column virtual list` 的输出不包含没有虚拟列规则的普通字段

### Requirement: column virtual delete 走 dataset 维度 open API

`cz-cli analytics-agent column virtual delete` MUST 调用 dataset 维度的 Analytics Agent open API 删除虚拟列。后端 MUST 只允许删除带 `logicRule` 的虚拟列，不能因为知道 `attrId` 就删除普通字段。

#### Scenario: 删除虚拟列

- **WHEN** 用户执行 `cz-cli analytics-agent column virtual delete --dataset-id 195 --attr-id 31`
- **THEN** CLI 调用 `DELETE /open/api/v1/analytics-agent/datasets/195/virtual-columns/31`
- **且** 请求包含 open token 鉴权和 `tenantId` query

#### Scenario: 缺少 attr-id 时拒绝执行

- **WHEN** 用户执行 `cz-cli analytics-agent column virtual delete --dataset-id 195`
- **THEN** 命令返回参数错误
- **且** 不发送后端请求

#### Scenario: attr-id 对应普通字段时拒绝删除

- **WHEN** 用户调用 `DELETE /open/api/v1/analytics-agent/datasets/195/virtual-columns/11`，且 `attrId=11` 对应的是普通字段
- **THEN** 后端拒绝删除请求
- **且** 不会调用通用字段删除逻辑删除该普通字段
