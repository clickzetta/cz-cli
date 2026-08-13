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
