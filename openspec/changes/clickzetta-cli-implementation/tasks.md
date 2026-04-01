## 1. 项目基础设置

- [x] 1.1 初始化 cz_cli/ 包结构
- [x] 1.2 更新 pyproject.toml (依赖、版本、入口点)
- [x] 1.3 更新 __init__.py 版本号
- [x] 1.4 确定需要的核心模块 (connection.py, logger.py, output.py, masking.py)
- [x] 1.5 包名 cz-cli，命令名 cz-cli，模块名 cz_cli
- [x] 1.6 配置目录 ~/.clickzetta/

## 2. 核心模块改造

- [x] 2.1 实现 logger.py (日志路径 ~/.clickzetta/)
- [x] 2.2 完全重写 connection.py (适配 clickzetta-connector SDK)
  - [x] 2.2.1 实现 ConnectionConfig dataclass
  - [x] 2.2.2 实现 JDBC URL 解析 (_parse_jdbc_url)
  - [x] 2.2.3 实现 Profile 配置读取 (_load_profiles, _get_profile_config)
  - [x] 2.2.4 实现环境变量读取 (_get_env_config)
  - [x] 2.2.5 实现连接配置解析 (resolve_connection_config)
  - [x] 2.2.6 实现 get_connection 函数 (使用 clickzetta.connector.v0.connection.connect)
- [x] 2.3 验证 output.py 无需改动
- [x] 2.4 验证 masking.py 无需改动
- [x] 2.5 添加 count 字段到所有输出响应 (显示数据记录数)
- [x] 2.6 添加 TOON 输出格式支持 (使用 toons 库, LLM 优化格式)

## 3. Profile 管理命令

- [x] 3.1 创建 commands/profile.py
  - [x] 3.1.1 实现 profile list 命令
  - [x] 3.1.2 实现 profile create 命令
  - [x] 3.1.3 实现 profile update 命令
  - [x] 3.1.4 实现 profile delete 命令
  - [x] 3.1.5 实现 profile use 命令

## 4. SQL 执行命令改造

- [x] 4.1 实现 commands/sql.py 适配 ClickZetta SDK
  - [x] 4.1.1 更新 import 语句 (移除 pymysql, 添加 clickzetta.connector)
  - [x] 4.1.2 适配 cursor 接口 (CZ SDK 的 cursor 与 pymysql 的差异)
  - [x] 4.1.3 实现行数限制 (使用 SET cz.sql.result.row.partial.limit=100)
  - [x] 4.1.4 实现异步执行 (--async 选项)
    - [x] 4.1.4.1 调用 cursor.execute_async()
    - [x] 4.1.4.2 实现轮询逻辑 (cursor.is_job_finished())
    - [x] 4.1.4.3 显示进度信息
  - [x] 4.1.5 实现变量替换 (--variable 选项, pyformat 风格: %(key)s)
  - [x] 4.1.6 实现超时控制 (--timeout 选项, hints={'sdk.job.timeout': N})
  - [x] 4.1.7 实现 job profile (--job-profile 选项, conn.get_job_summary())
  - [x] 4.1.8 实现 sql status 子命令 (查询异步任务状态)
  - [x] 4.1.9 更新错误处理 (适配 CZ SDK 的异常类型)
  - [x] 4.1.10 添加短选项支持 (-e, -f, -N, -B)
  - [x] 4.1.11 添加 --with-schema 选项 (包含表结构信息)
  - [x] 4.1.12 添加 --no-truncate 选项 (不截断大字段)
  - [x] 4.1.13 添加 --set 选项 (设置 ClickZetta SQL flag, 如 --set cz.sql.result.row.partial.limit=200)
  - [x] 4.1.14 在所有 SQL 输出中返回 job_id (用于追踪和调试)

## 5. Schema 管理命令改造

- [x] 5.1 改造 commands/schema.py 适配 ClickZetta SQL
  - [x] 5.1.1 更新 schema list (使用 SHOW SCHEMAS)
  - [x] 5.1.2 更新 schema describe (查询系统表或使用 DESC SCHEMA)
  - [x] 5.1.3 实现 schema create (CREATE SCHEMA)
  - [x] 5.1.4 实现 schema drop (DROP SCHEMA)
  - [x] 5.1.5 添加 --like 过滤支持

## 6. Workspace 管理命令

- [x] 6.1 创建 commands/workspace.py
  - [x] 6.1.1 实现 workspace current 命令 (执行 SELECT current_workspace())
  - [x] 6.1.2 实现 workspace use 命令 (通过 SDK hint sdk.job.default.ns='workspace.schema' 切换，可选更新 profile 持久化)
  - **注**: workspace list 命令不实现（ClickZetta 无 SHOW WORKSPACES SQL 命令）
  - **SDK 实现**: 使用 hints={'sdk.job.default.ns': f'{workspace}.{schema}'}, 解析时 split('.')[0] 是 workspace, split('.')[1] 是 schema

## 7. Table 管理命令

