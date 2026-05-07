# 安装和使用指南

## 概述

本指南将帮助您从零开始配置和使用 Datus Agent 连接云器 Lakehouse，实现自然语言查询和智能数据分析。通过逐步的配置过程，您将能够：

* 建立Datus与云器Lakehouse的连接
* 配置多种AI模型支持
* 启用MCP工具集成（可选）
* 开始使用自然语言进行数据查询和分析

## 环境要求

* **Python 版本**: 3.12 或更高
* **Datus**: 0.2.23 或更高
* **操作系统**: macOS、Linux 或 Windows
* **云器 Lakehouse 访问权限**: 包括服务端点、用户凭据等
* **网络要求**: 能够访问云器 Lakehouse API 端点

## 第一步：创建项目目录

```bash
# 创建项目目录
mkdir my-lakehouse-datus
cd my-lakehouse-datus
```

## 第二步：创建Python虚拟环境

选择以下三种方式之一创建虚拟环境：

### 方式一：使用 conda（推荐）

```bash
conda create -n lakehouse-env python=3.12
conda activate lakehouse-env
```

### 方式二：使用 virtualenv

```bash
python3.12 -m venv lakehouse-env
source lakehouse-env/bin/activate  # Linux/macOS
# 或者
lakehouse-env\Scripts\activate  # Windows
```

### 方式三：使用 uv（现代化工具）

```bash
uv venv --python 3.12 lakehouse-env
source lakehouse-env/bin/activate  # Linux/macOS
```

## 第三步：安装Datus Agent包

```bash
# 安装Datus Agent
pip install datus-agent
# 云器Lakehouse的Datus插件
pip install datus-clickzetta
```

如果需要Datus Agent最新的开发版本：

```bash
pip install git+https://github.com/Datus-ai/Datus-agent.git
```

## 第四步：配置环境变量

创建 `.env` 文件来存储敏感信息：

```bash
# 创建环境变量配置文件
touch .env
```

在 `.env` 文件中添加以下配置（请根据您的实际情况修改）：

```env
# 云器Lakehouse连接配置
CLICKZETTA_SERVICE=cn-shanghai-alicloud.api.clickzetta.com
CLICKZETTA_USERNAME=your_username
CLICKZETTA_PASSWORD=your_password
CLICKZETTA_INSTANCE=your_instance_id
CLICKZETTA_WORKSPACE=quick_start
CLICKZETTA_SCHEMA=mcp_demo
CLICKZETTA_VCLUSTER=default_ap

# AI模型配置（选择其中一种）
# 阿里云通义千问（推荐）
DASHSCOPE_API_KEY=your_dashscope_api_key

# 或者 DeepSeek
DEEPSEEK_API_KEY=your_deepseek_api_key

# 或者 OpenAI
OPENAI_API_KEY=your_openai_api_key

# 或者 Claude
ANTHROPIC_API_KEY=your_claude_api_key
```

## 第五步：配置Datus Agent

创建配置目录和 `agent.yml` 配置文件：

```bash
mkdir -p conf
touch conf/agent.yml
```

将以下内容复制到 `conf/agent.yml` 文件中：

```yaml
agent:
  target: qwen_main  # 使用通义千问作为主要模型
  home: .datus

  # 模型配置
  models:
    qwen_main:
      type: qwen
      vendor: aliyun
      base_url: https://dashscope.aliyuncs.com/compatible-mode/v1
      api_key: ${DASHSCOPE_API_KEY}
      model: qwen-plus
      enable_thinking: false

    qwen_reasoning:
      type: qwen
      vendor: aliyun
      base_url: https://dashscope.aliyuncs.com/compatible-mode/v1
      api_key: ${DASHSCOPE_API_KEY}
      model: qwen3-max
      enable_thinking: true

    # 备选模型配置
    deepseek_chat:
      type: deepseek
      vendor: deepseek
      base_url: https://api.deepseek.com
      api_key: ${DEEPSEEK_API_KEY}
      model: deepseek-chat

  # 智能节点配置
  agentic_nodes:
    lakehouse_assistant:
      node_type: gensql
      model: qwen_main
      system_prompt: gen_sql
      prompt_version: '1.0'
      prompt_language: zh  # 支持中文
      max_turns: 15
      tools: db_tools.*, context_search_tools.*
      agent_description: 云器Lakehouse智能助手，支持自然语言查询和数据分析
      rules:
      - 优先使用中文回复用户
      - 详细解释SQL查询逻辑
      - 提供可执行的SQL语句
      - 专注于云器Lakehouse环境内的数据对象

  # 数据库连接配置
  namespace:
    lakehouse:
      type: clickzetta
      service: ${CLICKZETTA_SERVICE}
      username: ${CLICKZETTA_USERNAME}
      password: ${CLICKZETTA_PASSWORD}
      instance: ${CLICKZETTA_INSTANCE}
      workspace: ${CLICKZETTA_WORKSPACE}
      schema: ${CLICKZETTA_SCHEMA}
      vcluster: ${CLICKZETTA_VCLUSTER}
      secure: false

  # 存储配置
  storage:
    embedding_device_type: cpu
    document:
      registry_name: sentence-transformers
      model_name: all-MiniLM-L6-v2  # 轻量级嵌入模型
      dim_size: 384
      batch_size: 64

  # 工作流配置
  workflow:
    plan: reflection
    chat_default_node: lakehouse_assistant

# 模式链接匹配率（影响查询性能）
schema_linking_rate: medium
```

