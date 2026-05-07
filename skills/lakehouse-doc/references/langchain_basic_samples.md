# 基础示例

本文档提供 LangChain ClickZetta 集成的基础使用示例，适合初学者快速上手。

## 📚 目录

- [数据库连接](#数据库连接)
- [SQL查询](#sql查询)
- [向量存储](#向量存储)
- [全文搜索](#全文搜索)
- [键值存储](#键值存储)
- [聊天历史](#聊天历史)

## 🔌 数据库连接

### 基本连接

```python
from langchain_clickzetta import ClickZettaEngine

# 创建数据库引擎
engine = ClickZettaEngine(
    service="your-service",
    instance="your-instance",
    workspace="your-workspace",
    schema="your-schema",
    username="your-username",
    password="your-password",
    vcluster="your-vcluster"
)

# 测试连接
try:
    results, columns = engine.execute_query("SELECT 1 as test")
    print("✅ 连接成功")
except Exception as e:
    print(f"❌ 连接失败: {e}")
```

### 使用环境变量

```python
import os
from langchain_clickzetta import ClickZettaEngine

# 从环境变量读取配置
engine = ClickZettaEngine(
    service=os.getenv("CLICKZETTA_SERVICE"),
    instance=os.getenv("CLICKZETTA_INSTANCE"),
    workspace=os.getenv("CLICKZETTA_WORKSPACE"),
    schema=os.getenv("CLICKZETTA_SCHEMA"),
    username=os.getenv("CLICKZETTA_USERNAME"),
    password=os.getenv("CLICKZETTA_PASSWORD"),
    vcluster=os.getenv("CLICKZETTA_VCLUSTER")
)
```

### 带超时配置的连接

```python
engine = ClickZettaEngine(
    service="your-service",
    instance="your-instance",
    workspace="your-workspace",
    schema="your-schema",
    username="your-username",
    password="your-password",
    vcluster="your-vcluster",
    connection_timeout=60,      # 连接超时60秒
    query_timeout=1800,         # 查询超时30分钟
    hints={
        "sdk.job.timeout": 3600,  # 作业超时1小时
        "query_tag": "langchain_demo"
    }
)
```

## 📊 SQL查询

### 基本查询

```python
# 简单查询
results, columns = engine.execute_query("SELECT COUNT(*) as total FROM users")
print(f"用户总数: {results[0]['total']}")

# 查看所有表
tables = engine.get_table_names()
print(f"数据库中的表: {tables}")

# 获取表结构信息
table_info = engine.get_table_info(table_names=["users"])
print(f"表结构:\n{table_info}")
```

### 自然语言SQL查询

```python
from langchain_clickzetta import ClickZettaSQLChain
from langchain_community.llms import Tongyi

# 初始化大语言模型
llm = Tongyi(
    dashscope_api_key="your-dashscope-api-key",
    model_name="qwen-plus"
)

# 创建SQL链
sql_chain = ClickZettaSQLChain.from_engine(
    engine=engine,
    llm=llm,
    return_sql=True
)

# 自然语言查询
questions = [
    "数据库中有多少张表？",
    "用户表中有多少条记录？",
    "按年龄分组统计用户数量"
]

for question in questions:
    try:
        result = sql_chain.invoke({"query": question})
        print(f"问题: {question}")
        print(f"SQL: {result['sql_query']}")
        print(f"答案: {result['result']}")
        print("---")
    except Exception as e:
        print(f"查询失败: {e}")
```

### 参数化查询

```python
# 参数化查询避免SQL注入
def get_users_by_age(min_age: int):
    sql = "SELECT name, age FROM users WHERE age >= ?"
    results, columns = engine.execute_query(sql, parameters={"age": min_age})
    return results

# 使用示例
adult_users = get_users_by_age(18)
print(f"成年用户: {len(adult_users)}")
```

## 🔍 向量存储

### 基本向量存储

```python
from langchain_clickzetta import ClickZettaVectorStore
from langchain_community.embeddings import DashScopeEmbeddings
from langchain_core.documents import Document

# 初始化嵌入模型
embeddings = DashScopeEmbeddings(
    dashscope_api_key="your-dashscope-api-key",
    model="text-embedding-v4"
)

# 创建向量存储
vector_store = ClickZettaVectorStore(
    engine=engine,
    embeddings=embeddings,
    table_name="example_vectors"
)

# 添加文档
documents = [
    Document(page_content="ClickZetta是高性能分析数据库"),
    Document(page_content="LangChain是AI应用开发框架"),
    Document(page_content="向量搜索实现语义检索")
]

vector_store.add_documents(documents)
print("✅ 文档已添加到向量存储")
```

### 相似性搜索

```python
# 基本相似性搜索
query = "什么是数据库？"
results = vector_store.similarity_search(query, k=3)

print(f"查询: {query}")
for i, doc in enumerate(results, 1):
    print(f"{i}. {doc.page_content}")
```

### 带分数的相似性搜索

```python
# 获取相似性分数
results_with_scores = vector_store.similarity_search_with_score(query, k=3)

print(f"查询: {query}")
for i, (doc, score) in enumerate(results_with_scores, 1):
    print(f"{i}. 分数: {score:.4f} - {doc.page_content}")
```

### 带元数据过滤的搜索

```python
# 添加带元数据的文档
documents_with_metadata = [
    Document(
        page_content="Python是一种编程语言",
        metadata={"category": "programming", "level": "beginner"}
    ),
    Document(
        page_content="机器学习是AI的一个分支",
        metadata={"category": "ai", "level": "intermediate"}
    )
]

vector_store.add_documents(documents_with_metadata)

# 带过滤条件的搜索
results = vector_store.similarity_search(
    "编程相关",
    k=5,
    filter={"category": "programming"}
)

print("编程相关文档:")
for doc in results:
    print(f"- {doc.page_content}")
```

## 🔍 全文搜索

```python
from langchain_clickzetta.retrievers import ClickZettaFullTextRetriever

# 创建全文检索器
fulltext_retriever = ClickZettaFullTextRetriever(
    engine=engine,
    table_name="example_documents",
    search_type="phrase",  # 短语搜索
    k=5
)

# 添加文档到全文索引
documents = [
    Document(page_content="人工智能技术正在快速发展"),
    Document(page_content="大数据分析在商业中的应用"),
    Document(page_content="云计算提供了可扩展的基础设施")
]

fulltext_retriever.add_documents(documents)

# 执行全文搜索
query = "人工智能"
results = fulltext_retriever.get_relevant_documents(query)

print(f"全文搜索结果: {query}")
for doc in results:
    print(f"- {doc.page_content}")
    if "relevance_score" in doc.metadata:
        print(f"  相关性分数: {doc.metadata['relevance_score']}")
```

## 💾 键值存储

### 基本键值操作

```python
from langchain_clickzetta import ClickZettaStore

# 创建键值存储
store = ClickZettaStore(
    engine=engine,
    table_name="example_store"
)

# 存储数据
data = [
    ("user:123", b"张三"),
    ("user:456", b"李四"),
    ("config:theme", b"dark"),
    ("config:language", b"zh-CN")
]

store.mset(data)
print("✅ 数据已存储")

# 检索数据
keys = ["user:123", "user:456", "config:theme"]
values = store.mget(keys)

for key, value in zip(keys, values):
    if value:
        print(f"{key}: {value.decode('utf-8')}")
```

### 前缀搜索

```python
# 获取所有用户相关的键
user_keys = list(store.yield_keys(prefix="user:"))
print(f"用户键: {user_keys}")

# 获取所有配置相关的键
config_keys = list(store.yield_keys(prefix="config:"))
print(f"配置键: {config_keys}")
```

### 删除操作

```python
# 删除指定键
store.mdelete(["user:456", "config:theme"])
print("✅ 指定键已删除")

# 验证删除结果
remaining_values = store.mget(["user:123", "user:456", "config:language"])
for key, value in zip(["user:123", "user:456", "config:language"], remaining_values):
    status = "存在" if value else "已删除"
    print(f"{key}: {status}")
```

## 💬 聊天历史

### 基本聊天历史管理

```python
from langchain_clickzetta import ClickZettaChatMessageHistory
from langchain_core.messages import HumanMessage, AIMessage

# 创建聊天历史管理器
chat_history = ClickZettaChatMessageHistory(
    engine=engine,
    session_id="user_123",
    table_name="example_chat_history"
)

# 添加对话消息
chat_history.add_message(HumanMessage(content="你好"))
chat_history.add_message(AIMessage(content="您好！有什么可以帮助您的吗？"))
chat_history.add_message(HumanMessage(content="介绍一下ClickZetta"))
chat_history.add_message(AIMessage(content="ClickZetta是云器科技推出的新一代云原生湖仓一体化平台..."))

print("✅ 对话历史已保存")
```

### 检索对话历史

```python
# 获取所有消息
messages = chat_history.messages
print(f"对话历史 (共{len(messages)}条):")
for msg in messages:
    speaker = "用户" if msg.__class__.__name__ == "HumanMessage" else "AI"
    print(f"{speaker}: {msg.content}")
```

### 获取最近的对话

```python
# 获取最近3条消息
recent_messages = chat_history.get_messages_by_count(3)
print(f"最近的对话 (共{len(recent_messages)}条):")
for msg in recent_messages:
    speaker = "用户" if msg.__class__.__name__ == "HumanMessage" else "AI"
    print(f"{speaker}: {msg.content}")
```

### 按时间范围获取对话

```python
# 获取今天的对话
from datetime import datetime, timedelta

today = datetime.now().strftime("%Y-%m-%d 00:00:00")
tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d 00:00:00")

today_messages = chat_history.get_messages_by_time_range(
    start_time=today,
    end_time=tomorrow
)

print(f"今天的对话 (共{len(today_messages)}条):")
for msg in today_messages:
    speaker = "用户" if msg.__class__.__name__ == "HumanMessage" else "AI"
    print(f"{speaker}: {msg.content}")
```

### 清理对话历史

```python
# 获取对话统计
message_count = chat_history.get_session_count()
print(f"会话中共有 {message_count} 条消息")

# 清空当前会话的所有消息
chat_history.clear()
print("✅ 对话历史已清空")

# 验证清理结果
remaining_count = chat_history.get_session_count()
print(f"清理后剩余消息: {remaining_count} 条")
```

## 🔄 批量操作示例

### 批量添加文档

```python
def batch_add_documents(vector_store, document_texts, batch_size=10):
    """批量添加文档到向量存储"""
    documents = [Document(page_content=text) for text in document_texts]

    # 分批处理
    for i in range(0, len(documents), batch_size):
        batch = documents[i:i + batch_size]
        vector_store.add_documents(batch)
        print(f"已处理 {min(i + batch_size, len(documents))}/{len(documents)} 文档")

# 使用示例
sample_texts = [
    f"这是第{i}个示例文档，包含一些测试内容"
    for i in range(1, 51)  # 50个文档
]

batch_add_documents(vector_store, sample_texts, batch_size=10)
```

### 批量查询

```python
def batch_search(vector_store, queries, k=3):
    """批量执行搜索查询"""
    results = {}
    for query in queries:
        try:
            docs = vector_store.similarity_search(query, k=k)
            results[query] = [doc.page_content for doc in docs]
        except Exception as e:
            results[query] = f"查询失败: {e}"
    return results

# 使用示例
queries = [
    "什么是数据库？",
    "如何进行机器学习？",
    "云计算的优势是什么？"
]

search_results = batch_search(vector_store, queries)
for query, results in search_results.items():
    print(f"查询: {query}")
    if isinstance(results, list):
        for i, result in enumerate(results, 1):
            print(f"  {i}. {result[:50]}...")
    else:
        print(f"  {results}")
    print()
```

## 🛠️ 实用工具函数

### 连接测试工具

```python
def test_connection(engine):
    """测试数据库连接"""
    try:
        # 测试基本查询
        results, _ = engine.execute_query("SELECT CURRENT_TIMESTAMP as now")
        print(f"✅ 连接成功，当前时间: {results[0]['now']}")

        # 测试表访问
        tables = engine.get_table_names()
        print(f"✅ 可访问 {len(tables)} 张表")

        return True
    except Exception as e:
        print(f"❌ 连接测试失败: {e}")
        return False

# 使用示例
if test_connection(engine):
    print("数据库连接正常，可以继续操作")
else:
    print("请检查连接配置")
```

### 文档统计工具

```python
def get_document_stats(vector_store):
    """获取文档存储统计信息"""
    try:
        # 查询文档总数
        sql = f"SELECT COUNT(*) as total FROM {vector_store.table_name}"
        results, _ = vector_store.engine.execute_query(sql)
        total_docs = results[0]['total']

        # 查询最近添加的文档
        sql = f"""
        SELECT COUNT(*) as recent
        FROM {vector_store.table_name}
        WHERE created_at >= NOW() - INTERVAL 1 DAY
        """
        results, _ = vector_store.engine.execute_query(sql)
        recent_docs = results[0]['recent']

        return {
            "total_documents": total_docs,
            "recent_documents": recent_docs
        }
    except Exception as e:
        print(f"获取统计信息失败: {e}")
        return None

# 使用示例
stats = get_document_stats(vector_store)
if stats:
    print(f"文档总数: {stats['total_documents']}")
    print(f"最近24小时添加: {stats['recent_documents']}")
```

## 🎯 完整示例：迷你问答系统

```python
def create_mini_qa_system():
    """创建一个迷你问答系统"""

    # 1. 初始化组件
    engine = ClickZettaEngine(
        # 你的连接参数...
    )

    embeddings = DashScopeEmbeddings(
        dashscope_api_key="your-api-key",
        model="text-embedding-v4"
    )

    vector_store = ClickZettaVectorStore(
        engine=engine,
        embeddings=embeddings,
        table_name="mini_qa_docs"
    )

    # 2. 添加知识库文档
    knowledge_docs = [
        "Python是一种高级编程语言，语法简洁易学",
        "机器学习是人工智能的一个重要分支",
        "数据库用于存储和管理大量数据",
        "云计算提供了弹性和可扩展的计算资源"
    ]

    vector_store.add_documents([
        Document(page_content=text) for text in knowledge_docs
    ])

    # 3. 问答函数
    def ask_question(question: str):
        # 检索相关文档
        relevant_docs = vector_store.similarity_search(question, k=2)

        print(f"问题: {question}")
        print("相关信息:")
        for i, doc in enumerate(relevant_docs, 1):
            print(f"  {i}. {doc.page_content}")

    # 4. 测试问答
    test_questions = [
        "什么是Python？",
        "机器学习是什么？",
        "云计算有什么用？"
    ]

    for question in test_questions:
        ask_question(question)
        print()

# 运行迷你问答系统
create_mini_qa_system()
```

## 💡 最佳实践总结

1. **连接管理**
   - 复用 `ClickZettaEngine` 实例
   - 使用环境变量管理配置
   - 设置合适的超时时间

2. **向量存储**
   - 选择合适的嵌入模型
   - 使用有意义的表名
   - 添加元数据便于过滤

3. **性能优化**
   - 批量操作大量数据
   - 使用索引加速查询
   - 合理设置检索数量(k值)

4. **错误处理**
   - 使用try-catch处理异常
   - 记录错误日志
   - 提供用户友好的错误提示

这些基础示例为您提供了使用 LangChain ClickZetta 的起点。您可以基于这些示例构建更复杂的AI应用。