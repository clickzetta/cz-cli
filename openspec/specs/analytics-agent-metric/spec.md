# analytics-agent metric 规格说明

## Purpose
定义 `cz-cli analytics-agent metric` 命令组的用户可见参数面，确保常用查询与写入路径使用扁平参数，不要求用户手写内部 JSON body。

## Requirements

### Requirement: metric list 使用扁平过滤参数

`cz-cli analytics-agent metric list` MUST 使用显式过滤参数构造请求体，不把 `--body` 暴露为普通用户主路径。

#### Scenario: 列出 metric 并传入过滤条件

- **WHEN** 用户执行 `cz-cli analytics-agent metric list --domain-id 195 --datasource-id 11 --table-name orders --page-num 2 --page-size 10`
- **THEN** CLI 调用 metric list open API
- **且** 请求体包含 `domainIds`、`datasourceId`、`tableName`、`pageNum`、`pageSize`

### Requirement: metric create/update/validate 使用重复 alias 参数

`cz-cli analytics-agent metric create`、`update`、`validate` MUST 使用扁平参数构造请求体，不把 `--body` 暴露为普通用户主路径。`alias` MUST 支持重复 `--alias` 输入，并在请求体中组装为数组。

#### Scenario: 创建 metric 时重复 alias 被收集为数组

- **WHEN** 用户执行 `cz-cli analytics-agent metric create --domain-id 195 --datasource-id 11 --table-name orders --name pay_amount --expression "sum(amount)" --alias 支付金额 --alias 成交金额`
- **THEN** CLI 调用 metric create open API
- **且** 请求体中的 `alias` 为 `["支付金额","成交金额"]`

#### Scenario: 校验 metric 时重复 alias 被收集为数组

- **WHEN** 用户执行 `cz-cli analytics-agent metric validate --domain-id 195 --datasource-id 11 --table-name orders --name pay_amount --expression "sum(amount)" --alias 支付金额 --alias 成交金额`
- **THEN** CLI 调用 metric validate open API
- **且** 请求体中的 `alias` 为 `["支付金额","成交金额"]`

#### Scenario: alias 误传 JSON 数组字符串时本地拒绝

- **WHEN** 用户执行 `cz-cli analytics-agent metric create --domain-id 195 --datasource-id 11 --table-name orders --name pay_amount --expression "sum(amount)" --alias '["支付金额","成交金额"]'`
- **THEN** CLI MUST 在发请求前直接返回 `USAGE_ERROR`
- **且** 错误信息 MUST 明确提示改用重复 `--alias`

#### Scenario: domain-id 不是合法正整数时本地拒绝

- **WHEN** 用户执行 `cz-cli analytics-agent metric create --domain-id abc --datasource-id 11 --table-name orders --name pay_amount --expression "sum(amount)"`
- **THEN** CLI MUST 在发请求前直接返回 `USAGE_ERROR`
- **且** 错误信息 MUST 明确说明 `--domain-id` 必须是正整数

#### Scenario: help 不再暴露 body 参数

- **WHEN** 用户执行 `cz-cli analytics-agent metric create --help`
- **THEN** help 中不包含 `--body`
- **且** help 中保留 `--alias`

### Requirement: metric create help 提供可复制的使用示例

`cz-cli analytics-agent metric create --help` MUST 提供至少一个可直接复制的完整示例，帮助用户推断 `--table-name` 全限定格式与 `--expression` 聚合写法，降低首次调用的重试率。示例 MUST 引导用户用虚拟列封装字符串条件，而非在 `--expression` 中直接写字符串字面量（后端 SQL 校验层拒绝字符串字面量）。

#### Scenario: create help 展示全限定表名与聚合示例

- **WHEN** 用户执行 `cz-cli analytics-agent metric create --help`
- **THEN** help 输出包含 `Examples:` 段
- **且** 示例中包含全限定表名格式提示 `catalog.schema.table`
- **且** 示例引导用虚拟列（如 `win_flag`）封装条件，而非 SQL 字符串字面量

### Requirement: metric 命令组帮助说明与 answer-builder 的关系

`cz-cli analytics-agent metric --help` MUST 在 epilogue 中说明 metric 是 simple_metric（单表单聚合），多步/多表分析应使用 `answer-builder`（complex_metric），且两者都计入 `domain detail` 的 targetCounts，避免用户混淆两个命令组的定位。

