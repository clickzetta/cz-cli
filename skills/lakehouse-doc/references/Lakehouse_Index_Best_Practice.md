# 云器Lakehouse索引最佳实践指南

## 摘要

本指南为云器Lakehouse平台的索引使用提供全面的最佳实践建议。通过合理的索引策略，可以大幅提升查询效率，实现从毫秒级精确查找到智能语义搜索的全场景覆盖。

**核心收益**：

* **功能完整**：支持传统检索和AI语义搜索
* **查询优化**：多索引协同减少全表扫描
* **智能检索**：原生支持向量搜索和语义检索
* **运维简化**：提供完整的索引管理和故障排除流程

***

## 1. 概述与适用场景

### 1.1 索引类型概览

云器Lakehouse支持三种经过优化的索引类型：

| 索引类型      | 核心优势    | 最佳适用场景      | 技术特点     |
| --------- | ------- | ----------- | -------- |
| **布隆过滤器** | 快速存在性判断 | ID精确查找、快速过滤 | 概率型数据结构  |
| **倒排索引**  | 智能分词    | 全文搜索、文本检索   | 支持多语言分词  |
| **向量索引**  | 语义理解    | AI应用、相似度搜索  | HNSW算法优化 |

### 1.2 业务场景映射

**电商平台**：商品搜索（倒排索引）+ 用户画像匹配（向量索引）+ 快速过滤（布隆过滤器）

**智能客服**：知识库检索（倒排索引）+ 语义相似度（向量索引）+ 用户权限（布隆过滤器）

**内容推荐**：标签匹配（倒排索引）+ 用户偏好（向量索引）+ 实时过滤（布隆过滤器）

***

## 2. 快速入门指南

### 2.1 创建第一个多索引表

**步骤1：设计表结构**

```sql
CREATE TABLE ai_knowledge_base (
    doc_id BIGINT,
    title STRING,
    content STRING,
    category STRING,
    tags STRING,
    author_id BIGINT,
    embedding VECTOR(FLOAT, 768),
    view_count INT,
    create_time TIMESTAMP,
    update_time TIMESTAMP,
    
    -- 倒排索引：多种分词策略
    INDEX title_search_idx (title) INVERTED PROPERTIES('analyzer'='unicode'),
    INDEX content_search_idx (content) INVERTED PROPERTIES('analyzer'='chinese'),
    INDEX category_exact_idx (category) INVERTED PROPERTIES('analyzer'='keyword'),
    INDEX tags_search_idx (tags) INVERTED PROPERTIES('analyzer'='chinese'),
    
    -- 向量索引：语义相似性搜索  
    INDEX embedding_vector_idx (embedding) USING VECTOR PROPERTIES(
        'scalar.type' = 'f32',
        'distance.function' = 'cosine_distance',
        'm' = '16',
        'ef.construction' = '128'
    )
) COMMENT 'AI知识库 - 多索引融合检索';
```

**步骤2：添加布隆过滤器索引**

```sql
CREATE BLOOMFILTER INDEX doc_id_bloom_idx ON TABLE ai_knowledge_base(doc_id);
CREATE BLOOMFILTER INDEX author_id_bloom_idx ON TABLE ai_knowledge_base(author_id);
```

**步骤3：插入演示数据**

