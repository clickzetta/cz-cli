## 简介

在数据工程和 AI 驱动的自动化时代，Model Context Protocol（MCP）正在改变我们与数据平台交互的方式。云器 MCP-Server 作为一个强大的集成方案，让 AI Agent 能够直接操作数据湖仓、创建任务、管理调度，实现真正的"对话式数据工程"。

本文将深入解析 云器Lakehouse MCP-Server 的架构设计、核心能力，并提供详尽的实战指南，帮助数据工程师和 AI 开发者快速上手这一创新工具。

## 一、什么是 MCP Server？

### 1.1 MCP 协议简介

Model Context Protocol（MCP）是 Anthropic 推出的开放协议，旨在标准化 AI 模型与外部工具、数据源之间的交互方式。通过 MCP，AI Agent 可以：

* **访问外部数据源**：数据库、API、文件系统等
* **执行操作**：创建任务、运行查询、管理资源
* **获取上下文**：理解业务逻辑、表结构、依赖关系

### 1.2 云器 Lakehouse MCP-Server 的定位

云器Lakehouse MCP-Server 是专为云器Lakehouse数据平台设计的 MCP服务。 接入该服务后，您可以直接在第三方AI Agent内通过输入自然语言的方式，直接操作产品功能，而无需关注过多的产品操作细节。

目前该服务提供了**40+ 专业工具**：覆盖 SQL 查询、任务创建、运维管理、数据质量多个场景。

## 二、快速开始：配置你的第一个 MCP Server

### 2.1 环境准备

**推荐工具**：

* **Claude Desktop**：原生支持 MCP
* **Cherry Studio**：开源 AI 客户端，支持 MCP 配置

**前置要求**：

* 云器lakehouse 账号及 Personal Access Token（PAT）
* 目标工作空间（Workspace）和项目（Project）的访问权限
* Node.js 环境（用于运行 `mcp-remote`）

### 2.2 Claude Desktop 配置详解

#### 步骤 1：定位配置文件

在 Claude Desktop 的 Settings 中找到 **Local MCP servers** 配置入口，点击 **Edit Config** 打开 `claude_desktop_config.json` 文件。

配置文件路径通常为：

* **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
* **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

#### 步骤 2：配置MCP

* 在产品内，点击左下角个人信息「Lakehouse MCP」
* 在下图页面中生成个人的token，并配置该token对应的连接环境信息。

注意：使用该token时具备此用户身份的全部权限。因此请妥善保管token，避免泄露造成安全风险。


![](/.topwrite/assets/image_1766485071003.png)

^

* 生成token后，在右侧的连接配置可看到mcp的配置json，复制后粘贴至`claude_desktop_config.json文件中。`

```SQL
{  "clickzetta-http": {   
 "command": "npx",   
 "args":  [     
 "-y", "mcp-remote",   
   "https://cn-shanghai-alicloud-mcp.clickzetta.com/mcp",   
   "--allow-http",  
    "--transport", "http",    
  "--header", "x-Lakehouse-Token: Bearer <your_token>"    ]  }}
```

### 2.3 Cherry Studio 配置

如果使用 Cherry Studio：

1. 打开 **设置** → **MCP** → 点击 **添加服务器**

2. 配置如下：

   1. **名称**：`Clickzetta MCP`
   2. **类型**：`可流式传输的 HTTP (streamableHttp)`
   3. **URL**：`https://cn-shanghai-alicloud-mcp.clickzetta.com/mcp`
   4. **请求头**（每行一个）：

```Plain
 x-Lakehouse-Token=Bearer <your_pat>
x-Lakehouse-Region= cn-shanghai-alicloud
```

### 2.4 验证配置

重启 Claude Desktop 或 Cherry Studio，在对话框中输入：

```Plain
列出当前工作空间中的所有文件夹
```

如果返回文件夹列表，说明配置成功！

## 三、工具列表介绍

### 一、查询工具

| 工具名称                     | 功能描述                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| LH-execute\_read\_query  | 执行只读SQL查询并返回结果，支持自动结果限制。支持SELECT、DESCRIBE/DESC、SHOW、EXPLAIN等语句。适合临时查询、数据探索、快速验证等场景                            |
| LH-execute\_write\_query | 执行写操作SQL语句（INSERT/UPDATE/DELETE/CREATE/DROP等）。支持数据修改、对象创建删除、权限管理等操作。写操作不可逆，需谨慎使用                              |
| LH-show\_object\_list    | 列出Lakehouse数据库对象，无需构造SQL，避免SQL方言问题。支持智能过滤、统计分析和过滤建议。可列出WORKSPACES、TABLES、VIEWS、SCHEMAS、FUNCTIONS、VCLUSTERS等对象 |

### 二、Studio任务管理工具

