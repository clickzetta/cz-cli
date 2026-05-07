# 云器Lakehouse Unstructured ETL 管道构建指南

## 概述

本文介绍了基于云器 Lakehouse、DashScope 和 Unstructured Ingest 的完整 ETL（提取、转换、加载）管道解决方案，支持非结构化数据处理、向量嵌入生成和知识库构建。

## 系统架构

### Unstructured Ingest 框架

Unstructured Ingest 是一个企业级的文档处理和 ETL 框架，采用插件化架构设计，支持多种数据源和目标的连接器。

#### 核心设计理念

```
数据源 → 索引 → 下载 → 解析 → 分块 → 嵌入 → 暂存 → 上传 → 目标存储
```

**框架特点**

* **插件化架构**：通过连接器注册机制支持多种数据源
* **流水线处理**：每个步骤独立，支持异步和多进程并行
* **可扩展性**：支持自定义连接器和处理器
* **容错机制**：内置重试、错误处理和状态管理

#### 处理步骤详解

1. **Indexer（索引器）**
   * 连接数据源，获取文档元数据
   * 支持增量更新和变更检测
   * 生成处理任务队列

2. **Downloader（下载器**）
   * 从数据源下载文档到本地
   * 支持断点续传和批量下载
   * 处理文件格式转换

3. **Partitioner（分割器**）
   * 解析文档内容，提取结构化信息
   * 支持多种文档格式（PDF、DOCX、HTML等）
   * 识别标题、段落、表格、图像等元素

4. **Chunker（分块器**）
   * 将文档按语义单元分割
   * 支持多种分块策略（按标题、按字符数、按语义）
   * 维护上下文关联性

5. **Embedder（嵌入器**）
   * 生成文本向量表示
   * 支持多种嵌入模型和服务
   * 批量处理优化性能

6. **Stager（暂存器**）
   * 数据格式转换和预处理
   * 适配目标存储格式要求
   * 数据验证和清洗

7. **Uploader（上传器**）
   * 将处理结果上传到目标存储
   * 支持批量上传和事务处理
   * 处理冲突和重复数据

### 云器 Lakehouse 平台

云器 Lakehouse 是一个云原生的 Lakehouse 数据平台，采用计算存储分离架构，专为大数据分析和 AI 应用设计。

#### 对象模型架构

云器 Lakehouse 采用分层结构管理资源：

```
Account
 └── User
 └── Lakehouse Instance
     └── Workspace
         ├── Schema
         │   ├── Table
         │   │   └── Table Volume (Bound to Table)
         │   ├── View
         │   ├── Materialized View
         │   └── Named Volume (Schema-level)
         │
         ├── Virtual Cluster
         │   ├── GENERAL (ETL/Batch)
         │   ├── ANALYTICS (Query/BI)
         │   └── INTEGRATION (DataSync)
         │
         └── User Volume (Workspace-level)
```

#### 核心组件

1. **计算集群（Virtual Cluster，VCluster）**

   提供弹性、可扩展的计算资源，以 CRU（Compute Resource Unit）为单位计量：

   | 集群类型             | 适用场景       | 特点          |
   | ---------------- | ---------- | ----------- |
   | 通用型（GENERAL）     | ETL、批处理作业  | 公平调度，资源共享   |
   | 分析型（ANALYTICS）   | 在线查询、BI 报表 | 多实例弹缩，高并发支持 |
   | 同步型（INTEGRATION） | 数据集成任务     | 专为 ETL 管道优化 |

2. **存储系统（Volume**）

   三种 Volume 类型及其层次关系：

   ```
   User Volume            Table Volume           Named Volume
   ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
   │ Personal Files   │   │ Table-bound      │   │ Schema-scoped    │
   │                  │   │ Files            │   │ Shared Files     │
   │ Protocol:        │   │                  │   │                  │
   │ volume:user://   │   │ Protocol:        │   │ Protocol:        │
   │ ~/filename       │   │ volume:table://  │   │ volume://        │
   │                  │   │ table/filename   │   │ volume/filename  │
   │ Level: Workspace │   │                  │   │                  │
   │ Scope: User      │   │ Level: Table     │   │ Level: Schema    │
   │ Access: User R/W │   │ Bound: Specific  │   │ Access: Custom   │
   │                  │   │ Table            │   │ Cross-team       │
   └──────────────────┘   └──────────────────┘   └──────────────────┘
   ```