- [x] 7.1 创建 commands/table.py
  - [x] 7.1.1 实现 table list 命令 (使用 SHOW CATALOG TABLE, 参考 /Users/zhanglin/IdeaProjects/lakehouse_doc/show-catalog-table.md)
    - [x] 7.1.1.1 添加 --like 过滤
    - [x] 7.1.1.2 添加 --schema 过滤
  - [x] 7.1.2 实现 table describe 命令 (使用 DESC TABLE, 参考 /Users/zhanglin/IdeaProjects/lakehouse_doc/DESCTABLE.md)
  - [x] 7.1.3 实现 table preview 命令 (SELECT * FROM catalog_name.schema_name.table_name LIMIT n)
  - [x] 7.1.4 实现 table stats 命令 (使用 conn.get_job_summary(cursor.job_id))
  - [x] 7.1.5 实现 table history 命令 (使用 SHOW TABLES HISTORY)
  - [x] 7.1.6 实现 table create 命令 (CREATE TABLE, 支持 --from-file)
  - [x] 7.1.7 实现 table drop 命令 (DROP TABLE)

## 8. CLI 入口改造

- [x] 8.1 改造 main.py
  - [x] 8.1.1 更新全局参数 (添加 --profile, --jdbc-url, --schema, --vcluster, --output/-o, --format (作为 --output 别名), --debug, --silent, --verbose)
  - [x] 8.1.2 添加全局参数短选项 (-s, -v, -d, -o 等) 和批量模式选项 (-N/--no-header, -B/--batch)
  - [x] 8.1.3 更新 ai-guide 内容 (替换为 ClickZetta 命令和示例)
  - [x] 8.1.4 注册所有命令 (profile, sql, workspace, schema, table)
  - [x] 8.1.5 更新 status 命令 (适配 CZ 连接)
  - [x] 8.1.6 移除不需要的命令导入
  - [x] 8.1.7 更新 --help 文档

## 9. 测试

- [x] 9.1 创建测试环境配置
  - [x] 9.1.1 创建测试 profile 配置 (username=xxx, password=xxx, service=dev-api.clickzetta.com, instance=tmwmzxzs, workspace=wanxin_test_08, schema=public, vcluster=default)
  - [x] 9.1.2 准备测试数据库和表
- [x] 9.2 编写单元测试
  - [x] 9.2.1 测试 connection.py (JDBC URL 解析, profile 读取)
  - [x] 9.2.2 测试 logger.py (日志记录)
  - [x] 9.2.3 测试 masking.py (敏感字段脱敏)
  - [x] 9.2.4 测试 output.py (格式化输出)
- [x] 9.3 编写 E2E 测试 (使用 pytest 模拟 CLI 命令)
  - [ ] 9.3.1 测试 profile 命令 (create, list, use, update, delete)
  - [ ] 9.3.2 测试 sql 命令 (基本查询, 写保护, 异步执行, 变量替换, 超时控制)
  - [ ] 9.3.3 测试 sql 命令短选项 (-e, -f, -N, -B)
  - [ ] 9.3.4 测试 workspace 命令 (list, use)
  - [ ] 9.3.5 测试 schema 命令 (list, create, drop, describe)
  - [ ] 9.3.6 测试 table 命令 (list, describe, preview, stats, history)
  - [ ] 9.3.7 测试安全护栏 (写保护, 危险操作拦截, 行数限制)
  - [ ] 9.3.8 测试错误自纠正 (列名错误, 表名错误)
  - [ ] 9.3.9 测试多格式输出 (JSON, Table, CSV, Text)
  - [ ] 9.3.10 测试全局参数 (--schema, --vcluster, --debug, --silent, --verbose)

## 10. 文档和 Skills

- [x] 10.1 创建 README.md
  - [x] 10.1.1 安装说明
  - [x] 10.1.2 快速开始 (profile 配置示例)
  - [x] 10.1.3 命令参考 (所有命令和参数)
  - [x] 10.1.4 配置说明 (profiles.toml 格式, JDBC URL 格式, 环境变量)
  - [x] 10.1.5 安全特性说明 (安全护栏, 敏感字段脱敏, 操作日志)
  - [x] 10.1.6 错误自纠正示例
  - [x] 10.1.7 更新所有命令示例从 clickzetta 到 cz-cli
- [x] 10.2 生成 AI Skills
  - [x] 10.2.1 创建 cz_cli/skills/cz-cli/SKILL.md (包含所有命令文档)
  - [x] 10.2.2 创建交互式安装器 cz_cli/commands/skills_installer.py
  - [x] 10.2.3 添加 install-skills 命令到 main.py
  - [x] 10.2.4 配置 pyproject.toml 包含 skills 目录
  - [x] 10.2.5 创建 MANIFEST.in 确保 skills 打包
  - [x] 10.2.6 添加 questionary 依赖
  - [x] 10.2.7 支持 8 种 AI 编码工具 (Claude Code, OpenClaw, Cursor, 等)
- [x] 10.3 创建 CHANGELOG.md
  - [x] 10.3.1 添加重命名变更说明 (clickzetta-cli → cz-cli)
  - [x] 10.3.2 添加 count 字段功能说明

## 11. 发布准备

- [x] 11.1 验证所有测试通过 (27/27 tests passing)
- [x] 11.2 验证 pyproject.toml 配置正确
- [x] 11.3 构建包 (python -m build)
- [x] 11.4 本地安装测试 (pip install -e .)
- [x] 11.5 验证命令行入口 (cz-cli --help, cz-cli --version)
- [x] 11.6 验证旧命令已移除 (clickzetta 命令不存在)
- [x] 11.7 清理构建产物
