## Context

cz-cli 已实现 SQL 执行、schema/table 管理等数据层操作，通过 clickzetta-connector SDK 直连 Lakehouse。Studio 是 ClickZetta 的任务开发和调度平台，有独立的 REST API（ide-admin 服务），与 Lakehouse SQL 接口完全分离。

`cz-mcp-server` 已实现完整的 Studio API 客户端，包括认证流程（login → JWT → project_id 推导）和所有 handler 函数。直接复用这些 handler 是最低成本的路径。

**当前状态**:
- cz-cli 无任何 Studio 操作能力
- cz-mcp-server 有完整 Studio handler，可作为 CLI 的复用实现来源
- profile 字段（username/password/instance/workspace/schema/vcluster）与 MCP server 的连接参数完全对齐

**参考资源**:
- MCP handler: `/Users/zhanglin/PycharmProjects/claude-skills-mcp/cz-mcp-server/cz_mcp/handlers/ide_admin_server.py`
- MCP 认证流程: `/Users/zhanglin/PycharmProjects/claude-skills-mcp/cz-mcp-server/cz_mcp/transport/mcp_server.py` L82-L150
- API 端点配置: `/Users/zhanglin/PycharmProjects/claude-skills-mcp/cz-mcp-server/cz_mcp/config/api_properties.ini`

## Goals / Non-Goals

**Goals:**
- 通过 `cz task` / `cz runs` 命令覆盖 Studio 任务开发和运维的核心工作流
- 复用 cz-mcp-server handler，不重复实现 Studio API 客户端
- project_id 自动推导，用户只需配置 profile，无需感知 Studio 内部 ID
- SKILL.md 保持轻量（仅命令名+一行描述），符合按需披露原则

**Non-Goals:**
- 不实现 task offline（Studio API 不存在此端点）
- 不实现 runs stop/kill（V2）
- 不实现 runs 依赖图（V2）
- 不实现 task 创建（Studio 任务创建涉及复杂类型选择，不适合 CLI）
- 不实现 backfill 管理（专项运维，V2）

## Decisions

### Decision 1: 删除 MCP stdio 链路，直接复用 Python handler

**选择**: 不采用 `run_stdio_server.py` 子进程 + `session.call_tool()` 的调用策略。CLI 直接复用 `cz-mcp-server` 的 Python handler 和认证构建块。

**理由**:
- 减少进程跳转和序列化层，链路更短
- 避免每条命令启动子进程带来的额外时延
- 错误定位更直接，调用栈与日志更容易追踪

**影响**:
- 不引入 MCP client SDK 和 stdio client 运行时
- `cz_cli/studio_client.py` 作为同步适配层，统一封装 handler 调用和错误格式

### Decision 2: 在 cz-mcp-server 中抽取同步认证函数

**选择**: 在 `cz_mcp/handlers/studio_auth.py`（新文件）中实现 `resolve_studio_config(username, password, instance, workspace, schema, vcluster, service_url) -> StudioConfig`，全程同步调用

**实现路径**（全部为已有同步函数）:
```
login_wrapper(instance, username, password, url)   → jwt, user_id, instance_id
get_user_id(url, jwt, env)                         → 验证 user_id
get_user_config(jwt, user_id, account_id, env)     → user_config_dict → project_id
list_user_workspaces(...)                          → workspace_id
→ 组装 StudioConfig(token=jwt, project_id=..., workspace_id=..., ...)
```

**理由**:
- `mcp_server.py` 中的 async 方法（`_authenticate_user`、`_resolve_workspace_config` 等）本质上只是对 `login_server.py` 和 `ide_admin_server.py` 中同步函数的 async 包装
- 直接串联同步构建块，无需 `asyncio.run()`，无嵌套 event loop 风险
- 新函数放在 cz-mcp-server 中，是对现有代码的自然延伸，不是重复实现
- project_id 与 workspace 一一对应，profile 中已有 workspace，用户无需感知

### Decision 3: `cz runs` 作为独立顶层命令组

**选择**: `cz runs list/detail/log/stats`，而非 `cz task run list`

**理由**:
- `task run` 存在动词/名词歧义（"运行任务" vs "任务的运行记录"）
- `runs` 作为名词（运行记录集合）语义清晰，与 GitHub Actions、Airflow 等工具一致
- 分离管理层（task）和运维层（runs）符合职责单一原则

### Decision 4: `cz runs detail` 复用 `instance_list`

**选择**: `cz runs detail RUN_ID` 内部调用 `instance_list(task_name_or_id=RUN_ID, page_size=1)`

**理由**:
- `TASK_INST_GET_DETAIL` API 端点存在但无 handler 实现
- `instance_list` 的 `task_name_or_id` 参数支持直接传入 run_id，返回字段已足够
- 避免新增 handler，降低对 cz-mcp-server 的侵入

### Decision 5: `cz runs log` 两步串联

**选择**: 先调 `list_execution_records(task_run_id)` 获取最新 execution_id，再调 `get_execution_log_content(execution_id, task_run_id)`

**理由**:
- Studio 中一次 task run 可能有多次 execution（重试）
- CLI 默认取最新一次 execution 的日志，符合运维直觉
- 两个 handler 均已实现，无需新增代码

### Decision 7: PAT 认证统一通过 login_wrapper 换 JWT，走统一 StudioConfig 流程

**选择**: PAT 不直接传给 Studio API，统一先调 `login_wrapper(instance, pat=pat, url=service_url)` 换取 JWT，再走各自的 JWT 路径

**理由**:
- clickzetta-connector Python SDK 不支持 PAT，只支持 `magic_token`（即 JWT）
- Studio 命令需要完整的 `StudioConfig` 对象（含 project_id、workspace_id、tenant_id 等），必须走 `studio_auth.py` 的完整初始化流程，该流程以 JWT 为起点
- PAT → JWT 的换取由 `login_wrapper` 完成，与 username/password 路径在 JWT 之后完全一致