3. **统一数据接口**

   * **SQL 接口**：标准 SQL 查询和管理
   * **Python API**：编程式访问和自动化
   * **JDBC/ODBC**：企业应用集成
   * **REST API**：云原生应用接入

#### 存储卷详解

**User Volume**

* **层次**：Workspace 级别，用户个人存储空间
* **绑定**：绑定到用户，类似操作系统用户主目录
* **权限**：用户默认具备读写权限
* **协议**：`volume:user://~/filename`
* **操作**：PUT、GET、LIST、REMOVE、SELECT FROM VOLUME

**Table Volume**

* **层次**：Table 级别，与具体数据表绑定
* **绑定**：每个表自动关联一个专属 Volume
* **权限**：继承表权限（SELECT/INSERT/UPDATE/DELETE）
* **协议**：`volume:table://table_name/filename`
* **典型场景**：COPY INTO 数据导入、ETL 临时文件存储

**Named Volume**

* **层次**：Schema 级别，显式创建的命名存储卷
* **绑定**：属于特定 Schema，支持跨表共享
* **权限**：支持自定义权限分配和跨团队协作
* **协议**：`volume://volume_name/path`
* **典型场景**：Schema 内数据共享、批量数据处理

#### 向量能力

云器 Lakehouse 内置向量处理能力，专为 RAG（检索增强生成）应用优化：

* **向量索引**：支持 HNSW 高效索引算法
* **多维度支持**：512/768/1024/1536 等多维向量
* **混合检索**：向量相似度 + 全文检索 + 传统 SQL 查询
* **实时更新**：支持向量数据的实时插入和更新

#### 计算资源规格

| 类型  | 最小规格(CRU) | 最大规格(CRU) | 步长规则            |
| --- | --------- | --------- | --------------- |
| 通用型 | 1         | 256       | 1 CRU 步长        |
| 分析型 | 1         | 256       | 2的n次幂 CRU       |
| 同步型 | 0.25      | 256       | 0.25/0.5/1+ CRU |

#### 工作空间隔离

* **多租户架构**：账户 → 实例 → 工作空间多层隔离
* **权限控制**：基于用户、角色的精细权限管理
* **资源隔离**：不同工作空间间计算和存储资源隔离
* **跨空间共享**：支持跨工作空间的安全数据共享

### DashScope 嵌入服务

DashScope 是阿里云提供的大模型服务平台，提供高质量的文本嵌入能力。

#### 模型架构

DashScope 文本嵌入处理流程：

```
Input Text → Tokenizer → Transformer → Pooling → Normalize → Vector Output
    │            │            │           │          │           │
 CN/EN Text   Subword     Multi-Head    Average    L2 Norm    1024-dim
               Split      Attention     Pooling              Vector
```

### 集成架构

系统采用三层架构，实现完整的数据处理生命周期：

