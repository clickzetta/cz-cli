# LangChain 框架简介

LangChain 是一款开源的框架，旨在帮助开发人员构建基于大型语言模型（LLM）的应用程序。它通过以下几个核心优势，让开发过程变得更加高效和便捷：

1. 数据源集成：LangChain 可以无缝地将 LLM 与实时数据库、API 等多源数据进行整合，确保生成的内容既准确又具有上下文性。
2. 组件化流程设计：通过灵活配置任务链，将预处理、模型调用和后处理步骤清晰地串联起来，提高执行效率。
3. 简化大模型访问：提供简洁的接口，降低使用 LLM 进行技术开发的门槛，快速实现复杂的 NLP 功能。
4. 高度扩展定制：具备良好的可扩展性，能够满足不同业务场景的需求，帮助开发者充分发挥 LLM 的潜力。

# 基本开发流程

本节将通过一个示例，展示如何结合使用 LangChain 和 clickzetta-sqlalchemy 来实现一个简单的查询 Lakehouse 并展示结果的应用。

## 环境准备

要使用 LangChain 与不同的数据源进行对接，您需要在 Python 环境中安装 `clickzetta-sqlalchemy`。安装方法如下：

```shell
pip install langchain clickzetta-sqlalchemy
```

## 示例代码

首先，创建一个名为 `demo.py` 的文件，并编辑代码如下：

```python
from langchain_community.utilities import SQLDatabase
import streamlit as st

# 从 Streamlit 密钥管理器获取 Lakehouse 认证信息
username = st.secrets.lakehouse.username
password = st.secrets.lakehouse.password
account = st.secrets.lakehouse.account
endpoint = st.secrets.lakehouse.endpoint
workspace = st.secrets.lakehouse.workspace
schema = st.secrets.lakehouse.schema
virtualcluster = st.secrets.lakehouse.virtualcluster

# 创建连接字符串
CONNECTION_STRING = (
    f"clickzetta://{username}:{password}"
    f"@{account}.{endpoint}/{workspace}?schema={schema}&virtualcluster={virtualcluster}"
)

# 从连接字符串创建 SQLDatabase 实例
db = SQLDatabase.from_uri(CONNECTION_STRING, schema=schema)
```

接下来，执行查询并返回查询结果：

```python
# 执行查询
result = db.run("SELECT * FROM Artist LIMIT 12;", fetch="cursor")
# 打印结果类型
print(type(result))
# 展示查询结果
pprint(list(result.mappings()))
```

为了绑定查询参数，请使用可选`parameters` 参数。

```
result = db.run("SELECT * FROM Artist WHERE Name LIKE :search;",parameters={"search": "p%"},fetch="cursor",)
pprint(list(result.mappings()))
```

## 参考

[langchain 官方文档](https://python.langchain.com/docs/get_started/introduction)

[SQLDatabase开发指导](https://python.langchain.com/docs/integrations/tools/sql_database)
