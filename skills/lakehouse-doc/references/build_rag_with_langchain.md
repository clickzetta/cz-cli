# 构建RAG应用完整指南

本教程将指导您使用 LangChain 和 ClickZetta 构建一个完整的检索增强生成（RAG）应用。我们将构建一个智能文档问答系统。

## 🎯 项目目标

构建一个企业级RAG应用，具备以下功能：
- 文档上传和向量化存储
- 智能文档检索
- 基于上下文的问答生成
- 聊天历史管理
- 混合搜索能力（向量+全文）

## 📋 技术栈

- **数据存储**: ClickZetta（向量存储、全文索引、聊天历史）
- **嵌入模型**: 灵积DashScope text-embedding-v4
- **大语言模型**: 通义千问 qwen-plus
- **框架**: LangChain + ClickZetta 集成

## 🏗️ 架构设计

```
用户查询 → 混合检索 → 上下文增强 → LLM生成 → 返回答案
    ↓           ↓            ↓          ↓
聊天历史 → 向量搜索+全文搜索 → 排序重组 → 历史记忆
```

## 🚀 第一步：环境准备

### 安装依赖

```bash
pip install langchain-clickzetta dashscope langchain-community
```

### 环境配置

```python
import os
from dotenv import load_dotenv

load_dotenv()

# ClickZetta配置
CLICKZETTA_CONFIG = {
    "service": os.getenv("CLICKZETTA_SERVICE"),
    "instance": os.getenv("CLICKZETTA_INSTANCE"),
    "workspace": os.getenv("CLICKZETTA_WORKSPACE"),
    "schema": os.getenv("CLICKZETTA_SCHEMA"),
    "username": os.getenv("CLICKZETTA_USERNAME"),
    "password": os.getenv("CLICKZETTA_PASSWORD"),
    "vcluster": os.getenv("CLICKZETTA_VCLUSTER"),
}

# 灵积配置
DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY")
```

## 📝 第二步：核心组件初始化

```python
from langchain_clickzetta import (
    ClickZettaEngine,
    ClickZettaHybridStore,
    ClickZettaUnifiedRetriever,
    ClickZettaChatMessageHistory
)
from langchain_community.embeddings import DashScopeEmbeddings
from langchain_community.llms import Tongyi
from langchain_core.documents import Document
from langchain.chains import RetrievalQA
from langchain.memory import ConversationBufferWindowMemory

class RAGApplication:
    def __init__(self, clickzetta_config: dict, dashscope_api_key: str):
        """初始化RAG应用"""

        # 初始化ClickZetta引擎
        self.engine = ClickZettaEngine(**clickzetta_config)

        # 初始化嵌入模型
        self.embeddings = DashScopeEmbeddings(
            dashscope_api_key=dashscope_api_key,
            model="text-embedding-v4"
        )

        # 初始化大语言模型
        self.llm = Tongyi(
            dashscope_api_key=dashscope_api_key,
            model_name="qwen-plus",
            temperature=0.1
        )

        # 初始化混合存储（文档库）
        self.document_store = ClickZettaHybridStore(
            engine=self.engine,
            embedding=self.embeddings,
            table_name="rag_documents",
            text_analyzer="ik",  # 中文分词
            distance_metric="cosine"
        )

        # 初始化检索器
        self.retriever = ClickZettaUnifiedRetriever(
            hybrid_store=self.document_store,
            search_type="hybrid",
            alpha=0.5,  # 向量搜索和全文搜索权重平衡
            k=5  # 返回top-5结果
        )

        print("✅ RAG应用初始化完成")

    def get_chat_history(self, session_id: str) -> ClickZettaChatMessageHistory:
        """获取聊天历史管理器"""
        return ClickZettaChatMessageHistory(
            engine=self.engine,
            session_id=session_id,
            table_name="rag_chat_history"
        )
```

## 📚 第三步：文档管理

