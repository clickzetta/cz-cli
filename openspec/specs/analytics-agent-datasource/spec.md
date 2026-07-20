# analytics-agent datasource 规格说明

## Purpose

定义 Analytics Agent datasource 到 domain table 的主链路。CLI 只保留“找到 datasource / 浏览或搜索表 / 查看表 / 加载为 dataset / 绑定到 domain”这条确定性路径；旧的 `search-tables`、`show-table`、顶层 `datasource load` 等易混入口不再作为命令暴露。

## Requirements

### Requirement: datasource list 列出可用数据源

`cz-cli analytics-agent datasource list` MUST 调用 open datasource list API，并默认不请求详细连接信息。

#### Scenario: 列出 datasource

- **WHEN** 用户执行 `cz-cli analytics-agent datasource list`
- **THEN** CLI 调用 `GET /open/api/v1/datasources`
- **且** query 中包含 `tenantId` 与 `withDetail=false`

#### Scenario: 按名称过滤 datasource

- **WHEN** 用户执行 `cz-cli analytics-agent datasource list --name lake`
- **THEN** CLI 调用 datasource list API
- **且** query 中包含 `name=lake`

### Requirement: datasource browse 由 workspace/schema 合成 path

`cz-cli analytics-agent datasource browse <datasource-id>` MUST 使用用户传入的 `--workspace`、`--schema` 合成 browse path，而不是要求用户手写内部 path 字符串。

#### Scenario: Lakehouse 层级浏览 schema

- **WHEN** 用户执行 `cz-cli analytics-agent datasource browse 288 --workspace ai_workspace --schema hll_dws`
- **THEN** CLI 调用 `GET /open/api/v1/datasources/288/browse`
- **且** query 中包含 `path=workspace:ai_workspace/schema:hll_dws`

#### Scenario: 仅传 schema 时浏览 schema scope

- **WHEN** 用户执行 `cz-cli analytics-agent datasource browse 288 --schema public`
- **THEN** query 中包含 `path=schema:public`

### Requirement: datasource table search 按 scope 搜索表

`cz-cli analytics-agent datasource table search <datasource-id> <keyword>` MUST 在显式 workspace/schema scope 中搜索表。

#### Scenario: 搜索 Lakehouse 表

- **WHEN** 用户执行 `cz-cli analytics-agent datasource table search 288 driver --workspace ai_workspace --schema hll_dws`
- **THEN** CLI 调用 `GET /open/api/v1/datasources/288/tables/search`
- **且** query 中包含 `keyword=driver`
- **且** query 中包含 `path=workspace:ai_workspace/schema:hll_dws`

#### Scenario: 未传 workspace 时只按 schema 搜索

- **WHEN** 用户执行 `cz-cli analytics-agent datasource table search 288 orders --schema public`
- **THEN** query 中包含 `path=schema:public`

### Requirement: datasource table show 查看字段与预览

`cz-cli analytics-agent datasource table show <datasource-id>` MUST 使用 `--table` 指定表名，并用 workspace/schema 合成 path。CLI MUST 默认请求 columns，只有用户传入 `--preview` 时才请求 preview。

#### Scenario: 查看表结构

- **WHEN** 用户执行 `cz-cli analytics-agent datasource table show 288 --workspace ai_workspace --schema hll_dws --table dws_info_driver_daily_1d_tm`
- **THEN** CLI 调用 `GET /open/api/v1/datasources/288/tables/dws_info_driver_daily_1d_tm`
- **且** query 中包含 `path=workspace:ai_workspace/schema:hll_dws`
- **且** query 中包含 `includeColumns=true`
- **且** query 中包含 `includePreview=false`

#### Scenario: 查看表结构和预览

- **WHEN** 用户执行 `cz-cli analytics-agent datasource table show 288 --workspace ai_workspace --schema hll_dws --table dws_info_driver_daily_1d_tm --preview`
- **THEN** query 中包含 `includePreview=true`

### Requirement: datasource table load 加载表为 dataset

`cz-cli analytics-agent datasource table load <datasource-id>` MUST 使用 `--table` 指定表名，并把重复 `--domain-id` 组装为请求体中的 `domainIds` 数组。

#### Scenario: 加载表并绑定 domain

- **WHEN** 用户执行 `cz-cli analytics-agent datasource table load 288 --workspace ai_workspace --schema hll_dws --table dws_info_driver_daily_1d_tm --domain-id 195`
- **THEN** CLI 调用 `POST /open/api/v1/datasources/288/load`
- **且** 请求体为 `{"path":"workspace:ai_workspace/schema:hll_dws","tableName":"dws_info_driver_daily_1d_tm","domainIds":[195]}`

#### Scenario: 非法 domain-id 时拒绝请求

- **WHEN** 用户执行 `cz-cli analytics-agent datasource table load 288 --table orders --domain-id abc`
- **THEN** CLI 返回参数错误
- **且** 不发送 HTTP 请求

### Requirement: domain table add 直接绑定 datasource 表到 domain

`cz-cli analytics-agent domain table add <domain-id>` MUST 使用 `--table` 指定 datasource 内的表名，并直接调用 domain table add open API。CLI 不应把表名改写为 `v_gpt_*` 或 fullName；服务端负责查找已有 dataset、必要时加载 dataset，并绑定到 domain。

#### Scenario: 绑定 Lakehouse 表到 domain

- **WHEN** 用户执行 `cz-cli analytics-agent domain table add 195 --datasource-id 288 --workspace ai_workspace --schema hll_dws --table dws_info_driver_daily_1d_tm`
- **THEN** CLI 调用 `POST /open/api/v1/analytics-agent/domains/195/tables`
- **且** 请求体为 `{"datasourceId":288,"workspace":"ai_workspace","schema":"hll_dws","tableName":"dws_info_driver_daily_1d_tm"}`

#### Scenario: 缺少 table 时本地拒绝

- **WHEN** 用户执行 `cz-cli analytics-agent domain table add 195 --datasource-id 288 --workspace ai_workspace --schema hll_dws`
- **THEN** CLI 返回参数错误
- **且** 不发送 HTTP 请求