#### Scenario: metric 组帮助解释 simple/complex metric 关系

- **WHEN** 用户执行 `cz-cli analytics-agent metric`（缺子命令，渲染组帮助）
- **THEN** 帮助输出包含 `simple_metric`
- **且** 帮助输出提示改用 `answer-builder`
- **且** 帮助输出提到 `targetCounts`

### Requirement: metric enable/disable 支持按 domain 批量操作

`cz-cli analytics-agent metric enable` 与 `disable` MUST 同时支持单条模式（positional `metric-id`）与批量模式（`--all --domain-id <id>`）。两种模式互斥且至少提供其一。批量模式 MUST 先列出该 domain 下的 metric，跳过已处于目标状态的项，对其余逐个调用单条 enable/disable，并汇总 `total`、`succeeded`、`failed`、`skipped` 与逐项 `results`。批量 disable MUST 复用单条 disable 的 detail+update 回退逻辑。

#### Scenario: 批量 enable 跳过已启用项并启用其余

- **WHEN** 用户执行 `cz-cli analytics-agent metric enable --all --domain-id 27`
- **AND** 该 domain 下有 3 个 metric，其中 1 个已是 `ENABLE`
- **THEN** CLI 先调用 metric list
- **且** 对已 `ENABLE` 的项标记为 `skipped`，不再调用 enable
- **且** 对其余 2 项调用 `/metrics/enable`
- **且** 输出包含 `total=3`、`succeeded=2`、`skipped=1`、`failed=0`

#### Scenario: 批量操作部分失败时返回非零退出码

- **WHEN** 用户执行 `cz-cli analytics-agent metric enable --all --domain-id 27`
- **AND** 其中一项调用 enable 时后端返回业务错误
- **THEN** CLI 继续处理其余项，不中断
- **且** 输出中该项 `result=failed` 并带 `error`
- **且** 命令退出码为非零

#### Scenario: 同时传 id 与 --all 时本地拒绝

- **WHEN** 用户执行 `cz-cli analytics-agent metric enable 197 --all`
- **THEN** CLI MUST 在发请求前直接返回 `USAGE_ERROR`
- **且** 错误信息 MUST 说明二者互斥

#### Scenario: --all 缺少 --domain-id 时本地拒绝

- **WHEN** 用户执行 `cz-cli analytics-agent metric enable --all`
- **THEN** CLI MUST 在发请求前直接返回 `USAGE_ERROR`
- **且** 错误信息 MUST 提示需要 `--domain-id`

#### Scenario: 既无 id 也无 --all 时本地拒绝

- **WHEN** 用户执行 `cz-cli analytics-agent metric enable`
- **THEN** CLI MUST 在发请求前直接返回 `USAGE_ERROR`

### Requirement: metric disable 兼容旧状态接口异常并回退到 detail + update

当服务端直接 `disable` 路径返回“对象不存在”这类旧兼容异常时，`cz-cli analytics-agent metric disable` MUST 优先尝试读取 detail，再用完整 update 请求把 `status` 改为 `DISABLE`，避免用户因为旧状态路由异常而无法禁用 metric。

#### Scenario: disable 直调返回 not found 时自动回退

- **WHEN** 用户执行 `cz-cli analytics-agent metric disable 301`
- **AND** 直接调用 `/metrics/disable` 返回 `metric not found`
- **THEN** CLI 继续调用 `metric detail`
- **且** 再调用 `metric update`
- **且** update 请求体包含 detail 中的核心字段与 `status=DISABLE`
- **且** 最终命令返回成功

#### Scenario: disable 遇到非 not-found 的后端错误时如实上报

- **WHEN** 用户执行 `cz-cli analytics-agent metric disable 184`
- **AND** 后端返回非 not-found 业务错误（例如 `CZD-99999` 约束违反）
- **THEN** CLI MUST NOT 触发 detail+update 回退（回退仅针对 not-found 类异常）
- **且** CLI 如实上报该后端错误码与信息
- **且** 命令退出码为非零
- **且** metric 本地状态保持不变（不产生部分写入）

> 已知后端限制：在部分环境，metric disable 会触发后端 `CZD-99999`（`common_reference_relationship.source_id` 非空约束违反），单条与批量 disable 均会命中。此为后端缺陷，CLI 侧仅保证如实透传错误、退出码非零、不改本地状态。
