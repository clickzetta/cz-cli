# analytics-agent 规格说明

## Purpose
定义 `cz-cli analytics-agent` 命令族对 Analytics Agent 服务、domain、datasource、session 等 API 的封装要求。

## Requirements
### Requirement: profile service 自动推导 Analytics Agent endpoint

Analytics Agent 命令 MUST 在 active profile 未显式配置 `analysis_agent_endpoint` 时，根据 profile 的 `service` 与 `protocol` 自动推导服务地址。推导规则 MUST 使用规范化后的 service URL 并追加 `/clickzetta-campaign-data`，例如 `service=uat-api.clickzetta.com`、`protocol=https` 推导为 `https://uat-api.clickzetta.com/clickzetta-campaign-data`。显式 `analysis_agent_endpoint` MUST 优先于推导结果；兼容旧配置的 `agent.endpoint` MUST 优先于 service 推导但低于 `analysis_agent_endpoint`。

#### Scenario: 根据 service 自动推导 endpoint

- **WHEN** active profile 仅配置 `service = "uat-api.clickzetta.com"` 与 `protocol = "https"`，未配置 `analysis_agent_endpoint` 或 `agent.endpoint`
- **THEN** 用户执行任意 `cz-cli analytics-agent ...` 命令时
- **AND** CLI MUST 使用 `https://uat-api.clickzetta.com/clickzetta-campaign-data` 作为 Analytics Agent endpoint
- **AND** 不要求用户额外执行 `profile update analysis_agent_endpoint`

#### Scenario: 显式 endpoint 优先于自动推导

- **WHEN** active profile 同时配置 `analysis_agent_endpoint = "https://custom.example/agent"` 与 `service = "uat-api.clickzetta.com"`
- **THEN** CLI MUST 使用 `https://custom.example/agent`
- **AND** 不覆盖或忽略显式配置

#### Scenario: 旧 agent endpoint 优先于自动推导

- **WHEN** active profile 配置 `agent.endpoint = "https://legacy.example/agent"` 且未配置 `analysis_agent_endpoint`
- **THEN** CLI MUST 使用 `https://legacy.example/agent`
- **AND** 不使用 service 推导结果

### Requirement: knowledge create/update MUST bind domainIds from --domain-ids JSON arrays

`cz-cli analytics-agent knowledge create` 和 `cz-cli analytics-agent knowledge update` MUST 将命令行 `--domain-ids` 规范化为请求体中的 `domainIds` 数组，并在缺少或传入非 JSON 数组、非正整数时本地报错，避免创建出未绑定任何域的 knowledge。单域示例 MUST 使用 `--domain-ids '[5]'`；多域示例 MUST 使用 `--domain-ids '[5,6]'`。

#### Scenario: knowledge create 使用单个 --domain-ids 绑定 domainIds

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge create --domain-ids '[5]' --content hello`
- **THEN** CLI 调用 knowledge create open API
- **AND** 请求体包含 `domainIds=[5]`

#### Scenario: knowledge update 使用多个 --domain-ids 绑定 domainIds

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge update 42 --domain-ids '[5,6]'`
- **THEN** CLI 调用 knowledge update open API
- **AND** 请求体包含 `domainIds=[5,6]`

#### Scenario: knowledge create 缺少 --domain-ids 时本地报错

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge create --content hello`
- **THEN** CLI MUST 在发请求前直接返回 `USAGE_ERROR`
- **AND** 错误信息 MUST 明确说明需要 `--domain-ids`

### Requirement: body domainIds commands MUST validate --domain-ids JSON arrays

所有通过请求体字段 `domainIds` 绑定分析域的 Analytics Agent 命令 MUST 将命令行 `--domain-ids` 规范化为正整数 JSON 数组；传入缺值、非 JSON 数组、非数字、非整数或非正数时 MUST 在发请求前返回 `USAGE_ERROR`。路径参数或查询过滤使用的 `domainId` 不属于本规则，MUST 保持单值 `domainId`。

#### Scenario: metric create 使用单个 --domain-ids 绑定 domainIds

- **WHEN** 用户执行 `cz-cli analytics-agent metric create --domain-ids '[5]' ...`
- **THEN** CLI 调用 metric create open API
- **AND** 请求体包含 `domainIds=[5]`

#### Scenario: metric create 使用多个 --domain-ids 绑定 domainIds

- **WHEN** 用户执行 `cz-cli analytics-agent metric create --domain-ids '[5,6]' ...`
- **THEN** CLI 调用 metric create open API
- **AND** 请求体包含 `domainIds=[5,6]`

#### Scenario: answer-builder list 使用 --domain-ids 过滤多个 domainIds

- **WHEN** 用户执行 `cz-cli analytics-agent answer-builder list --domain-ids '[5,6]'`
- **THEN** CLI 调用 answer-builder list open API
- **AND** 请求体包含 `domainIds=[5,6]`

#### Scenario: knowledge file upload 使用 --domain-ids 绑定上传文件

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge file upload 1 ./a.txt --domain-ids '[5,6]'`
- **THEN** CLI 调用 knowledge upload-url open API
- **AND** 请求体包含 `domainIds=[5,6]`

