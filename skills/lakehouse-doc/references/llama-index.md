# LlamaIndex简介

LlamaIndex 是一个基于大型语言模型（LLM）的应用程序数据框架，专为利用上下文增强的应用程序设计。这种 LLM 系统被称为 RAG 系统，即“检索增强生成”。LlamaIndex 提供了必要的抽象，可以更轻松地摄取、构建和访问私有或特定领域的数据，以便将这些数据安全可靠地注入 LLM 中，以实现更准确的文本生成。

LlamaIndex 中数据摄取的关键在于加载和转换。加载文档后，您可以通过转换和输出节点来处理它们。LlamaIndex 通过 Database Reader 可以加载存储在云数据仓库 Lakehouse 中的数据。

## 示例代码

```
from llama_index.readers.database import DatabaseReader

import streamlit as st

username = st.secrets.lakehouse.username
password = st.secrets.lakehouse.password
account = st.secrets.lakehouse.account
endpoint = st.secrets.lakehouse.endpoint
workspace = st.secrets.lakehouse.workspace
schema = st.secrets.lakehouse.schema
virtualcluster = st.secrets.lakehouse.virtualcluster

CONNECTION_STRING = (
    f"clickzetta://{username}:{password}@"
    f"{account}.{endpoint}/{workspace}?schema={schema}&virtualcluster={virtualcluster}"
)

db = DatabaseReader(uri=CONNECTION_STRING, schema=schema)
```

## SQLDatabase可用方法

```
print(type(db.sql_database.from_uri))
print(type(db.sql_database.get_single_table_info))
print(type(db.sql_database.get_table_columns))
print(type(db.sql_database.get_usable_table_names))
print(type(db.sql_database.insert_into_table))
print(type(db.sql_database.run_sql))
```

```
query = f"""
    SELECT
        CONCAT(name, ' is ', age, ' years old.') AS text
    FROM public.users
    WHERE age >= 18
    """

documents = db.load_data(query=query)

index = VectorStoreIndex.from_documents(documents)

```

### 参考文档

[Llama-Index Database Reader](https://docs.llamaindex.ai/en/stable/examples/data_connectors/DatabaseReaderDemo.html)