```
┌─────────────────────────────────────────────────────────────────┐
│                    Application Layer                            │
│  RAG | Knowledge Base | Search | BI Analytics | API Services    │
└─────────────────────────────────────────────────────────────────┘
                                ↑
┌─────────────────────────────────────────────────────────────────┐
│                     ETL Processing Layer                        │
│                                                                 │
│  Data Source      Framework       Embedding       Target        │
│ ┌─────────┐     ┌─────────────┐   ┌─────────────┐ ┌─────────┐   │
│ │ Volume  │────▶│Unstructured │──▶│ DashScope   │▶│ SQL     │   │
│ │ Files   │     │• Doc Parse  │   │• v1/v2/v3/v4│ │ Tables  │   │
│ │ SQL     │     │• Chunking   │   │• Batch      │ │• Vector │   │
│ └─────────┘     │• Multi-Src  │   │• Vectorize  │ │• Meta   │   │
│                 └─────────────┘   └─────────────┘ └─────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                ↑
┌─────────────────────────────────────────────────────────────────┐
│                    Yunqi Lakehouse Platform                     │
│                                                                 │
│  Compute Layer      Storage Layer       Service Layer           │
│ ┌─────────────┐   ┌─────────────────┐  ┌─────────────────┐      │
│ │ General VC  │   │ User Volume     │  │ Metadata Mgmt   │      │
│ │ Analytics   │◀─▶│ Table Volume    │◀▶│ Access Control  │      │
│ │ Integration │   │ Named Volume    │  │ Task Scheduling │      │
│ │ Vector Idx  │   │ SQL Storage     │  │ Monitoring      │      │
│ └─────────────┘   └─────────────────┘  └─────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

#### 数据流向

**典型 ETL 流程**：

1. **源数据** → Volume 文件卷或 SQL 表
2. **索引扫描** → Unstructured 框架识别待处理文档
3. **智能解析** → 文档分割、结构化提取
4. **向量化** → DashScope 生成文本嵌入
5. **存储** → 云器 Lakehouse SQL 表（含向量列）
6. **应用** → RAG 检索、知识问答、数据分析

### 核心组件

1. **云器 Lakehouse SQL 连接器** - 用于关系数据库操作和 RAG 检索系统
2. **云器 Lakehouse Volume 连接器** - 用于文件系统操作（用户卷、表卷、命名卷）
3. **DashScope 嵌入服务** - 支持 4 个模型版本的文本向量化
4. **Unstructured 数据处理** - 文档解析、分割和结构化

## 快速开始

### 环境配置

```bash
# 安装依赖
pip install unstructured-ingest-clickzetta

# 配置环境变量
export CLICKZETTA_SERVICE="your-service-url"
export CLICKZETTA_USERNAME="your-username"
export CLICKZETTA_PASSWORD="your-password"
export CLICKZETTA_WORKSPACE="your-workspace"
export CLICKZETTA_SCHEMA="your-schema"
export CLICKZETTA_INSTANCE="your-instance"
export CLICKZETTA_VCLUSTER="your-vcluster"

# DashScope 配置
export DASHSCOPE_API_KEY="your-dashscope-api-key"
```

### 验证安装

```python
from unstructured_ingest.processes.connectors.sql.clickzetta import ClickzettaConnectionConfig
from unstructured_ingest.embed.dashscope import DashScopeEmbeddingConfig

# 测试云器 Lakehouse 连接
config = ClickzettaConnectionConfig()
with config.get_session() as session:
    result = session.sql("SELECT 1").collect()
    print("云器 Lakehouse 连接成功")

# 测试 DashScope 连接
embed_config = DashScopeEmbeddingConfig(model_name="text-embedding-v3")
print("DashScope 配置就绪")
```

## 使用场景

### 场景 1：云器 Lakehouse SQL 数据处理

适用于关系数据库表的批量处理和向量化。

#### 基本索引和下载

```python
from unstructured_ingest.processes.connectors.sql.clickzetta import (
    ClickzettaConnectionConfig,
    ClickzettaIndexer,
    ClickzettaIndexerConfig,
    ClickzettaDownloader,
    ClickzettaDownloaderConfig
)

# 连接配置
connection_config = ClickzettaConnectionConfig()

# 索引器配置 - 按批次处理表数据
indexer = ClickzettaIndexer(
    connection_config=connection_config,
    index_config=ClickzettaIndexerConfig(
        table_name="documents",
        id_column="id",
        batch_size=1000,
        # 可选：添加WHERE条件过滤数据
        # where_clause="created_at > '2024-01-01'"
    )
)

# 下载器配置
downloader = ClickzettaDownloader(
    connection_config=connection_config,
    download_config=ClickzettaDownloaderConfig(
        fields=["id", "title", "content"],
        download_dir="/path/to/download"
    )
)

# 执行数据处理
for file_data in indexer.run():
    downloaded_files = downloader.run(file_data=file_data)
    print(f"处理完成: {len(downloaded_files)} 个文件")
```

#### 向量嵌入处理

```python
from unstructured_ingest.embed.dashscope import DashScopeEmbeddingConfig
from unstructured_ingest.processes.connectors.sql.clickzetta import (
    ClickzettaUploader,
    ClickzettaUploaderConfig
)