#### Scenario: domainId 路径和查询命令保持单值

- **WHEN** 用户执行 domain/session/knowledge list 等使用路径参数或查询参数 `domainId` 的命令
- **THEN** CLI MUST 继续传递单值 `domainId`
- **AND** 不将这些参数改写为 `domainIds`

### Requirement: Analytics Agent ID flags MUST fail before requests when invalid

Analytics Agent 命令中以 `-id` 结尾且代表数字 ID 的参数 MUST 在发起请求前完成本地校验，避免 `NaN` 被序列化成 `null`、路径中出现 `/NaN`，或把无效 `session-id` 误判为“未传 session-id”。除明确允许 `0` 的 `parent-id` 外，数字 ID MUST 是正整数；`parent-id` MUST 是非负整数；`task-id` 作为后端返回的字符串任务标识不适用本规则。

#### Scenario: session run 不将无效 session-id 当作缺失

- **WHEN** 用户执行 `cz-cli analytics-agent session run --session-id abc --domain-id 5 --msg hello`
- **THEN** CLI MUST 在发请求前返回 `USAGE_ERROR`
- **AND** 错误信息 MUST 指向 `--session-id`
- **AND** CLI MUST NOT 自动创建新 session

#### Scenario: 路径 ID 不允许生成 /NaN 路径

- **WHEN** 用户执行 `cz-cli analytics-agent metric detail abc` 或 `cz-cli analytics-agent domain detail 0`
- **THEN** CLI MUST 在发请求前返回 `USAGE_ERROR`
- **AND** 不向后端发送包含 `NaN` 或非正 ID 的路径

#### Scenario: parent-id 允许 0 表示根目录

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge folder create 1 --parent-id 0 --name root-child`
- **THEN** CLI MUST 接受 `parent-id=0`
- **AND** 请求体包含 `parentId=0`

### Requirement: knowledge folder maintenance commands MUST use explicit flags

`cz-cli analytics-agent knowledge space rename`、`knowledge folder sort`、`knowledge folder rename/move/copy`、`knowledge file rename/move/copy` MUST 使用显式参数组装请求体，且这些简单场景不再依赖 `--body`。`knowledge folder sort` MUST 只接受 `--nodeIds` JSON 数组，不再接受重复 `--node-id`。

#### Scenario: knowledge folder sort 使用显式 nodeIds

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge folder sort 1 --parent-id 0 --nodeIds "[1,2]"`
- **THEN** CLI 调用 knowledge folder sort open API
- **AND** 请求体包含 `parentId=0`
- **AND** 请求体包含 `nodeIds=[1,2]`

#### Scenario: knowledge folder rename 使用显式 name

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge folder rename 1 2 --name new-name`
- **THEN** CLI 调用 knowledge folder rename open API
- **AND** 请求体包含 `name="new-name"`

#### Scenario: datasource load 校验 --domain-ids JSON 数组

- **WHEN** 用户执行 `cz-cli analytics-agent datasource load 3 --domain-ids "[5]"`
- **THEN** 请求体包含 `domainIds=[5]`
- **AND** 用户执行 `cz-cli analytics-agent datasource load 3 --domain-ids "[5,6]"`
- **THEN** 请求体包含 `domainIds=[5,6]`
- **AND** 如果数组中存在非正整数或非整数，CLI MUST 在发请求前返回 `USAGE_ERROR`