```sql
-- 插入包含embedding向量的完整演示数据
INSERT INTO ai_knowledge_base (doc_id, title, content, category, tags, author_id, embedding, view_count, create_time, update_time) VALUES

-- AI相关文档 (相似向量模式：前几维较高值)
(1001, '云器向量数据库技术深度解析', 
'云器Lakehouse提供先进的向量数据库功能，支持高维向量的存储和检索。通过HNSW算法实现高性能的近似最近邻搜索，适用于AI推荐系统、图像识别、自然语言处理等场景。向量索引支持余弦距离、欧式距离等多种相似度计算方法。', 
'技术文档', '向量数据库 AI 机器学习 HNSW算法', 2001, 
ARRAY[0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1] || ARRAY_REPEAT(0.1, 760)::ARRAY<FLOAT>, 
1250, timestamp '2024-05-20 10:00:00', timestamp '2024-05-25 15:30:00'),

(1002, 'AI大模型训练平台架构设计', 
'基于云器Lakehouse构建的AI大模型训练平台，采用分布式存储和计算架构。平台支持TB级别的训练数据管理，提供数据预处理、特征工程、模型训练、模型部署的全流程支持。集成了主流的深度学习框架如PyTorch、TensorFlow等。', 
'架构设计', 'AI 大模型 分布式训练 深度学习', 2002, 
ARRAY[0.75, 0.65, 0.55, 0.45, 0.35, 0.25, 0.15, 0.05] || ARRAY_REPEAT(0.05, 760)::ARRAY<FLOAT>, 
980, timestamp '2024-05-21 14:20:00', timestamp '2024-05-26 09:15:00'),

-- 推荐系统文档 (AI相关，向量相似)
(1003, '实时推荐系统最佳实践', 
'本文档介绍了基于云器Lakehouse的实时推荐系统实现，系统每秒处理数百万用户交互，提供亚百毫秒级个性化推荐。核心组件包括特征存储、向量相似度匹配、在线学习算法等。', 
'最佳实践', '推荐系统 实时计算 特征工程 在线学习', 2003, 
ARRAY[0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.0] || ARRAY_REPEAT(0.08, 760)::ARRAY<FLOAT>, 
2100, timestamp '2024-05-22 16:45:00', timestamp '2024-05-26 11:20:00'),

-- 搜索引擎文档 (不同向量模式：中间维度较高值)
(1004, '智能搜索引擎优化策略', 
'详细介绍了基于云器Lakehouse的智能搜索引擎实现，包括倒排索引构建、查询理解、相关性排序、个性化推荐等核心技术。系统支持中英文混合搜索，具备语义理解能力，能够处理同义词、近义词查询，提供精确且相关的搜索结果。', 
'技术文档', '搜索引擎 倒排索引 语义理解 相关性排序', 2001, 
ARRAY_REPEAT(0.1, 300)::ARRAY<FLOAT> || ARRAY[0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2] || ARRAY_REPEAT(0.1, 460)::ARRAY<FLOAT>, 
1680, timestamp '2024-05-23 13:10:00', timestamp '2024-05-26 14:45:00'),

-- 性能优化文档 (不同向量模式：后段维度较高值)
(1005, '数据湖仓一体化性能调优指南', 
'云器Lakehouse数据湖仓一体化平台的性能调优完整指南，涵盖存储优化、查询优化、索引策略、分区设计等关键技术。通过合理的数据建模和索引设计，可以将查询性能提升10-100倍。特别适用于OLAP分析、实时报表、数据挖掘等场景。', 
'性能调优', '数据湖仓 性能优化 查询加速 索引策略', 2004, 
ARRAY_REPEAT(0.05, 600)::ARRAY<FLOAT> || ARRAY[0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55] || ARRAY_REPEAT(0.1, 160)::ARRAY<FLOAT>, 
3200, timestamp '2024-05-24 11:30:00', timestamp '2024-05-26 16:00:00'),

-- 机器学习文档 (与AI相关，向量相似)
(1006, '深度学习模型部署实践', 
'云器Lakehouse平台的深度学习模型部署完整指南，支持TensorFlow、PyTorch等主流框架模型的自动化部署。包括模型版本管理、A/B测试、性能监控、弹性扩容等企业级功能。', 
'技术文档', '深度学习 模型部署 TensorFlow PyTorch', 2002, 
ARRAY[0.72, 0.62, 0.52, 0.42, 0.32, 0.22, 0.12, 0.02] || ARRAY_REPEAT(0.08, 760)::ARRAY<FLOAT>, 
890, timestamp '2024-05-25 09:30:00', timestamp '2024-05-26 10:15:00'),

-- 数据治理文档 (新分类)
(1007, '企业数据治理与安全合规', 
'基于云器Lakehouse的企业级数据治理解决方案，提供数据血缘追踪、权限管理、敏感数据脱敏、审计日志等功能。符合GDPR、SOX等国际合规标准。', 
'数据治理', '数据治理 权限管理 合规 数据安全', 2005, 
ARRAY_REPEAT(0.08, 200)::ARRAY<FLOAT> || ARRAY[0.6, 0.5, 0.4, 0.3, 0.2, 0.1] || ARRAY_REPEAT(0.05, 562)::ARRAY<FLOAT>, 
1450, timestamp '2024-05-25 14:20:00', timestamp '2024-05-26 12:30:00'),

-- 实时计算文档 (与推荐系统相关)
(1008, '流式计算引擎架构设计', 
'云器Lakehouse流式计算引擎的设计与实现，支持毫秒级数据处理延迟。可以与Kafka、Flink等组件集成，提供exactly-once语义保证和自动故障恢复能力。', 
'架构设计', '流式计算 实时处理 Kafka Flink', 2003, 
ARRAY[0.65, 0.55, 0.45, 0.35, 0.25, 0.15, 0.05, 0.0] || ARRAY_REPEAT(0.06, 760)::ARRAY<FLOAT>, 
1200, timestamp '2024-05-26 08:45:00', timestamp '2024-05-26 13:20:00');
```