# DashScope 嵌入配置
embed_config = DashScopeEmbeddingConfig(
    model_name="text-embedding-v3",  # 支持 v1/v2/v3/v4
    batch_size=25,
    text_field="content",
    # 不同版本的维度：
    # v1: 1536维, v2: 1536维, v3: 1024维, v4: 1024维
)

# 上传器配置 - 支持向量字段
uploader = ClickzettaUploader(
    connection_config=connection_config,
    upload_config=ClickzettaUploaderConfig(
        table_name="document_vectors",
        # 向量字段配置
        vector_column="embedding",
        vector_dimension=1024,  # 对应 v3/v4 模型
        batch_size=100
    )
)

# 处理文档并生成向量
processed_data = []
for file_data in indexed_files:
    # 使用 DashScope 生成嵌入
    embeddings = embed_config.embed_documents([file_data['content']])

    processed_data.append({
        'id': file_data['id'],
        'content': file_data['content'],
        'embedding': embeddings[0]
    })

# 批量上传到云器 Lakehouse
uploader.upload_batch(processed_data)
```

### 场景 2：云器 Lakehouse Volume 文件处理

适用于文件系统级别的数据处理，支持三种卷类型。

#### Volume 类型说明

1. **User Volume** — 用户个人文件空间
2. **Table Volume** — 与数据表关联的文件存储
3. **Named Volume** — 命名的共享文件卷

#### 文件索引和下载

```python
from unstructured_ingest.processes.connectors.fsspec.clickzetta_volume import (
    ClickzettaVolumeConnectionConfig,
    ClickzettaVolumeIndexer,
    ClickzettaVolumeIndexerConfig,
    ClickzettaVolumeDownloader,
    ClickzettaVolumeDownloaderConfig
)

# 连接配置
connection_config = ClickzettaVolumeConnectionConfig()

# 索引不同类型的卷
configs = [
    # User Volume
    ClickzettaVolumeIndexerConfig(
        index_volume_type="user",
        index_remote_path="documents/"  # 可选：指定子目录
    ),
    # Table Volume
    ClickzettaVolumeIndexerConfig(
        index_volume_type="table",
        index_volume_name="document_table",
        index_remote_path="images/"
    ),
    # Named Volume
    ClickzettaVolumeIndexerConfig(
        index_volume_type="named",
        index_volume_name="shared_data_volume",
        index_regexp=r".*\.pdf$"  # 可选：正则表达式过滤
    )
]

# 处理每种卷类型
for config in configs:
    indexer = ClickzettaVolumeIndexer(
        connection_config=connection_config,
        index_config=config
    )

    # 获取文件列表
    files = indexer.list_files()
    print(f"卷 {config.volume_type} 中发现 {len(files)} 个文件")

    # 下载文件
    downloader = ClickzettaVolumeDownloader(
        connection_config=connection_config,
        download_config=ClickzettaVolumeDownloaderConfig(),
        index_config=config
    )

    downloaded = downloader.run(files=files)
    print(f"下载完成: {len(downloaded)} 个文件")
```

#### 文件上传

```python
from unstructured_ingest.processes.connectors.fsspec.clickzetta_volume import (
    ClickzettaVolumeUploader,
    ClickzettaVolumeUploaderConfig
)

# 上传器配置
uploader = ClickzettaVolumeUploader(
    connection_config=connection_config,
    upload_config=ClickzettaVolumeUploaderConfig(
        volume_type="named",
        volume_name="processed_documents",
        remote_path="output/"
    )
)

# 上传处理后的文件
local_files = ["/path/to/processed1.json", "/path/to/processed2.json"]
for local_file in local_files:
    uploader.upload_file(local_file, "processed/" + os.path.basename(local_file))
```

### 场景 3：完整 ETL 管道

结合 SQL 和 Volume 连接器构建端到端的 ETL 管道。

#### 数据流架构

```
原始文档 → 云器 Lakehouse Volume → 处理 → DashScope 嵌入 → 云器 Lakehouse SQL → 检索系统
```

#### 完整示例

```python
import asyncio
from pathlib import Path
from unstructured_ingest.interfaces import PartitionConfig
from unstructured_ingest.embed.dashscope import DashScopeEmbeddingConfig

