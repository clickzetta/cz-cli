## Why

ClickZetta Lakehouse 需要一个 AI-Agent 友好的 CLI 工具，遵循 Andrej Karpathy 的理念：稳定的 CLI + 清晰的权限体系 + AI 可读的文档。当前缺少这样的工具，导致用户和 AI Agent 难以高效使用 ClickZetta 的功能。

## What Changes

- **包命名**: 使用 `cz-cli` 作为包名和命令名，模块名为 `cz_cli`，配置目录保持 `~/.clickzetta/`
- 实现 ClickZetta 特性的核心模块：
  - connection.py: 支持 Profile 配置、JDBC URL、环境变量、命令行参数
  - commands/sql.py: 适配 ClickZetta SDK，支持异步执行、变量替换、超时控制、job profile、SQL flag 设置 (--set)
  - commands/schema.py: 适配 ClickZetta SQL 语法（SHOW SCHEMAS, CREATE/DROP SCHEMA）
  - commands/table.py: 使用 ClickZetta 文档中的 SQL（SHOW CATALOG TABLE, DESC TABLE, SHOW TABLES HISTORY）
  - commands/profile.py: Profile 管理命令
  - commands/workspace.py: Workspace 管理命令
  - main.py: 全局参数、ai-guide 内容、命令注册
  - output.py: 添加 count 字段到所有列表/查询响应，显示返回的数据记录数
- 内置安全护栏：
  - 写保护、危险操作拦截、敏感字段脱敏、行数限制
  - 错误自纠正（列名/表名错误自动返回 schema 信息）
  - 多格式输出（JSON/Table/CSV/TOON）
  - 操作日志记录（~/.clickzetta/）
- 生成 AI Skills 文档，交互式安装器
- 命令参数支持短选项（-e, -f, -N, -B 等）

## Capabilities

### New Capabilities
- `profile-management`: Profile 配置管理（create, list, use, update, delete），支持 TOML 配置文件
- `sql-execution`: SQL 执行引擎适配 ClickZetta SDK，支持异步执行、变量替换、超时控制、job profile
- `workspace-management`: Workspace 管理（current 查询当前 workspace，use 切换 workspace），通过 SELECT current_workspace() 和更新 profile 配置实现
- `schema-management`: Schema 管理（list, create, drop, describe），适配 ClickZetta SQL 语法
- `table-management`: Table 管理（list, describe, preview, create, drop, stats, history），使用 ClickZetta 文档中的 SQL 语法
- `connection-management`: 多源连接管理（profile/JDBC/env/CLI），支持 JDBC URL 解析
- `ai-guide`: AI Agent 使用指南生成，适配 ClickZetta 命令和示例
- `install-skills`: AI 编码助手技能交互式安装器

## Impact

**代码影响**:
- 新增 `cz_cli/` 包，包含所有 CLI 代码
- 适配 clickzetta-connector SDK

**依赖变更**:
- 新增依赖：clickzetta-connector>=1.0.16, click>=8.0, loguru>=0.7.0, toons>=0.1.0, questionary>=1.10.0

**用户影响**:
- 用户需要配置 ~/.clickzetta/profiles.toml 或设置环境变量
- 提供 `cz-cli` 命令入口
- 操作日志记录到 ~/.clickzetta/sql-history.jsonl
- 所有输出响应包含 count 字段，显示返回的数据记录数

**系统影响**:
- 需要 Python 3.11+ 环境
- 需要访问 ClickZetta 服务端点（默认 dev-api.clickzetta.com）