**步骤4：验证数据和索引**

```sql
-- 检查数据插入情况
SELECT COUNT(*) as total_records FROM ai_knowledge_base;

-- 验证索引创建
DESC TABLE EXTENDED ai_knowledge_base;
-- 检查index字段确认所有索引已创建

-- 查看数据概览
SELECT doc_id, title, category, author_id, view_count 
FROM ai_knowledge_base 
ORDER BY doc_id;
```

### 2.2 基础查询模式

**模式1：精确ID查找（布隆过滤器）**

```sql
SELECT doc_id, title, author_id, view_count
FROM ai_knowledge_base
WHERE author_id = 2001
ORDER BY view_count DESC;

-- 预期结果：
-- doc_id: 1004, title: "智能搜索引擎优化策略", view_count: 1680
-- doc_id: 1001, title: "云器向量数据库技术深度解析", view_count: 1250
```

**模式2：分类精确匹配（keyword倒排索引）**

```sql
SELECT doc_id, title, category, view_count
FROM ai_knowledge_base 
WHERE category = '技术文档'
ORDER BY view_count DESC;

-- 预期结果：返回3条技术文档记录
```

**模式3：内容搜索（chinese倒排索引）**

```sql
SELECT doc_id, title, view_count
FROM ai_knowledge_base
WHERE content LIKE '%平台%'
ORDER BY view_count DESC;

-- 预期结果：返回包含"平台"的相关文档
```

**模式4：语义搜索（向量索引）**

```sql
-- AI语义相似度搜索
WITH query_vector AS (
  SELECT ARRAY[0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1] || ARRAY_REPEAT(0.1, 760)::ARRAY<FLOAT> as qv
)
SELECT 
    a.doc_id, 
    a.title, 
    COSINE_DISTANCE(a.embedding, q.qv) as similarity_score
FROM ai_knowledge_base a, query_vector q
WHERE a.embedding IS NOT NULL
ORDER BY similarity_score ASC
LIMIT 3;

-- 预期结果：按语义相似度排序，AI相关文档排名最前
```

***

## 3. 索引选择决策框架

### 3.1 决策树

```
查询需求分析
├── 需要精确ID查找？
│   └── YES → 布隆过滤器索引
│       ├── 单表查询 → 单布隆过滤器
│       └── 关联查询 → 多布隆过滤器
├── 需要文本内容搜索？
│   ├── 精确分类匹配 → keyword分词 + 倒排索引
│   ├── 中文内容搜索 → chinese分词 + 倒排索引
│   ├── 多语言处理 → unicode分词 + 倒排索引
│   └── 复合文本查询 → 多倒排索引组合
├── 需要语义相似搜索？
│   └── YES → 向量索引 + 其他索引过滤
└── 复杂业务查询？
    └── 多索引融合策略
```

### 3.2 分词器选择指南

**实际分词效果对比**：

```sql
-- 验证不同分词器效果
SELECT 
    'chinese' as analyzer,
    TOKENIZE('云器Lakehouse数据湖仓平台', map('analyzer', 'chinese')) as tokens
UNION ALL
SELECT 
    'unicode' as analyzer,
    TOKENIZE('云器Lakehouse数据湖仓平台', map('analyzer', 'unicode')) as tokens  
UNION ALL
SELECT 
    'keyword' as analyzer,
    TOKENIZE('云器Lakehouse数据湖仓平台', map('analyzer', 'keyword')) as tokens;
```

**实际分词结果**：

| 分词器       | 分词结果                                            | 最佳应用场景   |
| --------- | ----------------------------------------------- | -------- |
| `chinese` | `["云器", "lakehouse", "数据", "湖仓", "平台"]`         | 中文内容智能搜索 |
| `unicode` | `["云", "器", "lakehouse", "数据", "湖", "仓", "平台"]` | 多语言标题搜索  |
| `keyword` | `["云器Lakehouse数据湖仓平台"]`                         | 分类标签精确匹配 |

**选择原则**：

