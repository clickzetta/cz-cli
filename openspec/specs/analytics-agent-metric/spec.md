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

#### Scenario: help 不再暴露 body 参数

- **WHEN** 用户执行 `cz-cli analytics-agent metric create --help`
- **THEN** help 中不包含 `--body`
- **且** help 中保留 `--alias`

### Requirement: metric disable 兼容旧状态接口异常并回退到 detail + update

当服务端直接 `disable` 路径返回“对象不存在”这类旧兼容异常时，`cz-cli analytics-agent metric disable` MUST 优先尝试读取 detail，再用完整 update 请求把 `status` 改为 `DISABLE`，避免用户因为旧状态路由异常而无法禁用 metric。

#### Scenario: disable 直调返回 not found 时自动回退

- **WHEN** 用户执行 `cz-cli analytics-agent metric disable 301`
- **AND** 直接调用 `/metrics/disable` 返回 `metric not found`
- **THEN** CLI 继续调用 `metric detail`
- **且** 再调用 `metric update`
- **且** update 请求体包含 detail 中的核心字段与 `status=DISABLE`
- **且** 最终命令返回成功