| 工具名称                                  | 功能描述                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| create\_task                          | 在Clickzetta Studio项目中创建新任务，支持SQL、Shell、Python、数据集成、Notebook等多种任务类型，返回可直接打开任务的studio\_url链接 |
| get\_task\_detail                     | 获取任务的详细信息，包括任务名称、类型、所有者、描述、内容、版本和配置等元数据，返回studio\_url供用户打开                                 |
| list\_clickzetta\_tasks               | 列出任务列表，支持按文件夹、名称、类型筛选。返回草稿任务、已提交任务等所有状态的任务                                                 |
| save\_non\_integration\_task\_content | 保存非数据集成任务的内容（SQL脚本、Shell脚本、Python代码等），支持参数化配置，返回studio\_url                                |
| save\_integration\_task               | 保存完整的数据集成任务配置，自动处理表检查、元数据获取、自动建表等流程，返回studio\_url                                          |
| get\_file\_configuration\_detail      | 获取任务的配置详情，返回完整配置信息和可用于save\_task\_configuration的输入参数块                                      |
| save\_task\_configuration             | 保存任务的调度配置，包括Cron表达式、重试策略、有效期、依赖关系等。对集成任务会自动检查Sync VCluster                                 |
| publish\_task                         | 将任务发布到调度器，使其可以按计划执行。发布前必须保存任务内容和配置。需用户确认后才执行                                               |
| execute\_task                         | 异步执行数据任务，支持数据集成和Lakehouse SQL任务。自动解析任务内容、处理变量、选择VC、提交执行并轮询状态                               |

### 三、任务运行与监控工具

| 工具名称                        | 功能描述                                                            |
| --------------------------- | --------------------------------------------------------------- |
| list\_task\_run             | 列出符合条件的任务运行记录（支持分页）。支持按项目、任务类型、任务名、运行类型、计划时间、状态等筛选              |
| get\_task\_run\_stats       | 获取任务运行统计信息（按任务聚合）。支持按项目、任务类型、运行类型、时间范围、状态等筛选。适合回答"执行情况如何"等统计类问题 |
| list\_executions            | 列出特定任务运行下的执行记录（支持分页）。每个任务运行可能有多次执行                              |
| get\_execution\_log         | 获取特定执行的日志内容，支持从头部、尾部或指定偏移位置查询日志                                 |
| get\_task\_instance\_detail | 获取任务实例的执行状态和详细信息，包括状态、时间、错误信息等，用于调试和状态检查                        |

### 四、任务依赖与统计工具

| 工具名称                               | 功能描述                                                  |
| ---------------------------------- | ----------------------------------------------------- |
| get\_published\_task\_dependencies | 获取已发布任务的上下游依赖关系树，支持配置上游和下游的层级深度                       |
| get\_task\_run\_dependencies       | 获取任务运行实例的上下游依赖关系树，支持配置上游和下游的层级深度                      |
| get\_task\_statistics              | 获取按任务聚合的统计信息，支持按项目、任务类型、编辑状态、所有者等筛选。适合回答"有多少任务"等统计类问题 |

### 五、数据源与元数据工具

| 工具名称                    | 功能描述                                                                            |
| ----------------------- | ------------------------------------------------------------------------------- |
| list\_data\_sources     | 列出项目中所有可用的数据源配置，包括MySQL、PostgreSQL、Kafka、Hive、ClickHouse等。支持按名称和类型筛选，强烈建议使用过滤参数 |
| list\_namespaces        | 列出指定数据源中的命名空间（Schema/Database）列表，支持模糊匹配过滤                                       |
| list\_metadata\_objects | 列出指定命名空间中的数据对象（表/视图/集合），支持模糊匹配过滤                                                |
| get\_metadata\_detail   | 获取指定数据对象的详细元数据信息，包括列名、数据类型、约束等                                                  |

### 六、文件夹管理工具

| 工具名称           | 功能描述                                       |
| -------------- | ------------------------------------------ |
| create\_folder | 在指定父文件夹下创建新文件夹，用于组织任务结构                    |
| list\_folders  | 列出文件夹，支持按父文件夹、名称、类型筛选和分页。需递归查询所有层级才能发现全部任务 |

### 七、补数据管理工具

| 工具名称                        | 功能描述                                             |
| --------------------------- | ------------------------------------------------ |
| list\_backfill\_tasks       | 列出补数据（complement）任务，支持按项目、时间范围、状态、提交者、任务名筛选，支持分页 |
| get\_backfill\_task\_detail | 获取补数据任务的完整元数据和配置信息                               |
| list\_backfill\_instances   | 列出特定补数据任务下的实例列表，支持按状态和任务名筛选，支持分页                 |

### 八、数据质量检查工具

| 工具名称              | 功能描述                                                           |
| ----------------- | -------------------------------------------------------------- |
| create\_dqc\_rule | 创建并可选执行数据质量检查规则。支持内置指标（行数、空值、均值等）和自定义SQL。支持手动触发、定时调度、任务关联等触发方式 |

