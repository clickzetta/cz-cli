# Dify与云器Lakehouse集成概述

## **背景**

**Dify 平台与 Provider 架构介绍**

[Dify](https://dify.ai/)是一个开源的大语言模型（LLM）应用开发平台，结合了后端即服务（BaaS）和 LLMOps 原则。作为 "Define + Modify" 的缩写，Dify 致力于帮助开发者快速构建生产级生成式 AI 应用。

**Dify 核心特性**：

- 🚀 **快速开发**：可视化 Prompt 编排界面，支持数百种 AI 模型，完善的知识库管理
- 🔧 **技术栈完整**：内置高质量 RAG 引擎、强大的 Agent 框架和灵活的工作流
- 🌐 **开放生态**：Apache License 2.0 开源协议，支持自部署和数据控制
- 🛠️ **丰富功能**：支持多种内置工具，多种部署选项（Docker、Helm）

**Dify Provider 架构核心概念**

Dify采用Provider架构模式来实现与外部服务的解耦集成，这是一种成熟的软件设计模式，类似于云计算中的"服务提供商"概念。在Dify架构中，Provider承担以下关键角色：

**Provider 分类与职责**：

- 🤖 **Model Providers**：提供 AI 模型服务（LLM、Embedding、TTS 等）
  * 示例：OpenAI、Anthropic、Azure OpenAI、本地模型
- 🔍 **Vector Database Providers**：提供向量存储和检索服务
  * 示例：Qdrant、Milvus、Weaviate、ClickZetta（云器 Lakehouse）
- 💾 **Storage Providers**：提供文件存储服务
  * 示例：AWS S3、Azure Blob、阿里云 OSS、ClickZetta Volume（云器 Lakehouse Volume）
- 🛠️ **Tool Providers**：提供功能工具集合
  * 示例：搜索工具、API 调用工具、数据处理工具

**Provider 架构优势**：

- ✅ **标准化接口**：统一的集成方式，降低开发和维护成本
- ✅ **插拔式设计**：可以自由切换不同 Provider 而无需修改核心代码
- ✅ **扩展性强**：新 Provider 可以无侵入地集成到现有系统
- ✅ **配置灵活**：通过环境变量和配置文件灵活管理 Provider 参数
- ✅ **厂商中立**：避免 vendor lock-in，支持多云和混合云部署

**云器 Lakehouse 作为 Provider 的独特定位**

与传统单一功能的 Provider 不同，**云器 Lakehouse** 在 Dify 中扮演**多重 Provider 角色**：

1\. **Vector Database Provider**: 提供HNSW向量索引、倒排索引、混合检索

2\. **Storage Provider**: 提供Volume存储、多租户隔离、跨云兼容

3\. **Compute Provider**: 提供弹性计算、SQL查询、数据处理能力

这种"一个Provider，多重角色"的设计，正是湖仓一体架构的核心价值体现。

**云器 Lakehouse 介绍**

云器 Lakehouse（云器湖仓）是一款创新的云原生湖仓一体化数据平台，采用全托管服务模式，彻底革新企业数据管理方式。该平台基于全新的云原生设计理念从零打造，配备了自研的下一代SQL计算引擎。

**云器 Lakehouse 核心优势**：

- 🏗️ **湖仓一体**：无缝整合数据仓库、数据湖、实时处理和商业智能
- ⚡ **性能领先**：TPC-H 100GB 测试性能是 Trino 的 9.84 倍
- 🌊 **极致弹性**：Serverless 架构，秒级启停，按需扩缩，精确到秒计费
- 🤖 **AI-Native**：原生支持向量搜索、HNSW 索引和 AI 模型集成
- 🔓 **开放架构**：支持主流开源格式，无厂商锁定
- ☁️ **多云支持**：覆盖阿里云、腾讯云、AWS、GCP 等主流云平台

**云器 Lakehouse Provider 的集成价值与技术对比**

基于对 Dify 现有 Provider 生态的深入分析，云器 Lakehouse Provider 提供了独特的技术优势。目前 Dify 支持 32 种向量数据库 Provider（包括 Qdrant、Milvus、Weaviate、pgvector 等）和 17 种存储 Provider（AWS S3、Azure Blob、阿里云 OSS 等），但都是**分离式 Provider 架构**。

**传统分离式 Provider 架构 vs. ClickZetta 统一 Provider 架构**：

**现有方案的技术挑战**：

:-: ![](.topwrite/assets/image_1756879734460.png =734)

***

**关键技术差异分析**：

1\. **Provider集成复杂度**

* 传统方案：需要配置Storage Provider（S3/OSS）+ Vector Provider（Qdrant/Milvus），维护双重数据映射
* 云器Lakehouse方案：单一Provider同时提供Volume存储 + Vector索引，元数据自动同步

2\. **一体化检索能力对比**

**传统分离式方案**：

```Python
# 向量检索：Qdrant/Milvus
vector_results = qdrant_client.search(vector=query_vector, limit=top_k)

# 全文检索：需要Elasticsearch
text_results = elasticsearch.search(query=text_query)

# 混合检索：需要应用层融合
combined_results = merge_and_rank(vector_results, text_results)
```

**云器 Lakehouse 湖仓一体方案**：

```Python
# 向量检索 - HNSW索引
vector_results = client.execute("""
    SELECT content, metadata, 
           COSINE_DISTANCE(vector, CAST(? AS VECTOR(1536))) as score
    FROM dataset_table 
    ORDER BY score LIMIT ?
""", [query_vector, top_k])

# 全文检索 - 倒排索引 (中文分词)
text_results = client.execute("""
    SELECT content, metadata, SCORE(content) as score
    FROM dataset_table 
    WHERE MATCH_ALL(content, ?)
    ORDER BY score DESC LIMIT ?
""", [text_query, top_k])

# SQL Like检索 - 降级备用
like_results = client.execute("""
    SELECT content, metadata, 0.5 as score
    FROM dataset_table 
    WHERE content LIKE ?
    LIMIT ?
""", [f"%{text_query}%", top_k])

# 混合检索 - 单SQL统一处理
hybrid_results = client.execute("""
    SELECT content, metadata,
           (COSINE_DISTANCE(vector, CAST(? AS VECTOR(1536))) * 0.7 + 
            SCORE(content) * 0.3) as combined_score
    FROM dataset_table 
    WHERE MATCH_ALL(content, ?)
    ORDER BY combined_score DESC LIMIT ?
""", [query_vector, text_query, top_k])
```

3\. **性能优化策略对比**

* pgvector: 限制≤2000维度，单机HNSW索引
* Milvus: 分布式架构，需要独立集群运维
* ClickZetta: 基于CRU弹性计算，自动资源调度，TPC-H基准测试性能领先9.84倍

4\. **Provider配置跨云兼容性**

```Python
# 传统分离式Provider方案：跨云迁移需要修改多个Provider配置
# 从AWS S3迁移到阿里云OSS
STORAGE_TYPE = 's3'          # 需要改为 'aliyun-oss'
AWS_ACCESS_KEY = '...'       # 需要改为 ALIYUN_OSS_ACCESS_KEY
AWS_SECRET_KEY = '...'       # 需要改为 ALIYUN_OSS_SECRET_KEY
VECTOR_STORE = 'qdrant'      # 向量Provider可能也需要调整

# ClickZetta统一Provider方案：Volume抽象层屏蔽云存储差异
STORAGE_TYPE = 'clickzetta-volume'  # 跨云不变
VECTOR_STORE = 'clickzetta'         # 跨云不变
CLICKZETTA_VOLUME_TYPE = 'user'     # 跨云不变
# ClickZetta Provider后端自动适配底层云存储
```

^

## **目标**

**主要目标**：

* 🎯 为 Dify 提供统一的湖仓一体存储解决方案
* 🚀 实现高性能向量检索和全文搜索
* 📈 支持大规模数据集的存储和处理
* 🔧 提供完整的 Provider 集成方案
* 🛡️ 确保企业级安全和可靠性

**技术目标**：

* 基于云器Lakehouse弹性计算实现高性能向量检索
* 利用云对象存储优势支持海量文档存储
* 多租户数据隔离和权限管理
* 混合搜索(向量+全文)能力
* Serverless弹性扩展和按需计费

## **核心价值**

**对于用户**：

- 📚 **统一知识库**：文件存储、向量检索、全文搜索一体化
- 🔍 **多模式检索**：HNSW 向量检索 + 倒排索引全文检索 + SQL Like + 混合检索，满足 Dify 全场景需求
- ⚡ **弹性计算**：基于 CRU 的 Serverless 计算，秒级启停扩缩
- 🔒 **企业级安全**：完整的权限管理和数据隔离
- 💰 **成本优化**：存储计算分离，按实际使用秒级计费
- 🌐 **跨云兼容**：Lakehouse Volume 屏蔽云存储差异，跨云迁移零代码改动