* **category、status字段** → keyword（精确匹配，零开销）
* **中文content、description** → chinese（智能分词，语义理解）
* **混合语言title、name** → unicode（通用支持，细粒度搜索）

***

## 4. 高级查询模式与优化

### 4.1 多索引融合查询

**场景：AI智能检索系统**

```sql
-- 向量语义搜索 + 倒排索引过滤 + 布隆过滤器
WITH query_vector AS (
  SELECT ARRAY[0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1] || ARRAY_REPEAT(0.1, 760)::ARRAY<FLOAT> as qv
)
SELECT 
    a.doc_id, 
    a.title, 
    a.category,
    a.view_count,
    COSINE_DISTANCE(a.embedding, q.qv) as similarity_score
FROM ai_knowledge_base a, query_vector q
WHERE a.category IN ('技术文档', '最佳实践', '架构设计')  -- 倒排索引分类过滤
AND a.embedding IS NOT NULL  
AND a.view_count > 500  -- 质量筛选
ORDER BY similarity_score ASC  -- 语义相似度优先
LIMIT 5;

-- 预期结果：返回语义最相关的高质量文档
```

### 4.2 演示数据详细说明

**数据集概览**：8篇技术文档，涵盖5个分类，5位作者，所有文档都包含768维embedding向量

| 分类       | 文档数 | 代表性文档                 | 平均浏览量 |
| -------- | --- | --------------------- | ----- |
| **技术文档** | 3篇  | 云器向量数据库、智能搜索引擎、深度学习部署 | 1,273 |
| **架构设计** | 2篇  | AI大模型训练平台、流式计算引擎      | 1,090 |
| **最佳实践** | 1篇  | 实时推荐系统                | 2,100 |
| **数据治理** | 1篇  | 企业数据治理与安全合规           | 1,450 |
| **性能调优** | 1篇  | 数据湖仓一体化性能调优           | 3,200 |

**向量设计说明**：

* **AI相关文档**(1001,1002,1003,1006): 前几维度数值较高，形成相似向量模式
* **搜索引擎文档**(1004): 中间维度较高，向量模式差异化
* **性能调优文档**(1005): 后段维度较高，便于验证向量相似度搜索效果

这种设计确保了向量搜索的可验证性：AI相关主题的文档会聚集在一起，而不同主题的文档有明显的向量差异。

### 4.3 分层查询架构

```
查询请求
    ↓
⚡ 布隆过滤器
（快速过滤，排除大量不相关数据）
    ↓
🔍 keyword倒排索引
（精确分类匹配）
    ↓
📝 chinese/unicode倒排索引
（智能文本搜索）
    ↓
🎯 向量索引
（语义相似度计算）
    ↓
📊 业务条件过滤
（范围查询、排序、分页）
    ↓
🎉 最终结果集
```

***

## 5. 索引管理与配置

### 5.1 索引管理操作

**创建索引最佳实践**：

< date '2024-02-01';
```

**索引状态检查**：

```sql
-- 查看完整索引信息
DESC TABLE EXTENDED your_table_name;

-- 查看表创建语句
SHOW CREATE TABLE your_table_name;

-- 检查索引列表
SHOW INDEX FROM your_table_name;
```

### 5.2 向量索引参数配置

**向量索引参数详解**：

| 参数                    | 推荐值        | 影响因素     | 使用建议              |
| --------------------- | ---------- | -------- | ----------------- |
| `m`                   | 16-64      | 精度vs内存   | 精度要求高用32+，性能优先用16 |
| `ef.construction`     | 128-512    | 构建质量vs时间 | 生产环境推荐256+        |
| `scalar.type`         | f32/f16    | 精度vs存储   | 一般用f32，大规模用f16    |
| `distance.function`   | cosine/l2  | 语义vs空间距离 | 文本用cosine，图像用l2   |
| `compress.codec`      | zstd/none  | 存储vs计算   | 存储敏感用zstd         |
| `reuse.vector.column` | true/false | 存储优化     | 大规模部署推荐true       |

**高精度 vs 高性能配置对比**：

```sql
-- 高精度场景配置（适用于对准确性要求高的AI应用）
CREATE VECTOR INDEX high_precision_idx ON TABLE vectors(embedding)
PROPERTIES(
    'scalar.type' = 'f32',
    'distance.function' = 'cosine_distance',
    'm' = '32',                    -- 增加邻居数提升精度
    'ef.construction' = '256',     -- 增加候选集提升质量
    'compress.codec' = 'zstd'      -- 启用压缩节省空间
);