async def complete_etl_pipeline():
    """完整的 ETL 管道示例"""

    # 第一步：从 Volume 读取原始文档
    volume_indexer = ClickzettaVolumeIndexer(
        connection_config=ClickzettaVolumeConnectionConfig(),
        index_config=ClickzettaVolumeIndexerConfig(
            index_volume_type="named",
            index_volume_name="raw_documents",
            index_regexp=r".*\.(pdf|docx|txt)$"
        )
    )

    # 第二步：下载和解析文档
    volume_downloader = ClickzettaVolumeDownloader(
        connection_config=volume_indexer.connection_config,
        download_config=ClickzettaVolumeDownloaderConfig(),
        index_config=volume_indexer.index_config
    )

    raw_files = volume_indexer.list_files()
    downloaded = volume_downloader.run(files=raw_files)

    # 第三步：文档分割和结构化
    partition_config = PartitionConfig(
        strategy="hi_res",
        pdf_infer_table_structure=True,
        chunking_strategy="by_title",
        max_characters=1000,
        overlap=100
    )

    processed_documents = []
    for file_info in downloaded:
        # 处理每个文档
        from unstructured.partition.auto import partition

        elements = partition(
            filename=str(file_info['local_path']),
            **partition_config.dict()
        )

        # 转换为文档块
        for element in elements:
            processed_documents.append({
                'source_file': file_info['remote_path'],
                'content': str(element),
                'element_type': element.category,
                'metadata': element.metadata.to_dict() if element.metadata else {}
            })

    # 第四步：生成向量嵌入
    embed_config = DashScopeEmbeddingConfig(
        model_name="text-embedding-v3",
        batch_size=25
    )

    # 批量生成嵌入
    contents = [doc['content'] for doc in processed_documents]
    embeddings = embed_config.embed_documents(contents)

    # 添加向量到文档
    for doc, embedding in zip(processed_documents, embeddings):
        doc['embedding'] = embedding
        doc['vector_model'] = "text-embedding-v3"
        doc['vector_dimension'] = 1024

    # 第五步：存储到云器 Lakehouse SQL 表
    sql_uploader = ClickzettaUploader(
        connection_config=ClickzettaConnectionConfig(),
        upload_config=ClickzettaUploaderConfig(
            table_name="document_knowledge_base",
            vector_column="embedding",
            vector_dimension=1024,
            batch_size=100
        )
    )

    # 批量上传
    await sql_uploader.upload_batch_async(processed_documents)

    print(f"ETL 管道完成: 处理了 {len(processed_documents)} 个文档块")
    return processed_documents

# 运行管道
if __name__ == "__main__":
    results = asyncio.run(complete_etl_pipeline())
```

## CLI 命令参考

### 云器 Lakehouse SQL 连接器

```bash
# 基本数据提取
unstructured-ingest \
    clickzetta \
    --table-name documents \
    --id-column id \
    --batch-size 1000 \
    --fields id,title,content \
    --output-dir ./output

# 带过滤条件的提取
unstructured-ingest \
    clickzetta \
    --table-name documents \
    --where-clause "created_at > '2024-01-01'" \
    --id-column id \
    --fields id,content \
    --output-dir ./filtered_output

# 向量化处理
unstructured-ingest \
    clickzetta \
    --table-name source_docs \
    --embed-provider dashscope \
    --embedding-model-name text-embedding-v3 \
    --output-dir ./vectorized
```

### 云器 Lakehouse Volume 连接器

```bash
# User Volume 处理
unstructured-ingest \
    clickzetta-volume \
    --volume-type user \
    --remote-path documents/ \
    --output-dir ./user_docs

# Table Volume 处理
unstructured-ingest \
    clickzetta-volume \
    --volume-type table \
    --volume-name document_table \
    --remote-path images/ \
    --output-dir ./table_files

# Named Volume 处理（带正则过滤）
unstructured-ingest \
    clickzetta-volume \
    --volume-type named \
    --volume-name shared_data \
    --regexp ".*\.pdf$" \
    --output-dir ./pdf_files

