## 1. MCP Server（先完成）

- [x] 1.1 在 `cz-mcp-server` 新增/补齐周期任务生命周期 tools
  - [x] 1.1.1 `offline_task`（对应 `DELETE_TASK`）
  - [x] 1.1.2 `offline_task_with_downstream`（对应 `OFFLINE_TASK_WITH_DOWNSTREAM`）
  - [x] 1.1.3 `kill_task_instance`（对应 `KILL_TASK_INSTANCE`）
  - [x] 1.1.4 评估是否新增 `online_task`（若 `publish_task` 语义不足）
- [x] 1.2 为新增 tools 定义严格 `input_schema`
  - [x] 1.2.1 明确 `type/properties/required/additionalProperties`
  - [x] 1.2.2 提供 samples 与错误语义
- [x] 1.3 审查现有 list 类 tool 的分页契约
  - [x] 1.3.1 `list_clickzetta_tasks` required/default 与描述一致
  - [x] 1.3.2 `list_task_run` required/default 与描述一致
  - [x] 1.3.3 `list_executions` required/default 与描述一致

## 2. CLI schema-driven 调用层

- [x] 2.1 CLI 侧接入 Tool schema 读取能力
  - [x] 2.1.1 支持读取 `required/default/type/additionalProperties`
  - [x] 2.1.2 调用前完成参数归一化与校验
- [x] 2.2 建立统一错误模型
  - [x] 2.2.1 缺失 required 返回 `INVALID_ARGUMENTS`
  - [x] 2.2.2 unknown field 在 `additionalProperties=false` 时拒绝
- [x] 2.3 建立参数派生机制（AI 友好最小输入）
  - [x] 2.3.1 `task online` 自动派生 `task_version`
  - [x] 2.3.2 `runs log` 自动派生最新 `execution_id`
  - [x] 2.3.3 上下文字段（project/workspace/user/tenant）自动注入

## 3. 认证与连接

- [x] 3.1 固化认证优先级实现
  - [x] 3.1.1 `--pat` > `CZ_PAT` > profile `pat`
  - [x] 3.1.2 `--username/--password` > `CZ_USERNAME/CZ_PASSWORD` > profile username/password
  - [x] 3.1.3 PAT 与 username/password 互斥与诊断信息
- [x] 3.2 PAT -> JWT 统一链路校验（SQL 与 Studio 命令共用）

## 4. task 命令组

- [x] 4.1 `task list` 支持默认第一页 + 分页参数
  - [x] 4.1.1 默认 `page=1`
  - [x] 4.1.2 保留 `--page` / `--page-size`
  - [x] 4.1.3 返回 `ai_message` 提示翻页
- [x] 4.2 `task detail` 精确查询
- [x] 4.3 `task save` / `task save-config` 参数归一化
- [x] 4.4 `task online` 二次确认与 `-y`
- [x] 4.5 `task offline` 二次确认与 `-y`
- [x] 4.6 `task offline --with-downstream` 二次确认与 `-y`

## 5. runs 命令组

- [x] 5.1 `runs list` 支持默认第一页 + 分页参数 + `ai_message`
- [x] 5.2 `runs detail RUN_ID` 改为 `get_task_instance_detail` 精确链路
- [x] 5.3 `runs log RUN_ID` 两步链路（list_executions -> get_execution_log）
- [x] 5.4 `runs stop RUN_ID` 二次确认与 `-y`
- [x] 5.5 `runs stats` 保持聚合统计语义

## 6. flow 命令组

- [x] 6.1 设计并注册 `task flow` 子命令
  - [x] 6.1.1 `dag`
  - [x] 6.1.2 `create-node`
  - [x] 6.1.3 `remove-node`
  - [x] 6.1.4 `bind`
  - [x] 6.1.5 `unbind`
  - [x] 6.1.6 `node-detail`
  - [x] 6.1.7 `node-save`
  - [x] 6.1.8 `node-save-config`
  - [x] 6.1.9 `submit`
  - [x] 6.1.10 `instances`
- [x] 6.2 优先支持 node_name 语义；必要时支持 node_id/dependency_id

## 7. ai-guide / skill 文档

- [x] 7.1 `ai-guide` 增补 task/runs/flow 命令
- [x] 7.2 `ai-guide` 增补分页与确认语义（`ai_message`、`-y`）
- [x] 7.3 `SKILL.md` 保持极简命令目录（不重复 schema）

## 8. 验证与回放