-- 高性能场景配置（适用于对速度要求高的实时应用）
CREATE VECTOR INDEX high_speed_idx ON TABLE vectors(embedding)
PROPERTIES(
    'scalar.type' = 'f16',         -- 半精度减少内存占用
    'distance.function' = 'l2_distance',
    'm' = '16',                    -- 减少邻居数提升速度
    'ef.construction' = '128',
    'reuse.vector.column' = 'true' -- 复用列数据节省存储
);
```

***

## 6. 常见问题与故障排除

### 6.1 索引创建问题

**问题1：向量索引创建失败**

```
错误信息：向量维度不匹配
解决方案：检查VECTOR(FLOAT, n)定义与实际数据维度是否一致
```

**问题2：布隆过滤器不生效**

```
原因：布隆过滤器仅对新数据生效，不支持BUILD INDEX
解决方案：对于存量数据，考虑使用倒排索引替代
```

**问题3：中文分词效果不佳**

```
原因：使用了错误的分词器
解决方案：中文内容使用'analyzer'='chinese'，精确匹配使用'keyword'

-- 验证分词效果
SELECT TOKENIZE('测试文本', map('analyzer', 'chinese')) as chinese_tokens,
       TOKENIZE('测试文本', map('analyzer', 'keyword')) as keyword_tokens;
```

**问题4：向量函数不可用**

```
错误信息：COSINE_DISTANCE函数未找到
解决方案：确认版本支持，验证函数可用性

