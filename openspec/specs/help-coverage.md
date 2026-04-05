# CZ-CLI Help Coverage Matrix

- Source help files: `/tmp/cz_help`
- Spec scope: `openspec/specs`
- Coverage by signature string match: **59/59**

| Help File | Usage | Command Key | Covered | Spec References |
|---|---|---|---|---|
| `ai-guide.txt` | `cz-cli ai-guide [OPTIONS]` | `ai-guide` | Y | openspec/specs/ai-guide/spec.md:5 |
| `executions.txt` | `cz-cli executions [OPTIONS] COMMAND [ARGS]...` | `executions` | Y | openspec/specs/ai-guide/spec.md:102<br>openspec/specs/runs-management/spec.md:19 |
| `executions_list.txt` | `cz-cli executions list [OPTIONS] [RUN_ID_OR_TASK_NAME]` | `executions list` | Y | openspec/specs/ai-guide/spec.md:102<br>openspec/specs/runs-management/spec.md:23 |
| `executions_log.txt` | `cz-cli executions log [OPTIONS] RUN_ID_OR_TASK_NAME` | `executions log` | Y | openspec/specs/runs-management/spec.md:25 |
| `executions_stop.txt` | `cz-cli executions stop [OPTIONS] RUN_ID_OR_TASK_NAME` | `executions stop` | Y | openspec/specs/runs-management/spec.md:144 |
| `install-skills.txt` | `cz-cli install-skills [OPTIONS]` | `install-skills` | Y | openspec/specs/ai-guide/spec.md:60 |
| `profile.txt` | `cz-cli profile [OPTIONS] COMMAND [ARGS]...` | `profile` | Y | openspec/specs/per-command-output-option/spec.md:47<br>openspec/specs/profile-management/spec.md:7 |
| `profile_create.txt` | `cz-cli profile create [OPTIONS] NAME` | `profile create` | Y | openspec/specs/profile-management/spec.md:7 |
| `profile_delete.txt` | `cz-cli profile delete [OPTIONS] NAME` | `profile delete` | Y | openspec/specs/profile-management/spec.md:84 |
| `profile_list.txt` | `cz-cli profile list [OPTIONS]` | `profile list` | Y | openspec/specs/per-command-output-option/spec.md:47<br>openspec/specs/profile-management/spec.md:41 |
| `profile_update.txt` | `cz-cli profile update [OPTIONS] NAME KEY VALUE` | `profile update` | Y | openspec/specs/profile-management/spec.md:65 |
| `profile_use.txt` | `cz-cli profile use [OPTIONS] NAME` | `profile use` | Y | openspec/specs/profile-management/spec.md:54 |
| `root.txt` | `cz-cli [OPTIONS] COMMAND [ARGS]...` | `<root>` | Y | openspec/specs/ai-guide/spec.md:51 |
| `runs.txt` | `cz-cli runs [OPTIONS] COMMAND [ARGS]...` | `runs` | Y | openspec/specs/ai-guide/spec.md:93<br>openspec/specs/runs-management/spec.md:6 |
| `runs_detail.txt` | `cz-cli runs detail [OPTIONS] RUN_ID_OR_TASK_NAME` | `runs detail` | Y | openspec/specs/runs-management/spec.md:10 |
| `runs_list.txt` | `cz-cli runs list [OPTIONS]` | `runs list` | Y | openspec/specs/ai-guide/spec.md:93<br>openspec/specs/runs-management/spec.md:31 |
| `runs_log.txt` | `cz-cli runs log [OPTIONS] RUN_ID_OR_TASK_NAME` | `runs log` | Y | openspec/specs/runs-management/spec.md:10 |
| `runs_refill.txt` | `cz-cli runs refill [OPTIONS] TASK_NAME_OR_ID` | `runs refill` | Y | openspec/specs/runs-management/spec.md:152 |
| `runs_stats.txt` | `cz-cli runs stats [OPTIONS]` | `runs stats` | Y | openspec/specs/runs-management/spec.md:14 |
| `runs_stop.txt` | `cz-cli runs stop [OPTIONS] RUN_ID_OR_TASK_NAME` | `runs stop` | Y | openspec/specs/runs-management/spec.md:10 |
| `schema.txt` | `cz-cli schema [OPTIONS] COMMAND [ARGS]...` | `schema` | Y | openspec/specs/per-command-output-option/spec.md:43<br>openspec/specs/schema-management/spec.md:7 |
| `schema_create.txt` | `cz-cli schema create [OPTIONS] NAME` | `schema create` | Y | openspec/specs/schema-management/spec.md:16 |
| `schema_describe.txt` | `cz-cli schema describe [OPTIONS] NAME` | `schema describe` | Y | openspec/specs/schema-management/spec.md:38 |
| `schema_drop.txt` | `cz-cli schema drop [OPTIONS] NAME` | `schema drop` | Y | openspec/specs/schema-management/spec.md:49 |
| `schema_list.txt` | `cz-cli schema list [OPTIONS]` | `schema list` | Y | openspec/specs/per-command-output-option/spec.md:43<br>openspec/specs/schema-management/spec.md:11 |
| `sql.txt` | `cz-cli sql [OPTIONS] [STATEMENT]` | `sql` | Y | openspec/specs/connection-management/spec.md:15<br>openspec/specs/per-command-output-option/spec.md:5<br>openspec/specs/sql-execution/spec.md:5 |
| `status.txt` | `cz-cli status [OPTIONS] JOB_ID` | `status` | Y | openspec/specs/ai-guide/spec.md:38<br>openspec/specs/sql-execution/spec.md:10 |
| `table.txt` | `cz-cli table [OPTIONS] COMMAND [ARGS]...` | `table` | Y | openspec/specs/per-command-output-option/spec.md:21<br>openspec/specs/table-management/spec.md:10 |
| `table_create.txt` | `cz-cli table create [OPTIONS] [DDL]` | `table create` | Y | openspec/specs/table-management/spec.md:19 |
| `table_describe.txt` | `cz-cli table describe [OPTIONS] NAME` | `table describe` | Y | openspec/specs/table-management/spec.md:38 |
| `table_drop.txt` | `cz-cli table drop [OPTIONS] NAME` | `table drop` | Y | openspec/specs/table-management/spec.md:68 |
| `table_history.txt` | `cz-cli table history [OPTIONS] [NAME]` | `table history` | Y | openspec/specs/table-management/spec.md:14 |
| `table_list.txt` | `cz-cli table list [OPTIONS]` | `table list` | Y | openspec/specs/per-command-output-option/spec.md:21<br>openspec/specs/table-management/spec.md:14 |
| `table_preview.txt` | `cz-cli table preview [OPTIONS] NAME` | `table preview` | Y | openspec/specs/table-management/spec.md:42 |
| `table_stats.txt` | `cz-cli table stats [OPTIONS] NAME` | `table stats` | Y | openspec/specs/table-management/spec.md:49 |
| `task.txt` | `cz-cli task [OPTIONS] COMMAND [ARGS]...` | `task` | Y | openspec/specs/connection-management/spec.md:53<br>openspec/specs/flow-management/spec.md:6<br>openspec/specs/per-command-output-option/spec.md:9<br>openspec/specs/task-management/spec.md:6 |
| `task_create-folder.txt` | `cz-cli task create-folder [OPTIONS] FOLDER_NAME` | `task create-folder` | Y | openspec/specs/task-management/spec.md:46 |
| `task_create.txt` | `cz-cli task create [OPTIONS] TASK_NAME` | `task create` | Y | openspec/specs/task-management/spec.md:10 |
| `task_detail.txt` | `cz-cli task detail [OPTIONS] TASK_NAME_OR_ID` | `task detail` | Y | openspec/specs/task-management/spec.md:57 |
| `task_flow.txt` | `cz-cli task flow [OPTIONS] COMMAND [ARGS]...` | `task flow` | Y | openspec/specs/flow-management/spec.md:6 |
| `task_flow_bind.txt` | `cz-cli task flow bind [OPTIONS] TASK_NAME_OR_ID` | `task flow bind` | Y | openspec/specs/flow-management/spec.md:30 |
| `task_flow_create-node.txt` | `cz-cli task flow create-node [OPTIONS] TASK_NAME_OR_ID` | `task flow create-node` | Y | openspec/specs/flow-management/spec.md:18 |
| `task_flow_dag.txt` | `cz-cli task flow dag [OPTIONS] TASK_NAME_OR_ID` | `task flow dag` | Y | openspec/specs/flow-management/spec.md:11 |
| `task_flow_instances.txt` | `cz-cli task flow instances [OPTIONS]` | `task flow instances` | Y | openspec/specs/flow-management/spec.md:60 |
| `task_flow_node-detail.txt` | `cz-cli task flow node-detail [OPTIONS] TASK_NAME_OR_ID` | `task flow node-detail` | Y | openspec/specs/flow-management/spec.md:41 |
| `task_flow_node-save-config.txt` | `cz-cli task flow node-save-config [OPTIONS] TASK_NAME_OR_ID` | `task flow node-save-config` | Y | openspec/specs/flow-management/spec.md:49 |
| `task_flow_node-save.txt` | `cz-cli task flow node-save [OPTIONS] TASK_NAME_OR_ID` | `task flow node-save` | Y | openspec/specs/flow-management/spec.md:45 |
| `task_flow_remove-node.txt` | `cz-cli task flow remove-node [OPTIONS] TASK_NAME_OR_ID` | `task flow remove-node` | Y | openspec/specs/flow-management/spec.md:22 |
| `task_flow_submit.txt` | `cz-cli task flow submit [OPTIONS] TASK_NAME_OR_ID` | `task flow submit` | Y | openspec/specs/flow-management/spec.md:56 |
| `task_flow_unbind.txt` | `cz-cli task flow unbind [OPTIONS] TASK_NAME_OR_ID` | `task flow unbind` | Y | openspec/specs/flow-management/spec.md:34 |
| `task_folders.txt` | `cz-cli task folders [OPTIONS]` | `task folders` | Y | openspec/specs/task-management/spec.md:42 |
| `task_list.txt` | `cz-cli task list [OPTIONS]` | `task list` | Y | openspec/specs/connection-management/spec.md:53<br>openspec/specs/per-command-output-option/spec.md:9<br>openspec/specs/task-management/spec.md:24 |
| `task_offline.txt` | `cz-cli task offline [OPTIONS] TASK_NAME_OR_ID` | `task offline` | Y | openspec/specs/task-management/spec.md:15 |
| `task_online.txt` | `cz-cli task online [OPTIONS] TASK_NAME_OR_ID` | `task online` | Y | openspec/specs/task-management/spec.md:15 |
| `task_save-config.txt` | `cz-cli task save-config [OPTIONS] TASK_NAME_OR_ID` | `task save-config` | Y | openspec/specs/task-management/spec.md:69 |
| `task_save.txt` | `cz-cli task save [OPTIONS] TASK_NAME_OR_ID` | `task save` | Y | openspec/specs/task-management/spec.md:65 |
| `workspace.txt` | `cz-cli workspace [OPTIONS] COMMAND [ARGS]...` | `workspace` | Y | openspec/specs/per-command-output-option/spec.md:51<br>openspec/specs/workspace-management/spec.md:7 |
| `workspace_current.txt` | `cz-cli workspace current [OPTIONS]` | `workspace current` | Y | openspec/specs/per-command-output-option/spec.md:51<br>openspec/specs/workspace-management/spec.md:19 |
| `workspace_use.txt` | `cz-cli workspace use [OPTIONS] NAME` | `workspace use` | Y | openspec/specs/workspace-management/spec.md:11 |

## Uncovered Commands

- None