# 文档分割配置
unstructured-ingest \
    clickzetta-volume \
    --volume-type named \
    --volume-name documents \
    --partition-strategy hi_res \
    --chunking-strategy by_title \
    --max-characters 1000 \
    --overlap 100 \
    --additional-partition-args '{"split_pdf_page": true}' \
    --output-dir ./chunked_docs
```

### 上传到云器 Lakehouse

```bash
# 上传处理后的数据到 SQL 表
unstructured-ingest \
    local \
    --input-path ./processed_docs \
    --output-dir ./staging \
    --destination clickzetta \
    --table-name processed_documents \
    --batch-size 100

# 上传文件到 Volume
unstructured-ingest \
    local \
    --input-path ./files_to_upload \
    --output-dir ./staging \
    --destination clickzetta-volume \
    --volume-type named \
    --volume-name output_volume \
    --remote-path processed/
```

## DashScope 嵌入模型详解

### 支持的模型版本

| 模型版本              | 维度   | 最大输入长度      | 适用场景      |
| ----------------- | ---- | ----------- | --------- |
| text-embedding-v1 | 1536 | 2048 tokens | 通用文本嵌入    |
| text-embedding-v2 | 1536 | 2048 tokens | 改进的语义理解   |
| text-embedding-v3 | 1024 | 8192 tokens | 长文本处理优化   |
| text-embedding-v4 | 1024 | 8192 tokens | 最新版本，性能最佳 |

#### 嵌入配置示例

```python
# 不同版本的配置
configs = {
    "v1": DashScopeEmbeddingConfig(
        model_name="text-embedding-v1",
        batch_size=20,
        max_retries=3,
        dimensions=1536
    ),
    "v3": DashScopeEmbeddingConfig(
        model_name="text-embedding-v3",
        batch_size=25,
        max_retries=3,
        dimensions=1024
    ),
    "v4": DashScopeEmbeddingConfig(
        model_name="text-embedding-v4",
        batch_size=30,
        max_retries=3,
        dimensions=1024
    )
}

# 选择合适的模型
embed_config = configs["v4"]  # 推荐使用最新版本
```

## 最佳实践

### 性能优化

1. **批量处理大小**
   * SQL 连接器：1000-5000 行/批次
   * Volume 连接器：100-500 文件/批次
   * DashScope 嵌入：20-30 文档/批次

2. **内存管理**
   ```python
   # 对于大型数据集，使用流式处理
   for batch in indexer.run():
       processed = downloader.run(file_data=batch)
       # 立即处理，避免内存积累
       process_batch(processed)
       del processed  # 显式释放内存
   ```

3. **错误处理**
   ```python
   import time
   from unstructured_ingest.errors_v2 import UserAuthError, UserError

   def robust_processing(files, max_retries=3):
       for file_data in files:
           for attempt in range(max_retries):
               try:
                   result = process_file(file_data)
                   break
               except UserAuthError:
                   # 认证错误，不重试
                   raise
               except UserError as e:
                   if attempt == max_retries - 1:
                       raise
                   time.sleep(2 ** attempt)  # 指数退避
   ```

### 数据质量保证

1. **输入验证**
   ```python
   def validate_input_data(data):
       required_fields = ['id', 'content']
       for item in data:
           if not all(field in item for field in required_fields):
               raise ValueError(f"缺少必需字段: {required_fields}")
           if not item['content'].strip():
               raise ValueError("内容不能为空")
   ```

2. **输出验证**
   ```python
   def validate_embeddings(embeddings, expected_dimension):
       for i, embedding in enumerate(embeddings):
           if len(embedding) != expected_dimension:
               raise ValueError(f"嵌入 {i} 维度错误: {len(embedding)} != {expected_dimension}")
   ```

### 监控和日志

```python
import logging
from unstructured_ingest.logger import logger

# 配置详细日志
logging.getLogger("unstructured_ingest").setLevel(logging.DEBUG)

# 添加性能监控
import time
from contextlib import contextmanager

@contextmanager
def timer(description):
    start = time.time()
    yield
    elapsed = time.time() - start
    logger.info(f"{description} 耗时: {elapsed:.2f} 秒")

