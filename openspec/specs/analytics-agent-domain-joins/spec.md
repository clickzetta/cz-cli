# analytics-agent domain join 规格说明

## Purpose

定义 `cz-cli analytics-agent domain join` 命令组的用户可见参数设计。Join 关系的主路径是确定性的手动增删改查；自动发现 join 属于 agent/skill 工作流，不作为 CLI 主命令路径。

## Requirements

### Requirement: join list 查询已生效关系

`cz-cli analytics-agent domain join list <domain-id>` MUST 调用 open API 查询指定业务域下已生效的 join 关系，并支持常用过滤参数。

#### Scenario: 列出业务域 join

- **WHEN** 用户执行 `cz-cli analytics-agent domain join list 195`
- **THEN** CLI 调用 `GET /open/api/v1/analytics-agent/domains/195/joins`
- **且** query 中包含 `tenantId`
- **且** 输出服务端返回的 join 列表

#### Scenario: 使用过滤参数查询 join

- **WHEN** 用户执行 `cz-cli analytics-agent domain join list 195 --dataset-id 1773 --join-dataset-id 1774 --keyword customer`
- **THEN** CLI 调用 join list API
- **且** query 中包含 `datasetId=1773`、`joinDatasetId=1774`、`keyword=customer`

### Requirement: join get 查询单条关系

`cz-cli analytics-agent domain join get <domain-id> <join-id>` MUST 查询指定 join 关系详情。

#### Scenario: 查询 join 详情

- **WHEN** 用户执行 `cz-cli analytics-agent domain join get 195 301`
- **THEN** CLI 调用 `GET /open/api/v1/analytics-agent/domains/195/joins/301`
- **且** 输出服务端返回的 join 详情

#### Scenario: join-id 非正整数时拒绝请求

- **WHEN** 用户执行 `cz-cli analytics-agent domain join get 195 0`
- **THEN** CLI 返回参数错误
- **且** 不发送 HTTP 请求

### Requirement: join create 手动创建关系

`cz-cli analytics-agent domain join create <domain-id>` MUST 使用显式参数构造请求体，不要求用户填写 `tableName` 或 `joinTableName`。

#### Scenario: 创建 n:1 join

- **WHEN** 用户执行 `cz-cli analytics-agent domain join create 195 --dataset-id 1773 --attr-code customer_id --join-dataset-id 1774 --join-attr-code id --relation n:1`
- **THEN** CLI 调用 `POST /open/api/v1/analytics-agent/domains/195/joins`
- **且** 请求体包含 `datasetId`、`attrCode`、`joinDatasetId`、`joinAttrCode`、`relation`
- **且** 请求体不包含 `tableName` 或 `joinTableName`

#### Scenario: 缺少创建必填参数时拒绝请求

- **WHEN** 用户执行 `cz-cli analytics-agent domain join create 195 --dataset-id 1773`
- **THEN** CLI 返回参数错误
- **且** 不发送 HTTP 请求

### Requirement: join update 手动更新关系

`cz-cli analytics-agent domain join update <domain-id> <join-id>` MUST 使用与 create 相同的显式参数构造更新请求体。

#### Scenario: 更新 join 关系

- **WHEN** 用户执行 `cz-cli analytics-agent domain join update 195 301 --dataset-id 1773 --attr-code buyer_id --join-dataset-id 1774 --join-attr-code id --relation MANY_TO_ONE`
- **THEN** CLI 调用 `PUT /open/api/v1/analytics-agent/domains/195/joins/301`
- **且** 请求体包含更新后的 join 字段

#### Scenario: 缺少更新必填参数时拒绝请求

- **WHEN** 用户执行 `cz-cli analytics-agent domain join update 195 301 --relation n:1`
- **THEN** CLI 返回参数错误
- **且** 不发送 HTTP 请求

### Requirement: join delete 删除关系

`cz-cli analytics-agent domain join delete <domain-id> <join-id>` MUST 删除指定 join 关系。

#### Scenario: 删除 join

- **WHEN** 用户执行 `cz-cli analytics-agent domain join delete 195 301`
- **THEN** CLI 调用 `DELETE /open/api/v1/analytics-agent/domains/195/joins/301`
- **且** 输出服务端返回的删除结果

#### Scenario: domain-id 非正整数时拒绝请求

- **WHEN** 用户执行 `cz-cli analytics-agent domain join delete 0 301`
- **THEN** CLI 返回参数错误
- **且** 不发送 HTTP 请求
