## ADDED Requirements

### Requirement: 解析 SQL 和集成任务的依赖与产出
CLI MUST provide `cz-cli task lineage <task>` to parse schedule dependencies and output tables for SQL tasks and integration tasks by calling Studio `parseDataFileDependencyOut`.

#### Scenario: SQL 任务解析成功
- **WHEN** 用户对 SQL 任务执行 `cz-cli task lineage <task>`
- **THEN** CLI MUST call `/ide-admin/v1/dataFileConfiguration/parseDataFileDependencyOut` with `projectId`, `workspaceId`, `schemaName`, `dataFileContent`, and `dataFileId`
- **AND** the command output MUST include parsed task outputs
- **AND** the command output MUST include parsed schedule dependencies
- **AND** the command output MUST use user-facing field names instead of backend DTO field names for the primary result

#### Scenario: 集成任务解析成功
- **WHEN** 用户对集成任务执行 `cz-cli task lineage <task>`
- **THEN** CLI MUST pass the integration task content to Studio without local JSON restructuring
- **AND** the command output MUST include the same user-facing dependency and output shape as SQL tasks

#### Scenario: 使用未保存内容解析
- **WHEN** 用户执行 `cz-cli task lineage <task> --content <content>` 或 `--file <path>`
- **THEN** CLI MUST send that content as `dataFileContent` instead of the content currently saved on the task
- **AND** CLI MUST still use the resolved `dataFileId`, `projectId`, `workspaceId`, and schema

### Requirement: 输出用户可确认的解析结果
The parse command MUST expose user-facing summaries for schedule dependencies and output tables without automatically saving them.

#### Scenario: 调度依赖展示字段
- **WHEN** Studio returns `dataFileDependencyDTOS`
- **THEN** CLI MUST expose each dependency as a user-facing dependency summary
- **AND** each dependency summary MUST include identifiers needed to understand the upstream task, such as dependency task ID, dependency project ID, dependency file version, dependency name, workspace, referenced table, add method, and dependency strategy when present
- **AND** each dependency summary MUST include `dep_strategy`, defaulting to `0` when Studio does not return a dependency strategy

#### Scenario: 任务产出展示字段
- **WHEN** Studio returns `fileOutputTableDTOS`
- **THEN** CLI MUST expose each output as a user-facing output summary
- **AND** each output summary MUST include identifiers needed to understand the current task output, such as task ID, project ID, data file version, task name, output table name, referenced table name, and add method when present

### Requirement: 保存调度配置时按配置解析依赖和产出
Save commands MUST preserve existing lineage by default and MUST parse dependencies and output tables only when the user explicitly enables automatic lineage parsing.

#### Scenario: 保存 cron 默认不自动解析
- **WHEN** 用户执行 `cz-cli task save-cron <task>`
- **AND** 用户没有传入 `--auto-lineage`
- **THEN** CLI MUST NOT call `/ide-admin/v1/dataFileConfiguration/parseDataFileDependencyOut`
- **AND** CLI MUST submit existing dependencies and output tables from saved configuration

#### Scenario: 保存 cron 显式自动解析
- **WHEN** 用户执行 `cz-cli task save-cron <task> --auto-lineage`
- **AND** the task type is SQL or integration
- **THEN** CLI MUST call `/ide-admin/v1/dataFileConfiguration/parseDataFileDependencyOut`
- **AND** CLI MUST submit parsed dependencies as `dataFileInputListReqs`
- **AND** CLI MUST submit parsed output tables as `dataFileOutputListReqs`
- **AND** CLI MUST include top-level `ownerCnName` and `ownerEnName` when output tables are submitted

#### Scenario: 保存非 cron 配置默认不自动解析
- **WHEN** 用户执行 `cz-cli task save-schedule <task>` 或 `cz-cli task save-config <task>`
- **AND** 用户没有传入 `--auto-lineage`
- **THEN** CLI MUST NOT call `/ide-admin/v1/dataFileConfiguration/parseDataFileDependencyOut`
- **AND** CLI MUST submit existing dependencies and output tables from saved configuration unless the user explicitly overrides them

#### Scenario: 保存非 cron 配置显式自动解析
- **WHEN** 用户执行 `cz-cli task save-schedule <task> --auto-lineage` 或 `cz-cli task save-config <task> --auto-lineage`
- **AND** the task type is SQL or integration
- **THEN** CLI MUST call `/ide-admin/v1/dataFileConfiguration/parseDataFileDependencyOut`
- **AND** CLI MUST submit parsed dependencies as `dataFileInputListReqs` unless the user explicitly passes `--deps clear` or `--deps replace`
- **AND** CLI MUST submit parsed output tables as `dataFileOutputListReqs`

#### Scenario: 手工设置任务产出
- **WHEN** 用户执行 `cz-cli task save-cron <task> --outputs replace --output-tables <json>` 或 `cz-cli task save-config <task> --outputs replace --output-tables <json>`
- **THEN** CLI MUST submit the provided output tables as `dataFileOutputListReqs`
- **AND** CLI MUST mark the output table add method as manual when no add method is provided
- **WHEN** 用户执行 `cz-cli task save-cron <task> --outputs clear` 或 `cz-cli task save-config <task> --outputs clear`
- **THEN** CLI MUST submit an empty `dataFileOutputListReqs`

#### Scenario: 保存调度配置时解析执行集群 ID
- **WHEN** 用户保存调度配置 without `--vc-id`
- **AND** CLI has a virtual cluster code from `--vc`, global `--vcluster`, existing config, or `DEFAULT`
- **THEN** CLI MUST resolve and submit `etlVcId`
- **AND** this resolution MUST include the `DEFAULT` virtual cluster code

#### Scenario: 人可读字段
- **WHEN** CLI renders parsed dependencies
- **THEN** each dependency summary MUST expose the dependency name, workspace, output table name, schedule rate type, schedule start time, add method, dependency strategy, dependency task ID, and dependency project ID when available
- **AND** each dependency summary MUST map add method values to enum names, including `1` as `manual` and `2` as `system_parsed`
- **WHEN** CLI renders parsed outputs
- **THEN** each output summary MUST expose the output table name, referenced table name, task ID, project ID, and add method when available
- **AND** each output summary MUST map add method values to enum names, including `1` as `manual` and `2` as `system_parsed`

#### Scenario: 表格格式按行展示
- **WHEN** 用户执行 `cz-cli task lineage <task> --format table`
- **THEN** CLI MUST render parsed outputs and dependencies as flattened rows
- **AND** each row MUST include a `record_type` column identifying `output` or `dependency`
- **AND** key fields such as task name, output table name, schedule start time, add method enum, and dependency strategy enum MUST appear as normal table columns
- **AND** CLI MUST NOT put `outputs`, `dependencies`, or save payload JSON blobs into table cells

### Requirement: 拒绝不支持的任务类型
The parse command MUST reject task types other than SQL and integration before calling the parse API.

#### Scenario: 非支持任务类型
- **WHEN** 用户对 Python、Shell、JDBC、Flow、CDC 或其他非 SQL/集成任务执行 `cz-cli task lineage <task>`
- **THEN** CLI MUST return `UNSUPPORTED_TASK_TYPE`
- **AND** CLI MUST not call `/ide-admin/v1/dataFileConfiguration/parseDataFileDependencyOut`

#### Scenario: 任务类型缺失
- **WHEN** task detail does not include a usable `fileType`
- **THEN** CLI MUST return `UNSUPPORTED_TASK_TYPE`
- **AND** the error message MUST explain that only SQL and integration tasks are supported
