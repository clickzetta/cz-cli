## 1. 依赖和基础设施

- [ ] 1.1 在 `pyproject.toml` 中添加/锁定 `cz-mcp-server` 依赖（不引入 MCP stdio client SDK）
- [ ] 1.2 创建 `cz_cli/studio_client.py`：基于 Python handler 的同步适配层
  - [ ] 1.2.1 复用 `studio_auth.py` 组装 `StudioConfig`（支持 username/password 与 PAT）
  - [ ] 1.2.2 实现统一调用入口（封装 `ide_admin_server` handler 调用）
  - [ ] 1.2.3 统一返回 JSON 结构和错误码映射
  - [ ] 1.2.4 workspace 缺失时提前报错

## 2. cz task 命令实现

- [ ] 2.1 创建 `cz_cli/commands/task.py`，注册 `task` Click group
- [ ] 2.2 实现 `task folders` 子命令
  - [ ] 2.2.1 调用 `studio_client.invoke("list_folders", {"parent_folder_id": ...})`
  - [ ] 2.2.2 支持 `--parent FOLDER_ID` 参数（默认列根目录）
  - [ ] 2.2.3 输出 `{ items: [...], count }` JSON
- [ ] 2.3 实现 `task list` 子命令
  - [ ] 2.3.1 调用 `studio_client.invoke("list_clickzetta_tasks", {"folderId": ..., "taskName": ..., "taskType": ...})`
  - [ ] 2.3.2 支持 `--folder FOLDER_ID`、`--type TYPE`、`--name KEYWORD` 参数
  - [ ] 2.3.3 task_type 枚举映射（SQL/PYTHON/SHELL/SPARK → 整数类型码）
  - [ ] 2.3.4 输出 `{ items: [...], count }` JSON
- [ ] 2.4 实现 `task detail TASK_ID` 子命令
  - [ ] 2.4.1 调用 `studio_client.invoke("get_task_detail", {"task_id": TASK_ID})`
  - [ ] 2.4.2 处理任务不存在错误
- [ ] 2.5 实现 `task online TASK_ID` 子命令
  - [ ] 2.5.1 调用 `studio_client.invoke("publish_task", {"task_id": ..., "version": ...})`
  - [ ] 2.5.2 支持 `--version VERSION` 参数
  - [ ] 2.5.3 输出 `{ success, task_id, message }` JSON
- [ ] 2.6 实现 `task save TASK_ID` 子命令
  - [ ] 2.6.1 调用 `studio_client.invoke("save_non_integration_task_content", {"task_id": ..., "content": ...})`
  - [ ] 2.6.2 支持 `--content TEXT` 参数（直接传入内容）
  - [ ] 2.6.3 支持 `--file PATH` 参数（从文件读取内容）
- [ ] 2.7 实现 `task save-config TASK_ID` 子命令
  - [ ] 2.7.1 调用 `studio_client.invoke("save_task_configuration", {"task_id": ..., "cron_expression": ..., "vc_name": ..., "schema_name": ...})`
  - [ ] 2.7.2 支持 `--cron EXPR`、`--vc VCLUSTER`、`--schema SCHEMA` 参数

## 3. cz runs 命令实现

- [ ] 3.1 创建 `cz_cli/commands/runs.py`，注册 `runs` Click group
- [ ] 3.2 实现 `runs list` 子命令
  - [ ] 3.2.1 调用 `studio_client.invoke("list_task_run", {"task_id": ..., "task_run_status_list": ..., "query_plan_time_left": ..., "query_plan_time_right": ...})`
  - [ ] 3.2.2 支持 `--task TASK_ID`、`--status STATUS`、`--from DATETIME`、`--to DATETIME` 参数
  - [ ] 3.2.3 status 枚举映射（RUNNING/SUCCESS/FAILED/WAITING → 整数状态码）
  - [ ] 3.2.4 datetime 参数转换为毫秒时间戳
  - [ ] 3.2.5 默认时间范围：过去 24 小时
  - [ ] 3.2.6 输出 `{ items: [...], count }` JSON
- [ ] 3.3 实现 `runs detail RUN_ID` 子命令
  - [ ] 3.3.1 调用 `studio_client.invoke("list_task_run", {"task_name_or_id": str(RUN_ID), "page_size": 1})`
  - [ ] 3.3.2 处理结果为空时的 `RUN_NOT_FOUND` 错误
- [ ] 3.4 实现 `runs log RUN_ID` 子命令
  - [ ] 3.4.1 第一步：调用 `studio_client.invoke("list_executions", {"task_run_id": RUN_ID})` 获取最新 execution_id
  - [ ] 3.4.2 第二步：调用 `studio_client.invoke("get_execution_log", {"task_run_id": RUN_ID, "execution_id": ..., "query_action": 3})`
  - [ ] 3.4.3 支持 `--offset OFFSET` 参数（`query_action=1` 向下读取）
  - [ ] 3.4.4 处理无 execution 记录错误
