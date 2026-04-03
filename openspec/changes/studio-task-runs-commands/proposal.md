## Why

cz-cli 已覆盖 SQL 执行和数据对象管理，但缺少两项能力：Studio 任务管理，以及 PAT（Personal Access Token）认证支持。AI Agent 无法通过 CLI 完成任务开发和运维工作流，且当前只支持用户名/密码认证，不适合 CI/CD 和自动化场景。

## What Changes

- 新增 `cz task` 命令组：Studio 任务定义管理（list/folders/detail/online/save/save-config）
- 新增 `cz runs` 命令组：Studio 任务运行实例运维（list/detail/log/stats）
- 新增 `cz_mcp/handlers/studio_auth.py`：同步认证函数，支持 username/password 和 PAT 两种模式
- 新增 `cz_cli/studio_client.py`：同步适配层，直接复用 `cz_mcp.handlers.ide_admin_server` handler 函数
- 更新 `profile` 命令：支持 `pat` 字段（等价于 username/password，适合自动化场景）
- 更新 `connection.py`：PAT 模式下调用 `login_wrapper` 换取 JWT，再以 `magic_token` 方式连接 SDK
- 更新 `SKILL.md`：追加 task/runs 命令条目（仅名称+一行描述，保持按需披露原则）
- 更新 `ai-guide` 输出：包含 task/runs 命令的参数说明
- 新增极简文件驱动 E2E 框架（YAML case + 单一 runner），并将集成测试用例独立到 `tests/integration/`

## Capabilities

### New Capabilities
- `task-management`: Studio 任务定义管理——列出文件夹和任务、查看详情、发布上线、保存内容和调度配置
- `runs-management`: Studio 任务运行实例运维——列出运行记录、查看详情、获取执行日志、查看聚合统计

### Modified Capabilities
- `profile-management`: 新增 `pat` 认证字段，支持 PAT 模式创建和更新 profile
- `connection-management`: 新增 PAT 认证路径（PAT → login_wrapper → JWT/magic_token → SDK）
- `ai-guide`: 在现有 ai-guide 输出中追加 task 和 runs 命令文档

## Impact

**代码影响**:
- 新增 `cz_mcp/handlers/studio_auth.py`（在 cz-mcp-server repo）
- 新增 `cz_cli/commands/task.py`
- 新增 `cz_cli/commands/runs.py`
- 新增 `cz_cli/studio_client.py`（同步调用适配 + Studio API 认证 + project_id 推导）
- 修改 `cz_cli/connection.py`：添加 PAT 字段和 magic_token 连接路径
- 修改 `cz_cli/commands/profile.py`：添加 `--pat` 参数
- 修改 `cz_cli/main.py`：注册 task/runs 命令组
- 修改 `cz_cli/skills/cz-cli/SKILL.md`：追加命令条目
- 新增 `tests/e2e/`（文件驱动 E2E）和 `tests/integration/`（后续集成测试目录）

**依赖变更**:
- 新增依赖：`cz-mcp-server`（通过本地路径或内部 PyPI）

**用户影响**:
- 需要 Studio 访问权限（profile 中的 workspace 字段对应 Studio 项目空间）
- project_id 自动推导，用户无需感知
- PAT 认证：`profile create myprofile --pat <token> --instance inst --workspace ws ...`

## Pending Design (Not Blocking Proposal)

- 认证优先级最终规则：`--pat` / `CZ_PAT` / profile `pat` 与 username/password 的覆盖顺序
- `task/runs` 参数语义归一化：用户必填参数与下游 required 字段（CLI 自动补齐）边界

## Testing Scope

- 当前阶段采用极简 E2E V1：直接执行 YAML case 定义的 CLI 命令，断言退出码和输出
- `profile` 相关行为纳入 E2E 必测范围
- 集成测试场景（真实系统联调、workflow）后续放到 `tests/integration/`，不纳入本期默认执行
