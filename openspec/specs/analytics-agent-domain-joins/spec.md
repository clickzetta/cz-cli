# analytics-agent domain joins 规格说明

## Purpose
定义 `cz-cli analytics-agent domain joins` 命令组的用户可见参数设计，确保发现结果查询与应用流程对普通用户足够直接，不要求用户手工拼接内部 join DTO 字符串。

## Requirements

### Requirement: joins discover 返回可继续操作的任务信息

`cz-cli analytics-agent domain joins discover` MUST 支持按 `domainId` 发起关联关系发现任务，并返回后续查询结果所需的任务信息。

#### Scenario: 发起 discover 任务

- **WHEN** 用户执行 `cz-cli analytics-agent domain joins discover --domain-id 195`
- **THEN** CLI 调用 `POST /open/api/v1/analytics-agent/domains/195/joins/discover`
- **且** 输出包含 `taskId` 和 `status`

### Requirement: joins result 返回可直接用于 apply 的候选关系列表

`cz-cli analytics-agent domain joins result` MUST 返回候选 join 列表，并保留稳定顺序，供 `apply` 通过索引直接引用。

#### Scenario: 查询 discover 结果

- **WHEN** 用户执行 `cz-cli analytics-agent domain joins result --task-id task-1`
- **THEN** CLI 调用 `GET /open/api/v1/analytics-agent/domains/joins/tasks/task-1`
- **且** 输出包含 `taskId`、`status`、`joinCount`
- **且** 输出中的 `joins` 保留稳定顺序

### Requirement: joins apply 通过 task result 选择候选关系

`cz-cli analytics-agent domain joins apply` MUST 以 discover 任务结果为输入，不再要求用户手工拼接内部 join 字符串。命令 MUST 支持：

- `--task-id <task-id> --all`
- `--task-id <task-id> --index <n>`（可重复）

CLI MUST 先读取 discover 结果，再将所选候选关系原样提交给 apply API。

#### Scenario: 应用全部候选关系

- **WHEN** 用户执行 `cz-cli analytics-agent domain joins apply --domain-id 195 --task-id task-1 --all`
- **THEN** CLI 先调用 `GET /open/api/v1/analytics-agent/domains/joins/tasks/task-1`
- **且** 再调用 `POST /open/api/v1/analytics-agent/domains/195/joins/apply`
- **且** 请求体中的 `joins` 等于 discover 结果中的全部候选关系

#### Scenario: 只应用指定索引的候选关系

- **WHEN** 用户执行 `cz-cli analytics-agent domain joins apply --domain-id 195 --task-id task-1 --index 2 --index 3`
- **THEN** CLI 先读取 discover 结果
- **且** 仅把第 2、3 条候选关系提交给 apply API
- **且** 输出包含 `submittedCount=2`

#### Scenario: 缺少 all 和 index 时拒绝请求

- **WHEN** 用户执行 `cz-cli analytics-agent domain joins apply --domain-id 195 --task-id task-1`
- **THEN** CLI 返回参数错误
- **且** 不发送 apply 请求

#### Scenario: index 越界时拒绝请求

- **WHEN** discover 结果只有 1 条候选关系
- **AND** 用户执行 `cz-cli analytics-agent domain joins apply --domain-id 195 --task-id task-1 --index 2`
- **THEN** CLI 返回参数错误
- **且** 错误信息明确指出 index 超出候选范围
- **且** 不发送 apply 请求

#### Scenario: index 小于 1 时本地直接拒绝请求

- **WHEN** 用户执行 `cz-cli analytics-agent domain joins apply --domain-id 195 --task-id task-1 --index 0`
- **THEN** CLI 本地直接返回参数错误
- **且** 错误信息明确指出 index 必须是正整数
- **且** 不发送 task result 请求