```python
import hashlib
from typing import List
from pathlib import Path

class DocumentManager:
    def __init__(self, rag_app: RAGApplication):
        self.rag_app = rag_app

    def add_text_document(self, content: str, metadata: dict = None) -> str:
        """添加文本文档"""
        # 生成文档ID
        doc_id = hashlib.md5(content.encode()).hexdigest()

        # 创建文档对象
        document = Document(
            page_content=content,
            metadata={
                "doc_id": doc_id,
                "type": "text",
                **(metadata or {})
            }
        )

        # 添加到混合存储
        self.rag_app.document_store.add_documents([document])

        print(f"✅ 文档已添加，ID: {doc_id}")
        return doc_id

    def add_file_document(self, file_path: str, metadata: dict = None) -> str:
        """添加文件文档"""
        file_path = Path(file_path)

        # 读取文件内容
        if file_path.suffix.lower() == '.txt':
            content = file_path.read_text(encoding='utf-8')
        else:
            raise ValueError(f"不支持的文件格式: {file_path.suffix}")

        # 添加文件元数据
        file_metadata = {
            "filename": file_path.name,
            "file_path": str(file_path),
            "file_size": file_path.stat().st_size,
            **(metadata or {})
        }

        return self.add_text_document(content, file_metadata)

    def add_batch_documents(self, documents: List[dict]) -> List[str]:
        """批量添加文档"""
        doc_ids = []

        for doc_data in documents:
            content = doc_data["content"]
            metadata = doc_data.get("metadata", {})
            doc_id = self.add_text_document(content, metadata)
            doc_ids.append(doc_id)

        print(f"✅ 批量添加完成，共{len(doc_ids)}个文档")
        return doc_ids

# 使用示例
def load_sample_documents(doc_manager: DocumentManager):
    """加载示例文档"""
    sample_docs = [
        {
            "content": "云器ClickZetta是新一代云原生湖仓一体化平台，采用增量计算技术，相比传统Spark架构性能提升10倍。支持实时数据处理、批流一体、存储计算分离等特性。",
            "metadata": {"category": "product", "topic": "clickzetta"}
        },
        {
            "content": "LangChain是一个用于构建语言模型应用的框架，提供了丰富的组件包括文档加载器、向量存储、检索器、链等。支持多种语言模型和向量数据库。",
            "metadata": {"category": "framework", "topic": "langchain"}
        },
        {
            "content": "检索增强生成（RAG）是一种结合信息检索和文本生成的AI技术。通过检索相关文档作为上下文，可以显著提高生成内容的准确性和可靠性。",
            "metadata": {"category": "technology", "topic": "rag"}
        },
        {
            "content": "向量数据库使用高维向量表示数据，通过计算向量间的相似度来实现语义搜索。常见的距离度量包括余弦距离、欧氏距离等。",
            "metadata": {"category": "technology", "topic": "vector"}
        }
    ]

    return doc_manager.add_batch_documents(sample_docs)
```

## 🤖 第四步：问答系统

```python
from langchain.chains import ConversationalRetrievalChain
from langchain.memory import ConversationBufferWindowMemory
from langchain_core.messages import HumanMessage, AIMessage

class RAGChatBot:
    def __init__(self, rag_app: RAGApplication):
        self.rag_app = rag_app

        # 创建对话检索链
        self.qa_chain = ConversationalRetrievalChain.from_llm(
            llm=self.rag_app.llm,
            retriever=self.rag_app.retriever,
            return_source_documents=True,
            verbose=True
        )

    def chat(self, question: str, session_id: str) -> dict:
        """进行对话问答"""

        # 获取聊天历史
        chat_history = self.rag_app.get_chat_history(session_id)

        # 获取历史对话（最近10轮）
        history_messages = chat_history.get_messages_by_count(10)

        # 转换为对话历史格式
        chat_history_tuples = []
        for i in range(0, len(history_messages), 2):
            if i + 1 < len(history_messages):
                human_msg = history_messages[i]
                ai_msg = history_messages[i + 1]
                if (isinstance(human_msg, HumanMessage) and
                    isinstance(ai_msg, AIMessage)):
                    chat_history_tuples.append((human_msg.content, ai_msg.content))

        # 执行问答
        result = self.qa_chain({
            "question": question,
            "chat_history": chat_history_tuples
        })

        # 保存当前对话到历史
        chat_history.add_message(HumanMessage(content=question))
        chat_history.add_message(AIMessage(content=result["answer"]))

        # 格式化返回结果
        response = {
            "question": question,
            "answer": result["answer"],
            "source_documents": [
                {
                    "content": doc.page_content,
                    "metadata": doc.metadata
                }
                for doc in result["source_documents"]
            ],
            "session_id": session_id
        }

        return response

    def get_conversation_history(self, session_id: str) -> List[dict]:
        """获取对话历史"""
        chat_history = self.rag_app.get_chat_history(session_id)
        messages = chat_history.messages

        conversation = []
        for msg in messages:
            role = "user" if isinstance(msg, HumanMessage) else "assistant"
            conversation.append({
                "role": role,
                "content": msg.content,
                "timestamp": getattr(msg, 'timestamp', None)
            })

        return conversation
```

## 🔍 第五步：高级检索功能

