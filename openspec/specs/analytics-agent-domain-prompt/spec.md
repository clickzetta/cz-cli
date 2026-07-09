# analytics-agent domain prompt 规格说明

## Purpose
定义 `cz-cli analytics-agent domain prompt` 命令组与对应 open API 的行为，确保业务域自定义提示词可以按 open token 鉴权风格进行读取、设置和清除，并且不会误覆盖其他 `domainConfigs`。

## Requirements

### Requirement: domain prompt get 读取业务域当前提示词

`cz-cli analytics-agent domain prompt get` MUST 调用 domain 维度的 Analytics Agent open API，返回指定 `domainId` 当前的自定义提示词。

#### Scenario: 读取已设置的业务域提示词

- **WHEN** 用户执行 `cz-cli analytics-agent domain prompt get 195`
- **THEN** CLI 调用 `GET /open/api/v1/analytics-agent/domains/195/prompt`
- **且** 请求包含 open token 鉴权和 `tenantId` query
- **且** 输出包含 `domainId` 和 `prompt`

#### Scenario: 业务域尚未设置提示词时返回 null

- **WHEN** 用户执行 `cz-cli analytics-agent domain prompt get 195`，且目标业务域没有 `metricAnalysisCustomPrompt`
- **THEN** 返回仍然成功
- **且** 输出中的 `prompt` 为 `null`

#### Scenario: prompt 子路由异常时回退到 domain detail 解析 prompt

- **WHEN** 用户执行 `cz-cli analytics-agent domain prompt get 195`
- **AND** `GET /domains/195/prompt` 返回服务端异常
- **AND** `GET /domains/195` 仍然可用
- **THEN** CLI 回退到 `domain detail`
- **且** 从 `domainConfigs.metricAnalysisCustomPrompt` 提取 prompt
- **且** 仍然输出统一的 `domainId` 与 `prompt`

### Requirement: domain prompt set 只更新目标 prompt，不覆盖其他 domainConfigs

`cz-cli analytics-agent domain prompt set` MUST 调用 domain 维度的 Analytics Agent open API 设置提示词。后端 MUST 基于现有业务域配置做 merge 更新，只新增或替换 `metricAnalysisCustomPrompt`，不能覆盖其他 `domainConfigs` 键。

#### Scenario: 设置业务域提示词成功

- **WHEN** 用户执行 `cz-cli analytics-agent domain prompt set 195 --prompt "请优先按业务口径回答"`
- **THEN** CLI 调用 `PUT /open/api/v1/analytics-agent/domains/195/prompt`
- **且** 请求体包含 `prompt`
- **且** 输出包含 `domainId` 和最新的 `prompt`

#### Scenario: 缺少 prompt 时拒绝请求

- **WHEN** 用户执行 `cz-cli analytics-agent domain prompt set 195`
- **THEN** 命令返回参数错误
- **且** 不发送后端请求

#### Scenario: 设置提示词时保留其他 domainConfigs

- **WHEN** 目标业务域原本已存在其他 `domainConfigs`，例如 `defaultDecimalDigits`
- **THEN** 调用 `set` 后这些已有配置仍然保留
- **且** 只新增或替换 `metricAnalysisCustomPrompt`

### Requirement: domain prompt clear 只移除目标 prompt

`cz-cli analytics-agent domain prompt clear` MUST 调用 domain 维度的 Analytics Agent open API 清除提示词。后端 MUST 只移除 `metricAnalysisCustomPrompt`，不能清空整份 `domainConfigs`。

#### Scenario: 清除业务域提示词成功

- **WHEN** 用户执行 `cz-cli analytics-agent domain prompt clear 195`
- **THEN** CLI 调用 `DELETE /open/api/v1/analytics-agent/domains/195/prompt`
- **且** 返回成功
- **且** 输出包含 `domainId`
- **且** 输出中的 `prompt` 为 `null`

#### Scenario: clear 不影响其他 domainConfigs

- **WHEN** 目标业务域除提示词外还存在其他配置
- **THEN** 调用 `clear` 后其他配置保持不变
- **且** 只移除 `metricAnalysisCustomPrompt`

### Requirement: domain prompt 路由沿用 open domain 鉴权与租户隔离

`domain prompt get/set/clear` MUST 复用现有 Analytics Agent domain open API 的鉴权链和租户隔离，不得切到内部 `/domian/updateBizDomain` 路径。

#### Scenario: 不存在的 domain 返回明确错误

- **WHEN** 用户调用 `GET /open/api/v1/analytics-agent/domains/999999/prompt`
- **THEN** 后端返回 `domain not found` 类错误
- **且** CLI 不把该错误误判成路由缺失或鉴权失败

#### Scenario: 错误 token 走 open token 鉴权失败

- **WHEN** 用户用无效 `Authorization` 调用 `PUT /open/api/v1/analytics-agent/domains/195/prompt`
- **THEN** 请求在 open token 鉴权层失败
- **且** 不会进入内部 domain 更新逻辑