## 第六步：测试连接

在启动完整系统之前，测试数据库连接：

```bash
python -c "
from datus.tools.db_tools.db_manager import DBManager
from datus.configuration.agent_config import DbConfig
import os
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

# 创建数据库配置
db_config = DbConfig(
    type='clickzetta',
    service=os.getenv('CLICKZETTA_SERVICE'),
    username=os.getenv('CLICKZETTA_USERNAME'),
    password=os.getenv('CLICKZETTA_PASSWORD'),
    instance=os.getenv('CLICKZETTA_INSTANCE'),
    workspace=os.getenv('CLICKZETTA_WORKSPACE'),
    schema=os.getenv('CLICKZETTA_SCHEMA'),
    vcluster=os.getenv('CLICKZETTA_VCLUSTER')
)

# 测试连接
namespaces = {'lakehouse': {'lakehouse': db_config}}
db_manager = DBManager(namespaces)

try:
    connector = db_manager.get_conn('lakehouse', 'lakehouse')
    result = connector.test_connection()
    print('✅ 云器Lakehouse连接测试成功！')
    print(f'连接结果: {result}')
except Exception as e:
    print(f'❌ 连接测试失败: {e}')
"
```

## 第七步：启动Datus

### 方式一：命令行模式

```bash
# 启动交互式CLI
datus-cli --namespace lakehouse --config conf/agent.yml
```

### 方式二：Web模式（推荐，支持subagent选择）

```bash
# 启动Web界面，支持选择不同的subagent
datus-cli --namespace lakehouse --config conf/agent.yml --web --host 0.0.0.0

# 或者只在本地访问
datus-cli --namespace lakehouse --config conf/agent.yml --web --host 127.0.0.1
```

**Web 模式启动后**：

* 默认访问地址：<http://localhost:8501> 或 <http://0.0.0.0:8501>
* 在Web界面中可以选择之前创建的subagent进行对话
* 支持更直观的交互界面

**启动成功后的界面**：

**CLI 模式**：

```
Initializing AI capabilities in background...

Datus - AI-powered SQL command-line interface
Type '.help' for a list of commands or '.exit' to quit.

Namespace lakehouse selected
Connected to lakehouse using database quick_start
Context: Current: database: quick_start
Type SQL statements or use ! @ . commands to interact.
Datus>
```

**Web模式**：

* 终端显示服务器启动信息和访问地址
* 浏览器打开对应地址即可看到Web界面
* Web界面左侧显示可选择的subagent列表
* 点击选择subagent后即可开始对话

## 第八步：开始使用（命令行方式）

![](/.topwrite/assets/image_1764226910096.png)

### 查看可用表

```sql
Datus> .tables
```

### 使用自然语言查询

```
Datus> / 显示所有用户表的统计信息
```

### 执行SQL查询

```sql
Datus> SELECT * FROM your_table LIMIT 10;
```

### 获取帮助

```
Datus> .help
```



### Web方式

![](/.topwrite/assets/image_1764227961202.png)

Web 方式启动页面如上。如果在命令行方式下增加了 SubAgent，则首页就会显示。
直接输入聊天内容则以 Agent 模式运行（不会调用 MCP Tools）。选择具体的 SubAgent 后则以 SubAgent 模式进行对话，会调用 MCP Tools。

![](/.topwrite/assets/image_1764228154353.png)

### 多模型配置

为不同任务使用不同模型：

```yaml
agentic_nodes:
  quick_query:
    model: qwen_main         # 快速查询使用基础模型
    # ... 其他配置

  complex_analysis:
    model: qwen_reasoning    # 复杂分析使用推理模型
    enable_thinking: true
    # ... 其他配置
```

## 常见问题

### Q: 连接云器Lakehouse失败

**A**：请检查：

1. 网络连接是否正常
2. `.env` 文件中的凭据是否正确
3. 云器 Lakehouse 服务是否可访问
4. 实例ID、工作空间等参数是否正确

### Q: AI模型响应缓慢

**A**：可以尝试：

1. 切换到更快的模型（如 `qwen-plus` → `qwen-turbo`）
2. 减少 `max_context_length` 等参数
3. 启用GPU加速（如果可用）

### Q: 查询结果不准确

**A**：建议：

1. 增加 `schema_linking_rate` 到 `slow` 以获得更精确的模式匹配
2. 在查询中提供更多上下文信息
3. 使用 `.schema tablename` 查看表结构后再查询

### Q: 如何切换不同的数据库实例

**A**：

1. 修改 `.env` 文件中的 `CLICKZETTA_*` 变量
2. 重新启动 `datus-cli`
3. 或者在配置中添加多个namespace配置

***

*本指南最后更新时间：2025年11月*