### 九、CDC实时同步工具

|                           |                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| 工具名称                      | 功能描述                                                                                      |
| save\_cdc\_realtime\_task | 保存多表实时CDC（变更数据捕获）任务配置。支持MySQL、PostgreSQL、SQL Server等源到Lakehouse/Kafka的实时同步，自动建表，支持全量+增量模式 |

### 十、语义视图工具

| 工具名称                         | 功能描述                                                        |
| ---------------------------- | ----------------------------------------------------------- |
| LH-desc-logical-table        | 获取语义视图中逻辑表的定义，包括关联的物理表和维度信息                                 |
| LH-desc-semantic-view        | 返回语义视图的YAML格式定义（Snowflake Cortex Analyst格式）                 |
| LH-create-semantic-view      | 从YAML定义创建语义视图（Snowflake Cortex Analyst格式），支持IF NOT EXISTS选项 |
| LH-brief-semantic-view       | 以简洁格式描述语义视图的字段信息                                            |
| LH-semantic-view-dim-add     | 向语义视图添加维度字段                                                 |
| LH-semantic-view-dim-del     | 从语义视图删除维度字段                                                 |
| LH-get\_semantic\_view\_dims | 获取语义视图的所有维度信息                                               |
| LH-query-semantic-value      | 基于自然语言查询语义视图数据，通过指定维度、指标和过滤条件来获取数据                          |

### 十一、知识库与技能工具

| 工具名称                    | 功能描述                                                  |
| ----------------------- | ----------------------------------------------------- |
| find\_helpful\_skills   | 【最高优先级】搜索远程技能库，返回排序的候选技能及分步指导。处理任何请求时必须首先调用此工具        |
| read\_skill\_document   | 读取技能中的特定文档（脚本、参考、示例）。不带路径调用时列出所有可用文件                  |
| list\_skills            | 列出知识库中所有可用的Clickzetta公司技能，用于探索或验证已加载的技能               |
| get\_product\_knowledge | 搜索Clickzetta产品文档（Lakehouse和Studio规范知识库），用于获取技术文档和产品知识 |
| put\_knowledge          | 向知识库存入文本知识条目并创建索引，支持向量和标量索引                           |
| search\_knowledge       | 从知识库搜索文本知识条目（仅限手动输入和标注的知识，包括成功案例和反馈）                  |

^

### Q\&A

#### 1. Claude Desktop 提示找不到 npx / Failed to spawn process

Q1：Claude Desktop 配好 MCP Server 后连不上，日志里出现 `Failed to spawn process: No such file or directory`

**A**：这通常表示 Claude Desktop 在启动本地 MCP 连接时，需要执行你配置里的 `command`（常见是 `npx`），但在 Claude Desktop 的运行环境里找不到该可执行文件（或无法在 PATH 中定位）。
在本文的 HTTP(streamable) 示例中，`command` 默认是 `npx`，而 `mcp-remote` 依赖 Node.js/npm 环境。

**修复方式为**：

**在macOS系统中**：

**1）确认本机是否安装了 Node.js（含 npx**）
打开 Terminal 执行：

* `node -v`
* `npx -v`
* `which npx`

若 `npx -v` 报错或 `which npx` 无输出，说明 Node.js/npm 未安装或不可用。

**2）安装 Node.js（推荐让 GUI 应用也能找到 npx**）

* \*\*推荐方式：\*\*使用 Homebrew 安装 Node.js（npx 路径更稳定、GUI 应用更容易识别）。

  * 若提示 `brew: command not found`，先安装 Homebrew，再 `brew install node`。

* \*\*替代方式：\*\*使用 Node.js 官方 macOS Installer 安装（同样可用）。

**3）处理 GUI App 的 PATH 和 Terminal 不一致**
即使 Terminal 里 `npx` 正常，Claude Desktop 仍可能找不到。此时建议：

* 在 `claude_desktop_config.json` 里把 `"command": "npx"` 改为 **npx 的绝对路径**（以 `which npx` 输出为准），例如：

  * Apple Silicon 常见：`/opt/homebrew/bin/npx`
  * Intel 常见：`/usr/local/bin/npx`

**4）重启 Claude Desktop 再验证**

****

**在windows系统中**：

**1）确认 Node.js 是否安装并已加入 PATH**
打开 PowerShell 或 CMD，执行：

* `node -v`
* `npx -v`
* `where npx`

若找不到，安装 Node.js（建议 LTS），安装时勾选 **Add to PATH**（或安装后手动把 Node 安装目录加入系统 PATH）。

**2）如果 Claude Desktop 仍找不到 npx：用绝对路径指定命令**
在 `claude_desktop_config.json` 中把 `"command": "npx"` 改为 `npx.cmd` 的绝对路径（以 `where npx` 输出为准），例如常见路径类似：

* `C:\Program Files\nodejs\npx.cmd`

**3）重启 Claude Desktop 再验证**

^
