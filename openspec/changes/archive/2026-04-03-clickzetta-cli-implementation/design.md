## Context

ClickZetta Lakehouse 需要一个 AI-Agent 友好的 CLI 工具。当前没有官方 CLI，用户只能通过 Python SDK 或 JDBC 连接使用。

**当前状态**:
- 已有 clickzetta-connector Python SDK (v1.0.16+)
- 用户主要通过 Python 脚本或 Jupyter Notebook 使用 ClickZetta

**参考资源**:
- ClickZetta 文档知识库：/Users/zhanglin/IdeaProjects/lakehouse_doc
- 异步执行示例：/Users/zhanglin/IdeaProjects/clickzetta-java/clickzetta-connector-python/dbt_env/executeAsyncTest.py
- JDBC URL 解析参考：/Users/zhanglin/IdeaProjects/clickzetta-java/jdbc/src/main/java/com/clickzetta/client/jdbc/core/CZConnectContext.java

**约束**:
- 必须使用 clickzetta-connector SDK，不能直接使用 JDBC
- Python 3.11+ (为了使用内置 tomllib)
- 需要兼容 ClickZetta 的 SQL 方言和系统表

**利益相关者**:
- 终端用户：需要简单易用的命令行工具
- AI Agent：需要结构化的 JSON 输出和清晰的文档
- 开发团队：需要可维护的代码架构

## Goals / Non-Goals

**Goals:**
- AI 友好：默认 JSON 输出，错误自纠正，ai-guide 命令
- 安全可靠：内置安全护栏，敏感数据脱敏，操作日志
- 易于使用：支持多种认证方式，清晰的命令结构
- 可扩展：模块化设计，便于后续添加新功能

**Non-Goals:**
- 不实现交互式 SQL Shell (V1 不做)
- 不实现任务/工作流管理 (等待 Studio SDK)
- 不实现用户/角色管理 (V1 不做)
- 不实现实时数据摄取 (V2 功能)
- 不实现 Shell 补全 (bash/zsh) (V2 功能)

## Decisions

### Decision 1: 使用 Click 框架构建 CLI

**选择**: Click >= 8.0

**理由**:
- 成熟稳定，社区活跃
- 声明式 API，代码清晰
- 内置帮助生成、参数验证、类型转换

### Decision 2: Profile 配置使用 TOML 格式

**选择**: ~/.clickzetta/profiles.toml

**理由**:
- 人类可读，易于手动编辑
- Python 3.11+ 内置 tomllib 支持
- 结构化配置，支持多 profile

**替代方案**:
- JSON: 不支持注释，不够人性化
- YAML: 需要额外依赖 PyYAML
- INI: 功能有限，不支持嵌套

### Decision 4: 连接配置优先级

**选择**: CLI 参数 > JDBC URL > 环境变量 > Profile 配置

**理由**:
- CLI 参数最明确，优先级最高
- JDBC URL 适合一次性连接
- 环境变量适合 CI/CD 环境
- Profile 配置适合日常使用

### Decision 5: SQL 安全护栏实现

**选择**: 
- 行数限制：使用 `SET cz.sql.result.row.partial.limit=100`
- 写保护：正则匹配 SQL 类型
- 危险操作：正则检查 WHERE 子句

**理由**:
- CZ SDK 支持 SET 语句设置会话参数
- 正则匹配简单高效，覆盖 99% 场景
- 不需要完整的 SQL 解析器

**替代方案**:
- 使用 sqlparse 库：增加依赖，性能开销
- 完整 SQL 解析：过度设计，复杂度高

### Decision 6: 异步执行实现

**选择**: cursor.execute_async() + 自动轮询 (0.5秒间隔) + 进度显示

**参考实现**: /Users/zhanglin/IdeaProjects/clickzetta-java/clickzetta-connector-python/dbt_env/executeAsyncTest.py

**理由**:
- CZ SDK 原生支持异步执行
- 自动轮询对用户透明，无需手动查询状态
- 可以显示进度，提升用户体验
- 参考代码已经验证可行

**实现细节**:
```python
cursor.execute_async('SELECT * FROM large_table')
while not cursor.is_job_finished():
    print("查询进行中...")
    time.sleep(0.5)
result = cursor.fetchall()
```

### Decision 7: 错误自纠正实现

**选择**: 捕获特定错误模式，自动查询 schema 信息附加到错误响应

**理由**:
- 减少 AI Agent 的调用次数
- 提供即时的修复线索
- 实现简单，正则匹配错误消息

**错误类型**:
- 列名错误 → 执行 DESC TABLE 返回所有列
- 表名错误 → 执行 SHOW TABLES 返回所有表

## Risks / Trade-offs

### Risk 1: ClickZetta SQL 方言差异
**风险**: ClickZetta 的 SQL 语法可能与标准 SQL 有差异，导致某些功能不可用

