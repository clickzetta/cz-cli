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
