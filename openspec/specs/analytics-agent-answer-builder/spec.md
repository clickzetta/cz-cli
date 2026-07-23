# analytics-agent answer-builder 规格说明

## Purpose
定义 `cz-cli analytics-agent answer-builder` 命令组的用户可见参数面，确保常用查询、创建、更新、校验路径使用扁平参数，不要求用户手写内部 JSON body。

## Requirements

### Requirement: answer-builder create/update/validate 使用扁平参数

`cz-cli analytics-agent answer-builder create`、`update`、`validate` MUST 使用显式参数构造请求体，不把 `--body` 暴露为普通用户主路径。

#### Scenario: 创建 answer-builder 时使用显式字段

- **WHEN** 用户执行 `cz-cli analytics-agent answer-builder create --analysis-name 销量分析 --analysis-desc 口径说明 --datasource-id 11 --domain-id 195 --content "{\"type\":\"metric\"}"`
- **THEN** CLI 调用 answer-builder create open API
- **且** 请求体包含 `analysisName`、`analysisDesc`、`datasourceId`、`domainIds`、`content`

#### Scenario: 校验 answer-builder 时使用显式字段

- **WHEN** 用户执行 `cz-cli analytics-agent answer-builder validate --analysis-name 销量分析 --datasource-id 11 --domain-id 195 --content "{\"type\":\"metric\"}"`
- **THEN** CLI 调用 answer-builder validate open API
- **且** 请求体包含 `analysisName`、`datasourceId`、`domainIds`、`content`

#### Scenario: help 不再暴露 body 参数

- **WHEN** 用户执行 `cz-cli analytics-agent answer-builder create --help`
- **THEN** help 中不包含 `--body`

#### Scenario: create help 提供可复制的使用示例

- **WHEN** 用户执行 `cz-cli analytics-agent answer-builder create --help`
- **THEN** help 输出包含 `Examples:` 段
- **且** 示例提示先用 `validate` 校验 `--content` DSL

### Requirement: answer-builder 命令组帮助说明与 metric 的关系

`cz-cli analytics-agent answer-builder --help` MUST 在 epilogue 中说明 answer-builder 是 complex_metric（多步/多表 DSL 分析），单表单聚合应使用 `metric`（simple_metric），且两者都计入 `domain detail` 的 targetCounts，并提示可用 `--domain-id` 把 `answer-builder list` 限定到单个 domain。

#### Scenario: answer-builder 组帮助解释 complex/simple metric 关系

- **WHEN** 用户执行 `cz-cli analytics-agent answer-builder`（缺子命令，渲染组帮助）
- **THEN** 帮助输出包含 `complex_metric`
- **且** 帮助输出包含 `simple_metric`
- **且** 帮助输出提到 `targetCounts`

### Requirement: answer-builder enable/disable 支持按 domain 批量操作

`cz-cli analytics-agent answer-builder enable` 与 `disable` MUST 同时支持单条模式（positional `analysis-id`）与批量模式（`--all --domain-id <id>`）。两种模式互斥且至少提供其一。批量模式 MUST 先列出该 domain 下的 answer-builder，跳过已处于目标状态的项，对其余逐个调用单条 enable/disable，并汇总 `total`、`succeeded`、`failed`、`skipped` 与逐项 `results`。批量 disable MUST 复用单条 disable 的 detail+update 回退逻辑。

#### Scenario: 批量 disable 跳过已禁用项并禁用其余

- **WHEN** 用户执行 `cz-cli analytics-agent answer-builder disable --all --domain-id 27`
- **AND** 该 domain 下有 2 个 answer-builder，其中 1 个已是 `DISABLE`
- **THEN** CLI 先调用 answer-builder list
- **且** 对已 `DISABLE` 的项标记为 `skipped`，不再调用 disable
- **且** 对其余 1 项执行禁用
- **且** 输出包含 `total=2`、`succeeded=1`、`skipped=1`、`failed=0`

#### Scenario: 同时传 id 与 --all 时本地拒绝

- **WHEN** 用户执行 `cz-cli analytics-agent answer-builder enable 9 --all`
- **THEN** CLI MUST 在发请求前直接返回 `USAGE_ERROR`
- **且** 错误信息 MUST 说明二者互斥

### Requirement: answer-builder list 使用扁平过滤参数

`cz-cli analytics-agent answer-builder list` MUST 使用显式过滤参数构造请求体，不把 `--body` 暴露为普通用户主路径。

#### Scenario: 列出 answer-builder 并传入过滤条件

- **WHEN** 用户执行 `cz-cli analytics-agent answer-builder list --domain-id 195 --datasource-id 11 --page-num 2 --page-size 10`
- **THEN** CLI 调用 answer-builder list open API
- **且** 请求体包含 `domainIds`、`datasourceId`、`pageNum`、`pageSize`

### Requirement: answer-builder disable 兼容旧状态接口异常并回退到 detail + update

当服务端直接 `disable` 路径返回“对象不存在”这类旧兼容异常时，`cz-cli analytics-agent answer-builder disable` MUST 优先尝试读取 detail，再用完整 update 请求把 `status` 改为 `DISABLE`，避免用户因为旧状态路由异常而无法禁用 answer-builder。

#### Scenario: disable 直调返回 not found 时自动回退

- **WHEN** 用户执行 `cz-cli analytics-agent answer-builder disable 401`
- **AND** 直接调用 `/answer-builders/disable` 返回 `answer builder not found`
- **THEN** CLI 继续调用 `answer-builder detail`
- **且** 再调用 `answer-builder update`
- **且** update 请求体包含 detail 中的核心字段与 `status=DISABLE`
- **且** 最终命令返回成功