**两条路径**:
```
PAT profile                          username/password profile
    ↓                                        ↓
login_wrapper(instance, pat=pat)     login_wrapper(instance, username, password)
    ↓                                        ↓
              JWT（两条路径在此汇合）
              ↙                    ↘
  magic_token → SDK connect()      get_user_id() → get_user_config()
  (SQL/schema/table)               → list_user_workspaces() → StudioConfig
                                   (task/runs，token=JWT → x-lakehouse-token header)
```

**profile 字段互斥约束**:
- `pat` 与 `username`/`password` 二选一，缺少任一组合时报错
- `pat` 模式必填：`pat`、`instance`、`service`、`workspace`
- `username/password` 模式必填：`username`、`password`、`instance`、`service`、`workspace`

**profile TOML 示例**:
```toml
[profiles.myprofile]
pat = "eyJ..."
instance = "tmwmzxzs"
service = "dev-api.clickzetta.com"
workspace = "wanxin_test_08"
schema = "public"
vcluster = "default"
```

**环境变量**: `CZ_PAT` 等价于 profile `pat` 字段

**选择**: SKILL.md 中 task/runs 部分只列命令名+一行描述，不内嵌参数 schema

**理由**:
- MCP 的"情景税"本质是 tool description 永远在 system prompt，不管用不用都消耗 token
- SKILL.md 的职责是让模型知道命令存在，参数细节通过 `cz-cli ai-guide` 按需获取
- 保持 SKILL.md 轻量，避免变成另一种形式的情景税

### Decision 8: 数据驱动 E2E 测试框架

**选择**: 采用极简文件驱动 E2E V1。测试 case 以 YAML 文件存放在 `tests/e2e/cases/`，`tests/e2e/test_e2e.py` 用单一 parametrized test 加载并执行。

**理由**:
- 用户可直接审查测试文件（命令和期望），无需理解测试框架内部实现
- YAML case 文件可读性强，新增 case 不需要改 runner 逻辑
- 与现有单元测试并存，覆盖“黑盒行为验证”场景

**目录结构**:
```
tests/
  e2e/
    conftest.py            # E2E fixtures: CLI runner（复用用户准备好的隔离 profiles.toml，不做 mock）
    runner.py              # YAML loader → pytest parametrize params
    test_e2e.py            # 单一 parametrized test
    cases/
      profile.yaml
      sql.yaml
      schema.yaml
      table.yaml
      workspace.yaml
      task.yaml
      runs.yaml
    resources/             # SQL/CSV 等测试资源文件
  integration/             # 预留目录：未来真实系统集成测试（本期不纳入执行范围）
```

**V1 支持范围**:
- `cmd`（参数数组）
- `env`（可选）
- `expect.exit_code`
- `expect.output_contains` / `expect.error_contains`（可选）
- `expect.json_contains`（可选，浅层匹配）

**V1 暂不支持**:
- workflow 编排 DSL（复杂 setup/teardown）
- 跨系统集成测试执行编排
- 动态模板和跨 case 依赖

**执行方式**:
```bash
pytest tests/e2e/                          # 全量 E2E
pytest tests/e2e/ -k "profile"             # 只跑 profile cases
pytest tests/e2e/ -k "task and list"       # 只跑 task list cases
```

### Pending Design A: 认证优先级（全局命令）
`pat` / username-password 在 CLI 参数、环境变量、profile 三层的最终优先级规则，先标记为待设计，不在当前实现前置定稿。

### Pending Design B: CLI 参数语义与 tool required 字段归一化
`task/runs` 命令中“用户必填参数”和“下游 API 必填字段（可由 CLI 推导补齐）”的边界与校验策略，先标记为待设计。

### Risk 1: cz-mcp-server 依赖版本漂移
**风险**: cz-mcp-server handler 接口变更导致 cz-cli 静默失败
**缓解**: 在 `studio_client.py` 中对 handler 调用加 try-except，错误信息包含 handler 名称便于排查；pyproject.toml 锁定 cz-mcp-server 版本

### Risk 2: studio_auth.py 与 mcp_server.py 逻辑漂移
**风险**: `mcp_server.py` 的认证逻辑更新后，`studio_auth.py` 的同步版本未同步更新
**缓解**: 在 `studio_auth.py` 顶部注释标注"与 mcp_server.py `_update_server_connection` 保持同步"，code review 时作为检查点

### Risk 3: project_id 推导依赖 workspace 配置
**风险**: 用户 profile 中未配置 workspace，导致 project_id 推导失败
**缓解**: 在 `studio_client.py` 初始化时提前检查，返回清晰错误："workspace is required for task/runs commands, please set it in your profile"

### Trade-off: 包体积 vs 代码复用
**选择**: 接受包体积增大，换取零重复的 Studio API 客户端
**理由**: 目标用户是 ClickZetta 生态用户，已接受相关依赖

## Migration Plan

**部署步骤**:
1. 在 cz-mcp-server 中确认 handler 函数签名稳定
2. 实现 `studio_client.py` 认证封装
3. 实现 `commands/task.py` 和 `commands/runs.py`
4. 更新 `main.py` 注册命令
5. 更新 `SKILL.md` 和 `ai-guide`
6. 更新 `pyproject.toml` 添加 cz-mcp-server 依赖

**回滚策略**:
- task/runs 命令是纯新增，不影响现有命令
- 如有问题，从 main.py 移除注册即可禁用

## Open Questions

1. **cz-mcp-server 的安装方式**: 通过本地路径依赖（`pip install -e ../claude-skills-mcp/cz-mcp-server`）还是内部 PyPI？影响 pyproject.toml 的写法。