```python
class AdvancedRetriever:
    def __init__(self, rag_app: RAGApplication):
        self.rag_app = rag_app

    def semantic_search(self, query: str, k: int = 5) -> List[dict]:
        """纯向量语义搜索"""
        documents = self.rag_app.document_store.similarity_search(query, k=k)

        return [
            {
                "content": doc.page_content,
                "metadata": doc.metadata,
                "type": "semantic"
            }
            for doc in documents
        ]

    def keyword_search(self, query: str, k: int = 5) -> List[dict]:
        """纯关键词搜索"""
        # 使用全文检索器
        from langchain_clickzetta.retrievers import ClickZettaFullTextRetriever

        fulltext_retriever = ClickZettaFullTextRetriever(
            engine=self.rag_app.engine,
            table_name=self.rag_app.document_store.table_name,
            search_type="phrase",
            k=k
        )

        documents = fulltext_retriever.get_relevant_documents(query)

        return [
            {
                "content": doc.page_content,
                "metadata": doc.metadata,
                "type": "keyword"
            }
            for doc in documents
        ]

    def hybrid_search_with_filters(
        self,
        query: str,
        filters: dict = None,
        k: int = 5
    ) -> List[dict]:
        """带过滤条件的混合搜索"""

        # 构建过滤条件SQL
        filter_sql = ""
        if filters:
            conditions = []
            for key, value in filters.items():
                if isinstance(value, str):
                    conditions.append(f"JSON_EXTRACT(metadata, '$.{key}') = '{value}'")
                elif isinstance(value, list):
                    values_str = "', '".join(str(v) for v in value)
                    conditions.append(f"JSON_EXTRACT(metadata, '$.{key}') IN ('{values_str}')")

            if conditions:
                filter_sql = " AND " + " AND ".join(conditions)

        # 执行混合搜索
        retriever = ClickZettaUnifiedRetriever(
            hybrid_store=self.rag_app.document_store,
            search_type="hybrid",
            alpha=0.5,
            k=k,
            filter_sql=filter_sql
        )

        documents = retriever.invoke(query)

        return [
            {
                "content": doc.page_content,
                "metadata": doc.metadata,
                "type": "hybrid_filtered"
            }
            for doc in documents
        ]

    def multi_strategy_search(self, query: str, k: int = 5) -> dict:
        """多策略搜索对比"""
        return {
            "semantic": self.semantic_search(query, k),
            "keyword": self.keyword_search(query, k),
            "hybrid": self.rag_app.retriever.invoke(query)
        }
```

## 📊 第六步：完整应用示例

```python
def main():
    # 初始化RAG应用
    rag_app = RAGApplication(CLICKZETTA_CONFIG, DASHSCOPE_API_KEY)

    # 文档管理器
    doc_manager = DocumentManager(rag_app)

    # 聊天机器人
    chatbot = RAGChatBot(rag_app)

    # 高级检索器
    advanced_retriever = AdvancedRetriever(rag_app)

    # 1. 加载示例文档
    print("=== 加载示例文档 ===")
    doc_ids = load_sample_documents(doc_manager)

    # 2. 测试不同检索策略
    print("\n=== 测试检索功能 ===")
    query = "什么是ClickZetta？"

    # 多策略搜索对比
    search_results = advanced_retriever.multi_strategy_search(query)
    print(f"查询: {query}")

    for strategy, results in search_results.items():
        print(f"\n{strategy.upper()} 搜索结果:")
        for i, result in enumerate(results[:2], 1):
            content = result.page_content if hasattr(result, 'page_content') else result['content']
            print(f"  {i}. {content[:100]}...")

    # 3. 对话问答测试
    print("\n=== 对话问答测试 ===")
    session_id = "demo_session"

    questions = [
        "什么是ClickZetta？它有什么特点？",
        "RAG技术是如何工作的？",
        "ClickZetta相比传统Spark有什么优势？",
        "LangChain框架包含哪些组件？"
    ]

    for question in questions:
        print(f"\n用户: {question}")

        response = chatbot.chat(question, session_id)
        print(f"AI: {response['answer']}")

        # 显示源文档
        print("参考文档:")
        for i, source in enumerate(response['source_documents'][:2], 1):
            print(f"  {i}. {source['content'][:80]}...")

    # 4. 查看对话历史
    print("\n=== 对话历史 ===")
    history = chatbot.get_conversation_history(session_id)
    for msg in history[-4:]:  # 显示最后4条消息
        role = "用户" if msg["role"] == "user" else "AI"
        print(f"{role}: {msg['content'][:100]}...")

if __name__ == "__main__":
    main()
```

## 🚀 第七步：Web界面（可选）