-- 验证向量函数
SELECT COSINE_DISTANCE(
    ARRAY[0.1, 0.2, 0.3]::ARRAY<FLOAT>

### 5.2 查询优化问题

**诊断流程**：

1. 使用EXPLAIN分析查询计划
2. 检查索引是否被正确使用
3. 分析数据分布和倾斜情况
4. 评估索引选择性

**优化策略**：

```sql
-- 避免的反模式
WHERE UPPER(category) = 'TECH'           -- 函数调用破坏索引
WHERE CAST(id AS STRING) = '123'         -- 类型转换影响性能
WHERE content LIKE '%keyword%keyword%'   -- 复杂模式匹配

-- 推荐的写法
WHERE category = 'tech'                  -- 直接匹配，预处理数据统一格式
WHERE id = 123                          -- 类型匹配
WHERE content LIKE '%keyword%'          -- 简单模式
```

### 5.3 故障排除检查清单

**索引健康检查**：

* [ ] 所有高频查询字段都有对应索引
* [ ] 索引类型与查询模式匹配
* [ ] 分词器选择符合数据特点
* [ ] 向量索引参数配置合理
* [ ] 索引存储空间在可接受范围内

**功能问题排查**：

* [ ] 查询条件顺序是否优化
* [ ] 是否存在全表扫描
* [ ] 索引选择性是否足够高
* [ ] 数据倾斜是否影响查询
* [ ] 系统资源是否充足

***

## 7. 进阶应用场景

### 7.1 企业知识库系统

**架构设计**：

<= ?                    -- 权限控制
AND d.department IN (?, ?, ?)               -- 部门过滤
AND d.content LIKE ?                        -- 关键词匹配
AND d.status = 'published'                  -- 状态筛选
ORDER BY relevance ASC, d.view_count DESC
LIMIT 20;
```

### 7.2 实时推荐引擎

**用户画像匹配**：

```sql
-- 基于向量相似度的个性化推荐
WITH user_profile AS (
    SELECT embedding FROM user_vectors WHERE user_id = ?
)
SELECT p.product_id, p.title, 
       COSINE_DISTANCE(p.embedding, u.embedding) as match_score
FROM products p, user_profile u
WHERE p.category_id IN (?)                   -- 兴趣分类
AND p.price_range = ?                       -- 价格区间
AND p.rating >

### 7.2 智能客服系统

**问题相似度匹配**：

```sql
-- FAQ智能匹配
WITH question_vector AS (
    SELECT get_text_embedding(?) as qv
)
SELECT f.faq_id, f.question, f.answer,
       COSINE_DISTANCE(f.question_embedding, q.qv) as similarity
FROM faq_database f, question_vector q
WHERE f.category = ?                         -- 问题分类
AND f.status = 'active'                     -- 有效状态
AND similarity < 0.3                        -- 相似度阈值
ORDER BY similarity ASC
LIMIT 5;
```

***

## 8. 总结与建议

### 8.1 核心最佳实践

1. **分层设计**：布隆过滤器→倒排索引→向量索引，按效率递减顺序组合
2. **精准选择**：根据查询模式选择最适合的索引类型和参数
3. **渐进优化**：从基础索引开始，根据业务发展逐步引入高级功能
4. **持续监控**：建立完善的监控体系，及时发现和解决问题

### 8.2 实施路径

**第一阶段：基础索引**

* 布隆过滤器：实现快速ID查找
* keyword倒排索引：支持精确分类匹配

**第二阶段：智能搜索**

* chinese/unicode倒排索引：智能文本检索
* 多索引组合：提升查询精度

**第三阶段：AI赋能**

* 向量索引：语义搜索能力
* 融合检索：传统索引+AI技术

***

## 附录

### A. 参考命令速查

```sql
-- 创建索引
CREATE BLOOMFILTER INDEX idx_name ON TABLE table_name(column);
CREATE INVERTED INDEX idx_name ON TABLE table_name(column) PROPERTIES('analyzer'='chinese');
CREATE VECTOR INDEX idx_name ON TABLE table_name(column) PROPERTIES(...);

-- 管理索引
BUILD INDEX idx_name ON table_name;
DROP INDEX idx_name;
SHOW INDEX FROM table_name;

-- 查询优化
TOKENIZE('text', map('analyzer', 'chinese'));
COSINE_DISTANCE(vector1, vector2);
ARRAY_REPEAT(value, count);

-- 表管理
DESC TABLE EXTENDED table_name;
SHOW CREATE TABLE table_name;
SELECT COUNT(*) FROM table_name;
```

### B. 完整验证清单

**环境准备验证**：

* [ ] 表创建成功：`DESC TABLE ai_knowledge_base`
* [ ] 索引创建完整：检查返回的index字段包含所有索引
* [ ] 数据插入成功：`SELECT COUNT(*) FROM ai_knowledge_base` 返回8
* [ ] 向量数据正确：`SELECT doc_id, ARRAY_SIZE(embedding) FROM ai_knowledge_base LIMIT 1` 返回768

**功能验证测试**：

* [ ] 布隆过滤器：`WHERE author_id = 2001` 快速响应
* [ ] keyword索引：`WHERE category = '技术文档'` 精确匹配
* [ ] chinese索引：`WHERE content LIKE '%平台%'` 中文搜索
* [ ] 向量索引：COSINE\_DISTANCE查询正常执行
* [ ] 分词功能：TOKENIZE函数返回正确结果
* [ ] BUILD INDEX：返回OPERATION SUCCEED

### C. 故障联系方式

遇到技术问题时，请提供以下信息：

* 表结构和索引定义
* 查询语句和执行计划
* 错误信息和日志
* 数据量规模

***

## D. 环境清理指南

完成演示和学习后，可以按以下步骤清理创建的资源：

### 清理演示环境

```sql
-- 1. 清理主演示表（包含所有索引）
DROP TABLE IF EXISTS ai_knowledge_base;

-- 2. 清理可能创建的测试表
DROP TABLE IF EXISTS production_table;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS vectors;
DROP TABLE IF EXISTS enterprise_docs;

-- 3. 验证清理结果
SHOW TABLES LIKE '%knowledge%';
SHOW TABLES LIKE '%production%';
```

### 批量清理脚本

```sql
-- 安全清理脚本（带确认）
-- 查看当前schema中的所有表
SHOW TABLES;

-- 清理特定前缀的表
DROP TABLE IF EXISTS ai_knowledge_base;
DROP TABLE IF EXISTS test_table_1;
DROP TABLE IF EXISTS demo_table_2;
-- 根据实际创建的表名进行调整

-- 清理临时schema（如果创建了专门的测试schema）
-- DROP SCHEMA IF EXISTS index_demo;
```

### 清理注意事项

**重要提醒**：

* 删除表会同时删除表上的所有索引
* 在生产环境中执行清理操作前请务必确认
* 建议先备份重要数据再执行清理
* 如果使用了自定义schema，可选择保留或删除


^

\*\*参考文档\*\*:

\- \[创建向量索引]\(create-vector-index.md)

\- \[创建倒排索引]\(create-inverted-index.md)&#x20;

\- \[创建布隆过滤器索引]\(CREATE-BLOOMFILTER-INDEX.md)

\- \[构建索引]\(build-inverted-index.md)

\- \[查看索引]\(SHOW-INDEX.md)