- [ ] 3.5 实现 `runs stats` 子命令
  - [ ] 3.5.1 调用 `studio_client.invoke("get_task_run_stats", {"schedule_task_name": ..., "query_start_plan_time": ..., "query_end_plan_time": ...})`
  - [ ] 3.5.2 支持 `--task TASK_NAME`、`--from DATE`、`--to DATE` 参数

## 4. 注册命令和更新入口

- [ ] 4.1 在 `cz_cli/main.py` 中 import 并注册 `task` 和 `runs` 命令组
- [ ] 4.2 更新 `ai-guide` 输出，追加 task 和 runs 命令文档（含参数说明和示例）
- [ ] 4.3 更新 `cz_cli/skills/cz-cli/SKILL.md`，追加 Task Management 和 Runs Management 章节（仅命令名 + 一行描述）

## 5. PAT 认证支持

- [ ] 5.1 更新 `cz_cli/connection.py`：添加 PAT 认证路径
  - [ ] 5.1.1 在 `ConnectionConfig` dataclass 中添加 `pat: str | None = None` 字段
  - [ ] 5.1.2 在 `_get_env_config()` 中读取 `CZ_PAT` 环境变量
  - [ ] 5.1.3 在 `get_connection()` 中：若 `pat` 存在，调用 `login_wrapper(instance, pat=pat, url=service_url)` 换取 JWT，再以 `magic_token=<jwt>` 方式构建 SDK 连接 URL
- [ ] 5.2 更新 `cz_cli/commands/profile.py`：添加 PAT 支持
  - [ ] 5.2.1 `profile create` 添加 `--pat` 选项（与 `--username`/`--password` 互斥）
  - [ ] 5.2.2 `profile list` 对 PAT 字段脱敏显示（前 8 位 + `****`），显示 `auth_mode: pat`
  - [ ] 5.2.3 `profile update` 支持更新 `pat` 字段
- [ ] 5.3 为 PAT 认证编写测试
  - [ ] 5.3.1 测试 PAT profile 创建和列出
  - [ ] 5.3.2 测试 PAT → magic_token 换取流程（mock login_wrapper）
  - [ ] 5.3.3 测试 PAT 优先级高于 username/password

## 6. 待设计项（先标记，不阻塞文档对齐）

- [ ] 6.1 全局认证优先级规则：`--pat` / `CZ_PAT` / profile `pat` 与 username/password 的最终覆盖顺序
- [ ] 6.2 `task/runs` 参数语义：用户必填参数与下游 required 字段（CLI 自动补齐）的归一化与校验策略

## 7. E2E 测试框架（极简 V1）

- [ ] 7.1 建立文件驱动 E2E 框架结构
  - [ ] 7.1.1 创建 `tests/e2e/`、`tests/e2e/cases/`、`tests/e2e/resources/` 目录
  - [ ] 7.1.2 创建 `tests/e2e/conftest.py`：E2E runner fixtures（直接使用用户准备好的隔离 `~/.clickzetta/profiles.toml`，不做 mock）
  - [ ] 7.1.3 创建 `tests/e2e/runner.py`：YAML case 加载器
  - [ ] 7.1.4 创建 `tests/e2e/test_e2e.py`：单一 parametrized test，逐 case 执行 CLI 并断言
  - [ ] 7.1.5 更新 `pyproject.toml` pytest 配置并添加 `pyyaml` 到 dev 依赖
- [ ] 7.2 定义 V1 YAML case 格式（仅保留最小字段）
  ```yaml
  command: profile
  cases:
    - name: "描述"
      cmd: ["profile", "list"]
      env: {CZ_PAT: "xxx"}     # 可选
      expect:
        exit_code: 0
        output_contains: "x"   # 可选
        error_contains: "y"    # 可选
        json_contains: {ok: true}  # 可选，浅层匹配
  ```
- [ ] 7.3 创建 `tests/e2e/cases/profile.yaml`（必须覆盖 create/list/use/update/delete 及 PAT 分支）
- [ ] 7.4 创建 `tests/e2e/cases/sql.yaml`、`schema.yaml`、`table.yaml`、`workspace.yaml`
- [ ] 7.5 在命令实现完成后补充 `tests/e2e/cases/task.yaml`、`runs.yaml`
- [ ] 7.6 为 SQL/CSV 场景提供 `tests/e2e/resources/` 资源文件并在 case 中引用

## 8. 集成测试（单独目录，后续阶段）

- [ ] 8.1 创建 `tests/integration/` 目录并补充 README（说明本期不纳入默认执行）
- [ ] 8.2 将真实系统联调/工作流场景放入 `tests/integration/cases/`（后续增量实现）

## 9. `studio_client.py` 单元测试

- [ ] 9.1 PAT 路径：mock `login_wrapper` 返回 JWT，验证 `StudioConfig.token` 正确
- [ ] 9.2 username/password 路径：验证 `StudioConfig` 组装逻辑
- [ ] 9.3 workspace 缺失时的错误提示