```python
import streamlit as st

def create_streamlit_app():
    """创建Streamlit Web界面"""

    st.title("🤖 智能文档问答系统")
    st.caption("基于 LangChain ClickZetta 的RAG应用")

    # 初始化应用（使用session state缓存）
    if 'rag_app' not in st.session_state:
        with st.spinner("初始化应用..."):
            st.session_state.rag_app = RAGApplication(CLICKZETTA_CONFIG, DASHSCOPE_API_KEY)
            st.session_state.chatbot = RAGChatBot(st.session_state.rag_app)

    # 侧边栏 - 文档管理
    with st.sidebar:
        st.header("📚 文档管理")

        # 文档上传
        uploaded_file = st.file_uploader("上传文档", type=['txt'])
        if uploaded_file and st.button("添加文档"):
            content = uploaded_file.read().decode('utf-8')
            doc_manager = DocumentManager(st.session_state.rag_app)
            doc_id = doc_manager.add_text_document(
                content,
                {"filename": uploaded_file.name}
            )
            st.success(f"文档已添加: {doc_id[:8]}...")

        # 搜索策略选择
        st.header("🔍 搜索设置")
        search_strategy = st.selectbox(
            "检索策略",
            ["hybrid", "semantic", "keyword"]
        )

    # 主界面 - 对话
    st.header("💬 智能问答")

    # 会话ID
    session_id = st.text_input("会话ID", value="default_session")

    # 聊天历史显示
    if 'messages' not in st.session_state:
        st.session_state.messages = []

    for message in st.session_state.messages:
        with st.chat_message(message["role"]):
            st.write(message["content"])
            if "sources" in message:
                with st.expander("参考文档"):
                    for i, source in enumerate(message["sources"], 1):
                        st.text(f"{i}. {source['content'][:200]}...")

    # 用户输入
    if question := st.chat_input("请输入您的问题"):
        # 显示用户消息
        st.session_state.messages.append({"role": "user", "content": question})
        with st.chat_message("user"):
            st.write(question)

        # 生成回答
        with st.chat_message("assistant"):
            with st.spinner("思考中..."):
                response = st.session_state.chatbot.chat(question, session_id)

                # 显示回答
                st.write(response["answer"])

                # 显示源文档
                with st.expander("参考文档"):
                    for i, source in enumerate(response["source_documents"], 1):
                        st.text(f"{i}. {source['content'][:200]}...")

                # 保存到会话
                st.session_state.messages.append({
                    "role": "assistant",
                    "content": response["answer"],
                    "sources": response["source_documents"]
                })

# 运行Streamlit应用
# streamlit run rag_app.py
```

## 📈 性能优化建议

### 1. 数据存储优化

```python
# 使用分区表提高查询性能
create_partitioned_table_sql = """
CREATE TABLE rag_documents_partitioned (
    id String,
    content String,
    embedding Array(Float32),
    metadata String,
    created_at Timestamp DEFAULT CURRENT_TIMESTAMP
)
PARTITION BY toYYYYMM(created_at)
"""

# 建立适当的索引
create_indexes_sql = [
    "CREATE INDEX idx_metadata ON rag_documents (metadata)",
    "CREATE INVERTED INDEX idx_content ON rag_documents (content) WITH ANALYZER='ik'",
    "CREATE VECTOR INDEX idx_embedding ON rag_documents (embedding)"
]
```

### 2. 检索优化

```python
# 缓存频繁查询的结果
from functools import lru_cache

class CachedRetriever:
    def __init__(self, retriever):
        self.retriever = retriever

    @lru_cache(maxsize=100)
    def cached_search(self, query: str, k: int = 5):
        return self.retriever.invoke(query)
```

### 3. 批处理优化

```python
# 批量添加文档
def batch_add_documents(document_store, documents, batch_size=100):
    for i in range(0, len(documents), batch_size):
        batch = documents[i:i + batch_size]
        document_store.add_documents(batch)
        print(f"已处理 {min(i + batch_size, len(documents))}/{len(documents)} 文档")
```

## 🎯 总结

本教程展示了如何使用 LangChain 和 ClickZetta 构建一个完整的RAG应用，包括：

✅ **核心功能实现**
- 文档向量化存储
- 混合检索（向量+全文）
- 对话问答生成
- 聊天历史管理

✅ **高级特性**
- 多策略检索对比
- 过滤条件搜索
- 批量文档处理
- Web界面集成

✅ **生产就绪**
- 性能优化建议
- 错误处理机制
- 可扩展架构设计
- 完整的使用示例

通过这个RAG应用，您可以构建智能客服、知识问答、文档助手等多种AI应用。ClickZetta的高性能和LangChain的丰富生态为您提供了强大的技术基础。