# 使用示例
with timer("文档处理"):
    processed = process_documents(documents)
```

## 故障排查

### 常见问题

1. **连接失败**
   ```
   错误: Failed to create clickzetta session
   解决: 检查环境变量配置，确保网络连通性
   ```

2. **嵌入生成失败**
   ```
   错误: DashScope API key invalid
   解决: 验证 DASHSCOPE_API_KEY 环境变量
   ```

3. **文件下载失败**
   ```
   错误: Volume 'xxx' 中未找到匹配的文件
   解决: 检查 volume 名称和路径是否正确
   ```

### 调试技巧

1. **启用详细日志**
   ```python
   import os
   os.environ["UNSTRUCTURED_LOG_LEVEL"] = "DEBUG"
   ```

2. **测试连接**
   ```python
   # 测试云器 Lakehouse 连接
   with ClickzettaConnectionConfig().get_session() as session:
       result = session.sql("SELECT CURRENT_TIMESTAMP()").collect()
       print("连接正常")

   # 测试 DashScope
   from unstructured_ingest.embed.dashscope import DashScopeEmbeddingConfig
   config = DashScopeEmbeddingConfig(model_name="text-embedding-v3")
   embeddings = config.embed_documents(["测试文本"])
   print(f"嵌入维度: {len(embeddings[0])}")
   ```

3. **验证数据流**
   ```python
   # 在每个阶段输出样本数据
   logger.info(f"索引阶段: 找到 {len(indexed_files)} 个文件")
   logger.info(f"下载阶段: 处理 {len(downloaded_files)} 个文件")
   logger.info(f"嵌入阶段: 生成 {len(embeddings)} 个向量")
   ```

## 企业级部署

### Docker 化部署

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# 安装依赖
COPY requirements.txt .
RUN pip install -r requirements.txt

# 复制应用代码
COPY . .

# 设置环境变量
ENV PYTHONPATH=/app
ENV UNSTRUCTURED_LOG_LEVEL=INFO

# 运行 ETL 管道
CMD ["python", "etl_pipeline.py"]
```

### Kubernetes 配置

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: lakehouse-config
data:
  CLICKZETTA_SERVICE: "your-service-url"
  CLICKZETTA_WORKSPACE: "your-workspace"

---
apiVersion: v1
kind: Secret
metadata:
  name: lakehouse-secrets
type: Opaque
stringData:
  CLICKZETTA_PASSWORD: "your-password"
  DASHSCOPE_API_KEY: "your-api-key"

---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: etl-pipeline
spec:
  schedule: "0 2 * * *"  # 每天凌晨2点运行
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: etl
            image: your-registry/lakehouse-etl:latest
            envFrom:
            - configMapRef:
                name: lakehouse-config
            - secretRef:
                name: lakehouse-secrets
          restartPolicy: OnFailure
```

### 生产环境配置

```python
# production_config.py
import os
from dataclasses import dataclass

@dataclass
class ProductionConfig:
    # 云器 Lakehouse 配置
    clickzetta_service: str = os.getenv("CLICKZETTA_SERVICE")
    clickzetta_pool_size: int = int(os.getenv("CLICKZETTA_POOL_SIZE", "10"))

    # DashScope 配置
    dashscope_api_key: str = os.getenv("DASHSCOPE_API_KEY")
    dashscope_rate_limit: int = int(os.getenv("DASHSCOPE_RATE_LIMIT", "100"))

    # 处理配置
    batch_size: int = int(os.getenv("BATCH_SIZE", "1000"))
    max_workers: int = int(os.getenv("MAX_WORKERS", "4"))

    # 监控配置
    enable_metrics: bool = os.getenv("ENABLE_METRICS", "true").lower() == "true"
    metrics_port: int = int(os.getenv("METRICS_PORT", "9090"))

config = ProductionConfig()
```

## 参考链接

* [云器 Lakehouse 官方文档](https://www.yunqi.tech/)
* [unstructured-ingest-clickzetta 项目](https://github.com/yunqiqiliang/unstructured-ingest-clickzetta)
* [Unstructured 项目](https://github.com/Unstructured-IO/unstructured)

^