**缓解**: 
- 参考 ClickZetta 文档适配 SQL 语句
- 使用 try-except 处理不支持的功能
- 在文档中明确标注 V1 限制

### Risk 2: clickzetta-connector SDK 稳定性
**风险**: SDK 可能有 bug 或不稳定，影响 CLI 可靠性

**缓解**:
- 使用 try-except 捕获所有 SDK 异常
- 记录详细日志便于排查问题
- 与 SDK 团队保持沟通

### Risk 3: Profile 配置文件安全性
**风险**: profiles.toml 明文存储密码，存在安全风险

**缓解**:
- 文档中提醒用户设置文件权限 (chmod 600)
- V2 考虑支持密钥管理集成
- 推荐使用环境变量在生产环境

### Risk 4: 正则匹配 SQL 的局限性
**风险**: 正则无法处理复杂 SQL，可能误判或漏判

**缓解**:
- 覆盖常见场景即可，不追求 100% 准确
- 用户可以通过 --write 绕过限制
- V2 考虑引入 sqlparse 库

### Trade-off 1: 功能完整性 vs 开发速度
**选择**: V1 只实现核心功能，部分高级功能延后到 V2

**理由**: 快速交付可用版本，根据用户反馈迭代

### Trade-off 2: 安全性 vs 易用性
**选择**: 默认开启安全护栏，但允许用户通过参数绕过

**理由**: 保护大多数用户，同时不限制高级用户

## Migration Plan

**部署步骤**:
1. 发布 PyPI 包: `pip install cz-cli`
2. 用户创建 profile: `clickzetta profile create ...`
3. 测试连接: `clickzetta sql "SELECT 1"`

**回滚策略**:
- 如果 CLI 有严重 bug，用户可以继续使用 Python SDK
- Profile 配置文件向后兼容，不影响已有配置

**兼容性**:
- 不影响现有 Python SDK 用户
- 不影响 JDBC 连接方式
- 独立的配置文件，不与其他工具冲突

### Decision 8: Workspace 管理实现

**选择**: 
- `workspace current`: 执行 `SELECT current_workspace()` 查询当前 workspace
- `workspace use <name>`: 通过 SDK hint `sdk.job.default.ns` 切换 workspace
- 不实现 `workspace list`

**理由**:
- ClickZetta 文档中没有 `SHOW WORKSPACES` SQL 命令
- 提供 `SELECT current_workspace()` 函数查询当前 workspace
- SDK 支持通过 `sdk.job.default.ns` hint 动态切换 workspace 和 schema
- Workspace 是通过 Web UI 管理的实例级资源

**实现方式**:
- `workspace current`: 执行 SQL `SELECT current_workspace()` 并返回结果
- `workspace use <name>`: 
  ```python
  # 通过 SDK hint 切换 workspace
  hints = {'sdk.job.default.ns': f'{workspace_name}.{schema_name}'}
  cursor.execute(sql, hints=hints)
  # 或者更新当前 profile 的 workspace 字段作为持久化配置
  ```
- 解析 `sdk.job.default.ns`: `workspace.schema` 格式，split('.')[0] 是 workspace，split('.')[1] 是 schema

### Decision 9: 全局参数 --output 实现

**选择**: 使用 `--output` 作为主参数，支持 `--format` 作为别名

**理由**:
- AGETNT.md 明确指定 `--output (text|json|csv)`
- 支持 `--format` 作为别名，方便用户迁移习惯
- `--output` 更符合 CLI 惯例（如 kubectl）

**实现方式**:
```python
@click.option('--output', '-o', type=click.Choice(['json', 'table', 'csv', 'text']), default='json')
@click.option('--format', '-f', 'output', type=click.Choice(['json', 'table', 'csv', 'text']))
```

### Decision 10: 批量模式参数实现

**选择**: 支持 -N (no-header) 和 -B (batch mode) 短选项

**理由**:
- AGETNT.md 明确要求支持短选项
- MySQL CLI 兼容性（-N, -B 是 MySQL 标准选项）
- 方便脚本处理输出

**实现方式**:
- `-N` / `--no-header`: 不显示列名
- `-B` / `--batch`: 批量模式，制表符分隔，等同于 `--output text -N`
- 在 output.py 中添加对应的格式化逻辑

## Open Questions

1. **异步执行的轮询间隔应该设置多少？**
   - 当前设置 0.5 秒（参考 executeAsyncTest.py）
   - 是否需要支持用户自定义？
   - **建议**: V1 固定 0.5 秒，V2 考虑 `--poll-interval` 参数

2. **是否需要支持多个 workspace 同时连接？**
   - V1 暂不支持
   - V2 考虑实现

3. **AI Skills 的格式和内容应该如何设计？**
   - 已完成：cz_cli/skills/cz-cli/SKILL.md 包含所有命令文档、安全特性、配置示例
   - 提供交互式安装器：`cz-cli install-skills`