- [x] 8.1 本地离线验证：schema + normalizer + handler 参数链路
- [x] 8.2 真实联调验证（网络恢复后）
  - [x] 8.2.1 场景："帮我在studio上面查看一下我有哪些报错的python调度任务，并查看错误原因"
  - [x] 8.2.2 记录完整 `tool_call` 与 `tool_result`
  - [x] 8.2.3 回放记录：`openspec/changes/studio-task-runs-commands/replays/2026-04-03-real-tool-trace.json`（当日环境失败 Python 调度实例数为 0）
- [x] 8.3 集成测试补齐（真实环境、串行场景链路）覆盖 task/runs/executions 的分页与 destructive 确认分支

## 9. 回归修复（2026-04-03）

- [x] 9.1 修复 `task save-config` 走旧 tool 导致 `rerun_property` 缺失报错问题
  - [x] 9.1.1 `cz-mcp-server` 的 `get_all_tools()` 注册 `save_task_configuration_v2_tools`
  - [x] 9.1.2 CLI `task save-config` 优先调用 `save_task_cron_configuration`
  - [x] 9.1.3 兼容旧 MCP：回退 `save_task_configuration` 时默认补 `rerun_property=1`
- [x] 9.2 修复 `runs detail/log/stop <task_name>` 仅查询 `task_run_type=1` 导致漏掉实例问题
  - [x] 9.2.1 任务名解析 run_id 时跨 `task_run_type=1/3/4` 查询并选取最新实例
  - [x] 9.2.2 回归测试覆盖：type=1 为空、type=4 命中场景
- [x] 9.3 新增 `executions` 命令组并补齐取消语义
  - [x] 9.3.1 新增 `executions list <run_id_or_task_name>`（支持分页与 `ai_message`）
  - [x] 9.3.2 新增 `executions log <run_id_or_task_name>`（默认取最新 execution）
  - [x] 9.3.3 `runs stop` / `task online` / `task offline` 取消提示改为“用户取消，未执行操作”
- [x] 9.4 `runs list` 增加 `--run-type` 显式过滤参数，避免默认类型导致误解
  - [x] 9.4.1 支持 `SCHEDULE|TEMP|REFILL|1|3|4`
  - [x] 9.4.2 `ai_message` 显示当前 `run_type`
- [x] 9.5 `executions list` 支持无参数调用（AI 友好）
  - [x] 9.5.1 无参数时自动派生“当前项目最近一次 run_id”后调用 `list_executions`
  - [x] 9.5.2 `ai_message` 明确说明 run_id 来源（自动选择）
- [x] 9.6 修复 `list_executions` 在 API `data=null` 时抛 `'NoneType' object is not iterable'`
  - [x] 9.6.1 `cz-mcp-server` `handle_list_executions` 对 `data/count` 做空值兼容
  - [x] 9.6.2 本地回放验证：`code=200,data=null` 返回空 executions
- [x] 9.7 `executions` 命令文案澄清参数语义
  - [x] 9.7.1 帮助文档强调：位置参数是 `run_id/task_name`，不是 `execution_id`
  - [x] 9.7.2 ai-guide / SKILL 文案同步
- [x] 9.8 新增 `executions stop` 并明确运行实例级停止语义
  - [x] 9.8.1 支持 `run_id_or_task_name` 参数解析（不要求传 `execution_id`）
  - [x] 9.8.2 支持二次确认与 `-y` 直通执行
- [x] 9.9 新增 `runs refill` 场景化补数提交能力（消除集成测试外部 run target 依赖）
  - [x] 9.9.1 `cz-mcp-server` 新增 `create_backfill_job` tool（含下游查询与权限校验链路）
  - [x] 9.9.2 `cz-cli runs refill` 支持 `task_name_or_id + time window` 并二次确认
  - [x] 9.9.3 集成测试改为“创建任务 -> 提交补数 -> 获取 run -> runs/executions 闭环验证”
- [x] 10.1 共性回归防线：抽取共享 resolver，统一 task/run 参数解析
  - [x] 10.1.1 `task` / `runs` / `executions` 复用共享解析逻辑，避免重复实现漂移
  - [x] 10.1.2 增加 resolver 单测，覆盖跨 run_type 最新实例选择与 task 名称歧义
- [x] 10.2 集成测试输出可读性统一
  - [x] 10.2.1 integration runner 对未显式指定输出格式的步骤自动注入 `-o pretty`
  - [x] 10.2.2 在 spec 中记录该默认契约
