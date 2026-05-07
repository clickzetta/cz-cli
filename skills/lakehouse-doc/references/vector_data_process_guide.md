# Lakehouse VECTOR数据处理使用指南

## 向量数据的原生支持与实践

***

## 写在前面

### 您可能遇到的向量数据处理场景

#### 场景1：文档相似度检索系统

**当前在 Hive/Spark 中的常见做法**：

```sql
-- 在Hive中存储文档向量
CREATE TABLE document_embeddings (
    doc_id STRING,
    title STRING, 
    content STRING,
    embedding ARRAY<DOUBLE>  -- 存储LLM生成的向量
) PARTITIONED BY (dt STRING);

-- 相似度计算需要复杂的UDF
CREATE FUNCTION cosine_similarity_udf(vec1 ARRAY<DOUBLE>, vec2 ARRAY<DOUBLE>) 
RETURNS DOUBLE
LANGUAGE PYTHON AS $
import numpy as np
def cosine_similarity_udf(vec1, vec2):
    return np.dot(vec1, vec2) / (np.linalg.norm(vec1) * np.linalg.norm(vec2))
$;

-- 查询需要手动维度检查和UDF调用
SELECT doc_id, title,
    cosine_similarity_udf(embedding, array(0.1, 0.2, 0.3, ...)) as score
FROM document_embeddings 
WHERE size(embedding) = 1536  -- 手动维度检查
    AND dt >= '2024-01-01'
ORDER BY score DESC 
LIMIT 10;
```

**面临的技术挑战**：

* **实现复杂**：需要自定义UDF实现距离计算函数
* **无专门索引**：数组类型无法建立针对相似度的索引
* **类型安全问题**：数组长度不固定，容易出现维度不匹配错误
* **性能限制**：大规模向量计算时缺乏专门优化

#### 场景2：推荐系统用户特征匹配

**在 Spark 中的典型实现**：

```python
# Spark中的用户向量相似度计算
from pyspark.sql.functions import *
from pyspark.ml.linalg import Vectors

# 需要自定义函数实现相似度计算
def cosine_similarity_udf(vec1, vec2):
    from pyspark.ml.linalg import Vectors
    import numpy as np
    v1 = np.array(vec1)
    v2 = np.array(vec2)
    return float(np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2)))

# 注册UDF
cosine_udf = udf(cosine_similarity_udf, DoubleType())

# 查询相似用户
similar_users = user_features.crossJoin(user_features.alias("other")) \
    .filter(col("user_id") != col("other.user_id")) \
    .withColumn("similarity", cosine_udf(col("features"), col("other.features"))) \
    .filter(col("similarity") > 0.8) \
    .orderBy(desc("similarity"))
```

**常见的技术痛点**：

* **架构复杂**：向量计算与数据存储分离，增加系统复杂度
* **开发成本**：需要实现和维护自定义的相似度计算逻辑
* **性能瓶颈**：大规模向量计算时缺乏专门的加速机制
* **错误处理**：缺乏对向量维度的编译时检查

### 为什么需要向量数据类型

基于以上场景中的技术挑战，VECTOR数据类型的设计目标是：

**解决类型安全问题**：

* 提供固定维度的向量类型定义
* 编译时进行维度匹配检查
* 避免运行时的维度不匹配错误

**简化开发流程**：

* 内置常用的向量距离计算函数
* 无需编写和维护自定义UDF
* 与标准SQL语法完全兼容

**提升查询性能**：

* 支持专门的向量索引
* 针对向量计算进行优化
* 支持高效的相似度检索

### 如何使用这份指南

| 读者角色    | 建议阅读重点             | 预期收获            |
| ------- | ------------------ | --------------- |
| 数据工程师   | 类型定义 → 函数使用 → 避坑指南 | 掌握VECTOR的正确使用方法 |
| 系统架构师   | 应用场景 → 性能优化 → 迁移策略 | 获得架构设计和迁移规划参考   |
| AI应用开发者 | 快速开始 → 应用模式 → 查询限制 | 了解AI场景下的最佳实践    |

***

## ⚡ 快速开始

### 基本使用流程

```sql
-- 1. 创建包含向量列的表
CREATE TABLE document_embeddings (
    id BIGINT,
    content STRING,
    embedding VECTOR(FLOAT, 1536)  -- 1536维浮点向量
);

-- 2. 插入向量数据
INSERT INTO document_embeddings VALUES 
(1, '人工智能技术发展', vector(0.1, 0.2, 0.3, ...));  -- 需要提供完整的1536维数据

-- 3. 创建向量索引
CREATE VECTOR INDEX embedding_idx ON TABLE document_embeddings(embedding) 
PROPERTIES(
    "distance.function" = "cosine_distance",
    "scalar.type" = "f32"
);

-- 4. 构建索引（对已有数据）
BUILD INDEX embedding_idx ON document_embeddings;

-- 5. 执行相似度查询（推荐模式）
SELECT id, content FROM document_embeddings 
WHERE COSINE_DISTANCE(embedding, vector(0.1, 0.2, 0.3, ...)) < 0.8
ORDER BY id LIMIT 10;
```

***

## 🆚 技术对比：ARRAY vs VECTOR

### 传统ARRAY实现方式

```sql
-- 使用ARRAY存储向量
CREATE TABLE docs_array (
    content STRING,
    embedding ARRAY<DOUBLE>
);

-- 需要自定义函数实现相似度计算
CREATE FUNCTION cosine_similarity(vec1 ARRAY<DOUBLE>, vec2 ARRAY<DOUBLE>) 
RETURNS DOUBLE
LANGUAGE PYTHON AS $$
def cosine_similarity(vec1, vec2):
    import numpy as np
    return np.dot(vec1, vec2) / (np.linalg.norm(vec1) * np.linalg.norm(vec2))
$$;

-- 查询需要函数调用，且需要手动检查维度
SELECT doc_id, cosine_similarity(embedding, array(0.1, 0.2, ...)) as score
FROM docs_array
WHERE array_size(embedding) = 1536  -- 需要手动维度检查
ORDER BY score DESC;
```

### VECTOR原生实现方式

```sql
-- 使用VECTOR类型
CREATE TABLE docs_vector (
    content STRING,
    embedding VECTOR(FLOAT, 1536),  -- 类型和维度明确定义
    
    INDEX embedding_idx (embedding) USING VECTOR PROPERTIES (
        "distance.function" = "cosine_distance"
    )
);

-- 使用内置函数，维度自动检查
SELECT doc_id FROM docs_vector 
WHERE COSINE_DISTANCE(embedding, vector(0.1, 0.2, ...)) < 0.8
ORDER BY doc_id LIMIT 10;
```

### 功能特性对比

| 特性    | ARRAY方案   | VECTOR方案 | 对用户的影响    |
| ----- | --------- | -------- | --------- |
| 类型安全  | 运行时检查     | 编译时检查    | 减少生产环境错误  |
| 维度控制  | 手动验证      | 类型定义保证   | 避免维度不匹配问题 |
| 距离计算  | 自定义UDF    | 内置函数     | 减少代码开发和维护 |
| 索引支持  | 无专门索引     | 向量索引     | 改善大规模查询性能 |
| 开发复杂度 | 需要实现计算逻辑  | 直接使用内置函数 | 降低技术门槛    |
| 维护成本  | 需要维护UDF代码 | 数据库原生支持  | 减少运维工作量   |

### 从Spark MLlib迁移的对照

| Spark MLlib API          | CloudZetta VECTOR               | 迁移复杂度 | 说明           |
| ------------------------ | ------------------------------- | ----- | ------------ |
| `Vectors.dense(array)`   | `vector(v1, v2, ...)`           | 简单    | 直接函数替换       |
| `Vectors.norm(v, 2)`     | `L2_DISTANCE(v, vector(0,...))` | 中等    | 需要提供零向量      |
| 自定义cosine UDF            | `COSINE_DISTANCE(v1, v2)`       | 简单    | 删除UDF，使用内置函数 |
| 自定义normalize UDF         | `L2_NORMALIZE(v)`               | 简单    | 删除UDF，使用内置函数 |
| `Vectors.sqdist(v1, v2)` | `POW(L2_DISTANCE(v1, v2), 2)`   | 简单    | 组合内置函数       |

***

## 📊 VECTOR数据类型规范

### 类型定义语法

```sql
VECTOR(scalar_type, dimension)
```

### 支持的标量类型

| 标量类型    | 存储大小  | 数值范围       | 适用场景              | 索引支持  |
| ------- | ----- | ---------- | ----------------- | ----- |
| FLOAT   | 4字节/维 | 32位浮点数     | 通用向量存储，如embedding | ✅ f32 |
| INT     | 4字节/维 | 32位整数      | 整数特征向量，如计数        | ❌     |
| TINYINT | 1字节/维 | -128 到 127 | 压缩存储，如二进制向量       | ✅ i8  |

> **💡 建议**：生产环境推荐使用FLOAT类型，兼容性和性能最佳

### 向量创建方法

```sql
-- 直接创建向量
SELECT vector(1.0, 2.0, 3.0);              -- 创建3维浮点向量
SELECT vector(1, 2, 3);                     -- 创建3维整数向量

-- 从其他类型转换
SELECT cast(array(1,2,3) as VECTOR(INT, 3));     -- 数组转向量
SELECT cast('[1,2,3]' as VECTOR(INT, 3));        -- JSON字符串转向量

-- 在表定义中使用
CREATE TABLE feature_vectors (
    id BIGINT,
    dense_features VECTOR(FLOAT, 128),       -- 稠密特征
    sparse_features VECTOR(INT, 1000)        -- 稀疏特征
);
```

***

## 🧮 向量函数

### 距离计算函数

#### L2\_DISTANCE - 欧几里得距离

```sql
SELECT L2_DISTANCE(vector(1,2,3), vector(4,5,6)) as euclidean_distance;
-- 结果：5.196152210235596
```

**计算公式**：√(Σ(ai - bi)²)
**适用场景**：空间数据分析、聚类算法、图像特征匹配

#### COSINE\_DISTANCE - 余弦距离

```sql
SELECT COSINE_DISTANCE(vector(1,2,3), vector(4,5,6)) as cosine_distance;
-- 结果：0.025368213653564453
```

**计算公式**：1 - (a·b)/(|a|×|b|)
**适用场景**：文本语义相似度、推荐系统、信息检索

#### DOT\_PRODUCT - 点积

```sql
SELECT DOT_PRODUCT(vector(1,2,3), vector(4,5,6)) as dot_product;
-- 结果：32.0
```

**计算公式**：Σ(ai × bi)
**适用场景**：相关性计算、神经网络权重计算

### 向量处理函数

#### L2\_NORMALIZE - 向量归一化

```sql
-- ⚠️ 重要：必须使用浮点数向量
SELECT L2_NORMALIZE(vector(3.0, 4.0)) as normalized_vector;
-- 结果：[0.6, 0.8]

-- ❌ 错误示例：整数向量可能导致精度问题
SELECT L2_NORMALIZE(vector(3, 4)) as normalized_vector;
-- 可能结果：[0, 0]
```

**功能**：将向量标准化为单位长度（L2范数为1）
**适用场景**：余弦相似度计算的预处理

### 函数使用注意事项

* 所有距离函数要求输入向量维度相同，否则会报编译时错误
* 函数支持向量类型与数组类型的混合计算
* 归一化函数返回相同维度的向量类型
* **L2\_NORMALIZE函数对数据类型敏感，建议使用浮点数向量**

***

## 🔄 类型转换与兼容性

### 自动类型转换

```sql
-- 向量可以隐式转换为数组用于数组操作
SELECT array_size(vector(1,2,3,4)) as vector_size;
-- 结果：4

-- 数组可以在向量函数中使用
SELECT L2_DISTANCE(array(1,2,3), vector(1,2,3)) as distance;
-- 结果：0.0
```

### 显式类型转换

```sql
-- 数组转向量（维度必须匹配）
SELECT cast(array(1.0, 2.0, 3.0) as VECTOR(FLOAT, 3));
-- 结果：[1.0, 2.0, 3.0]

-- JSON字符串转向量
SELECT cast('[1,2,3]' as VECTOR(INT, 3));
-- 结果：[1, 2, 3]

-- 维度不匹配时返回NULL
SELECT cast(array(1,2) as VECTOR(INT, 3));  -- 返回NULL
```

### SQL操作支持

向量类型支持标准的SQL操作：

```sql
-- 排序
SELECT * FROM vectors ORDER BY feature_vector;

-- 分组
SELECT feature_vector, COUNT(*) FROM vectors GROUP BY feature_vector;

-- 比较
SELECT * FROM vectors WHERE feature_vector = vector(1,2,3);

-- 去重
SELECT DISTINCT feature_vector FROM vectors;
```

***

## 🏗️ 向量索引

### 索引配置参数

| 参数名称              | 可选值                                                                  | 默认值              | 说明           |
| ----------------- | -------------------------------------------------------------------- | ---------------- | ------------ |
| distance.function | cosine\_distance, l2\_distance, jaccard\_distance, hamming\_distance | cosine\_distance | 距离函数类型       |
| scalar.type       | f32, f16, i8, b1                                                     | f32              | 索引中向量元素的存储类型 |
| M                 | 正整数                                                                  | 16               | HNSW算法的最大连接数 |
| ef\_construction  | 正整数                                                                  | 200              | 索引构建时的候选集大小  |

> **⚠️ 重要**：参数名称必须使用完整形式，如`cosine_distance`而非`cosine`

### 索引创建和管理

```sql
-- 创建向量索引（推荐语法）
CREATE VECTOR INDEX embedding_idx ON TABLE table_name(vector_column) 
PROPERTIES(
    "distance.function" = "cosine_distance",  -- 完整函数名
    "scalar.type" = "f32",                   -- 标准类型名
    "M" = 16,
    "ef_construction" = 200
);

-- 为已有数据构建索引
BUILD INDEX embedding_idx ON table_name;

-- 查看索引状态
SHOW INDEXES ON table_name;

-- 删除索引
DROP INDEX embedding_idx ON table_name;
```

### 索引性能调优

不同参数配置的性能特点：

| 配置场景 | M值 | ef\_construction | scalar.type | 特点              |
| ---- | -- | ---------------- | ----------- | --------------- |
| 快速检索 | 8  | 64               | f16         | 较低的构建时间和内存使用    |
| 平衡配置 | 16 | 200              | f32         | 平衡的精度和性能        |
| 高精度  | 32 | 400              | f32         | 更高的检索精度，较高的资源消耗 |

***

## 🚀 主流AI模型适配

### 常见Embedding模型的向量维度

| 模型提供商  | 模型名称                       | 维度   | 建议配置                |
| ------ | -------------------------- | ---- | ------------------- |
| OpenAI | text-embedding-3-small     | 1536 | VECTOR(FLOAT, 1536) |
| OpenAI | text-embedding-3-large     | 3072 | VECTOR(FLOAT, 3072) |
| Google | Universal Sentence Encoder | 512  | VECTOR(FLOAT, 512)  |
| 百度     | ERNIE-Embed                | 768  | VECTOR(FLOAT, 768)  |
| 智谱     | GLM-Embedding              | 1024 | VECTOR(FLOAT, 1024) |

### 多模态模型支持

| 模型类型               | 典型维度     | 应用场景       |
| ------------------ | -------- | ---------- |
| CLIP               | 512/768  | 图文匹配、多模态检索 |
| BLIP               | 768      | 图像问答、视觉理解  |
| Vision Transformer | 768/1024 | 图像分类、特征提取  |

***

## 💡 应用场景设计

### 文档检索系统

```sql
-- 知识库表设计
CREATE TABLE knowledge_base (
    doc_id BIGINT PRIMARY KEY,
    title STRING,
    content STRING,
    embedding VECTOR(FLOAT, 1536),
    created_at TIMESTAMP,
    
    INDEX doc_embedding_idx (embedding) USING VECTOR PROPERTIES (
        "scalar.type" = "f32",
        "distance.function" = "cosine_distance"
    )
);

-- 语义检索查询（推荐模式）
SELECT doc_id, title FROM knowledge_base 
WHERE COSINE_DISTANCE(embedding, ?) < 0.7
ORDER BY doc_id LIMIT 10;
```

### 推荐系统

```sql
-- 用户特征表
CREATE TABLE user_profiles (
    user_id BIGINT PRIMARY KEY,
    behavior_vector VECTOR(FLOAT, 128),
    preference_vector VECTOR(FLOAT, 64),
    last_updated TIMESTAMP,
    
    INDEX behavior_idx (behavior_vector) USING VECTOR PROPERTIES (
        "distance.function" = "cosine_distance"
    )
);

-- 物品特征表
CREATE TABLE item_features (
    item_id BIGINT PRIMARY KEY,
    content_vector VECTOR(FLOAT, 256),
    category_vector VECTOR(INT, 50),
    
    INDEX content_idx (content_vector) USING VECTOR PROPERTIES (
        "distance.function" = "cosine_distance"
    )
);

-- 相似用户查找（推荐查询模式）
SELECT target.user_id as similar_user FROM user_profiles source
CROSS JOIN user_profiles target
WHERE source.user_id = ?
    AND target.user_id != source.user_id
    AND COSINE_DISTANCE(source.behavior_vector, target.behavior_vector) < 0.6
ORDER BY target.user_id LIMIT 20;
```

### 图像特征匹配

```sql
-- 图像特征库
CREATE TABLE image_features (
    image_id BIGINT PRIMARY KEY,
    image_path STRING,
    visual_features VECTOR(FLOAT, 2048),
    semantic_features VECTOR(FLOAT, 512),
    upload_time TIMESTAMP,
    
    INDEX visual_idx (visual_features) USING VECTOR PROPERTIES (
        "distance.function" = "l2_distance",
        "scalar.type" = "f16"
    ),
    INDEX semantic_idx (semantic_features) USING VECTOR PROPERTIES (
        "distance.function" = "cosine_distance"
    )
);

-- 相似图像检索
SELECT image_id, image_path FROM image_features
WHERE L2_DISTANCE(visual_features, ?) < 100.0
ORDER BY image_id LIMIT 50;
```

***

## ⚠️ 重要避坑指南

### 🚨 向量查询限制

经过UAT环境实际测试，发现两种不同的错误模式：

#### 1. 维度不匹配错误（预期行为）

```sql
-- ❌ 错误示例：使用5维向量查询128维数据
SELECT id FROM embeddings_table 
WHERE COSINE_DISTANCE(embedding_128d, vector(0.1, 0.2, 0.3, 0.4, 0.5)) < 0.8;

-- 错误信息：
-- function 'COSINE_DISTANCE' cannot be resolved, 
-- expect 'vector shall have the same dimension'
```

**解决方法**：确保查询向量与表中向量维度完全一致

#### 2. Generated Column内部错误（当前限制）

```sql
-- ❌ 问题查询：在SELECT中返回距离计算
SELECT id, content,
    COSINE_DISTANCE(embedding, vector(...)) as distance
FROM embeddings_table 
ORDER BY distance LIMIT 10;

-- 可能错误：
-- Generated column 4292967295(generated_field_4292967295) is not filled for VECTOR
```

**当前可用的查询模式**：

```sql
-- ✅ 推荐：WHERE子句中的向量过滤
SELECT id, content FROM embeddings_table 
WHERE COSINE_DISTANCE(embedding, vector(...)) < 0.8
ORDER BY id LIMIT 10;

-- ✅ 可用：简单的向量函数
SELECT COSINE_DISTANCE(embedding, embedding) as self_distance
FROM embeddings_table;

-- ❌ 避免：复杂的SELECT返回距离计算并排序
```

### 🛠️ 函数使用避坑

#### L2\_NORMALIZE函数类型要求

```sql
-- ✅ 正确：使用浮点数向量
SELECT L2_NORMALIZE(vector(3.0, 4.0)) as normalized;
-- 结果：[0.6, 0.8]

-- ❌ 错误：使用整数向量
SELECT L2_NORMALIZE(vector(3, 4)) as normalized;
-- 可能结果：[0, 0] （精度丢失）
```

#### 索引参数规范

```sql
-- ✅ 正确：使用完整参数名
CREATE VECTOR INDEX idx ON TABLE t(col) PROPERTIES(
    "distance.function" = "cosine_distance",  -- 完整函数名
    "scalar.type" = "f32"                    -- 标准类型名
);

-- ❌ 错误：使用简化名称
CREATE VECTOR INDEX idx ON TABLE t(col) PROPERTIES(
    "distance.function" = "cosine",          -- 会报错
    "scalar.type" = "float"                  -- 会报错
);
```

### 🎯 最佳实践建议

#### 查询模式选择

| 使用场景    | 推荐模式                                     | 避免模式                            |
| ------- | ---------------------------------------- | ------------------------------- |
| 相似度过滤   | `WHERE COSINE_DISTANCE(...) < threshold` | `ORDER BY COSINE_DISTANCE(...)` |
| Top-K检索 | WHERE过滤 + 简单排序                           | 距离计算 + 排序                       |
| 批量计算    | 分步骤查询                                    | 复杂嵌套查询                          |

#### 性能优化策略

```sql
-- ✅ 推荐：利用索引的过滤查询
SELECT doc_id, title FROM knowledge_base 
WHERE COSINE_DISTANCE(embedding, ?) < 0.7
ORDER BY doc_id LIMIT 10;

-- ✅ 可选：分步骤的Top-K检索
-- 步骤1：过滤候选
CREATE VIEW candidates AS 
SELECT doc_id, title FROM knowledge_base 
WHERE COSINE_DISTANCE(embedding, ?) < 0.8;

-- 步骤2：精确排序（如需要）
SELECT doc_id, title FROM candidates ORDER BY doc_id LIMIT 10;
```

***

## 🔄 迁移策略

### 迁移价值评估

在决定是否迁移到VECTOR类型之前，建议先评估您的使用场景：

#### 高价值迁移场景

* **频繁的向量相似度计算**：如推荐系统、文档检索、图像匹配
* **大规模向量数据**：超过百万级别的向量数据查询
* **复杂的UDF维护**：当前需要维护多个自定义向量计算函数
* **性能要求高**：对查询响应时间有严格要求的应用

#### 可选迁移场景

* **偶尔的向量计算**：向量计算不是核心业务流程
* **小规模数据**：向量数据量较小，性能压力不大
* **稳定的现有系统**：当前系统运行稳定，改动风险大于收益

### 针对不同用户的迁移建议

#### Spark用户迁移路径

**如果您主要使用Spark MLlib进行向量计算**：

```python
# 原Spark代码
from pyspark.ml.linalg import Vectors, VectorUDT
from pyspark.sql.functions import udf

# 自定义相似度函数
def cosine_similarity(v1, v2):
    # 复杂的实现逻辑
    pass

# 注册UDF
cosine_udf = udf(cosine_similarity, DoubleType())
```

**迁移到CloudZetta VECTOR后**：

```sql
-- 直接使用内置函数和推荐查询模式
SELECT user_id FROM user_features
WHERE COSINE_DISTANCE(user_vector, target_vector) < 0.8;
```

**迁移收益**：

* 删除自定义UDF代码
* 利用向量索引加速查询
* 统一在SQL中处理向量计算

#### Hive用户迁移路径

**如果您在Hive中使用ARRAY存储向量**：

```sql
-- 原Hive表结构
CREATE TABLE user_embeddings (
    user_id BIGINT,
    features ARRAY<DOUBLE>
) PARTITIONED BY (dt STRING);

-- 需要复杂的UDF
SELECT user_id, my_cosine_udf(features, target_array) as score
FROM user_embeddings 
WHERE size(features) = 128;  -- 手动维度检查
```

**迁移到 VECTOR 类型**：

```sql
-- 新的表结构
CREATE TABLE user_embeddings_v2 (
    user_id BIGINT,
    features VECTOR(FLOAT, 128)  -- 类型安全
) PARTITIONED BY (dt STRING);

-- 使用内置函数和推荐模式
SELECT user_id FROM user_embeddings_v2
WHERE COSINE_DISTANCE(features, vector(...)) < 0.8;  -- 无需手动维度检查
```

### 评估现有系统

#### 数据规模评估

```sql
-- 统计现有向量数据的规模和维度
SELECT 
    table_name,
    column_name,
    COUNT(*) as record_count,
    AVG(size(array_column)) as avg_dimension,
    MIN(size(array_column)) as min_dimension,
    MAX(size(array_column)) as max_dimension,
    COUNT(DISTINCT size(array_column)) as dimension_variants
FROM (
    SELECT 'user_features' as table_name, 'embedding' as column_name, embedding as array_column FROM user_features
    UNION ALL
    SELECT 'product_vectors' as table_name, 'features' as column_name, features as array_column FROM product_vectors
    -- 添加其他需要评估的表
) all_vectors
GROUP BY table_name, column_name;
```

#### UDF复杂度评估

```sql
-- 识别当前使用的向量相关UDF
SHOW FUNCTIONS LIKE '*similarity*';
SHOW FUNCTIONS LIKE '*distance*';
SHOW FUNCTIONS LIKE '*cosine*';
SHOW FUNCTIONS LIKE '*euclidean*';
```

#### 查询频率评估

```sql
-- 分析向量计算查询的频率（如果有查询日志）
SELECT 
    DATE(query_time) as query_date,
    COUNT(*) as vector_query_count
FROM query_logs 
WHERE query_text LIKE '%cosine%' 
    OR query_text LIKE '%similarity%'
    OR query_text LIKE '%distance%'
GROUP BY DATE(query_time)
ORDER BY query_date DESC
LIMIT 30;
```

### 并行构建新表

```sql
-- 创建新的向量表
CREATE TABLE embeddings_new (
    id BIGINT,
    content STRING,
    embedding VECTOR(FLOAT, 768),
    migrated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
    
    INDEX embedding_idx (embedding) USING VECTOR PROPERTIES (
        "distance.function" = "cosine_distance"
    )
);

-- 数据迁移
INSERT INTO embeddings_new (id, content, embedding)
SELECT 
    id,
    content,
    CASE 
        WHEN size(embedding_array) = 768 
        THEN cast(embedding_array as VECTOR(FLOAT, 768))
        ELSE NULL
    END as embedding
FROM embeddings_old
WHERE size(embedding_array) = 768;

-- 构建索引
BUILD INDEX embedding_idx ON embeddings_new;
```

### 验证迁移结果

```sql
-- 对比查询结果的一致性（使用推荐查询模式）
WITH old_results AS (
    SELECT id FROM embeddings_old 
    WHERE your_cosine_udf(embedding_array, ?) > 0.8
    ORDER BY id LIMIT 10
),
new_results AS (
    SELECT id FROM embeddings_new 
    WHERE COSINE_DISTANCE(embedding, ?) < 0.2  -- 注意距离vs相似度的转换
    ORDER BY id LIMIT 10
)
SELECT 
    COALESCE(o.id, n.id) as id,
    CASE WHEN o.id IS NOT NULL THEN 'OLD' ELSE NULL END as in_old,
    CASE WHEN n.id IS NOT NULL THEN 'NEW' ELSE NULL END as in_new
FROM old_results o
FULL OUTER JOIN new_results n ON o.id = n.id
ORDER BY id;
```

***

## 🚀 性能优化

### 查询优化

```sql
-- ✅ 推荐：使用阈值过滤提升查询效率
SELECT id, content FROM embeddings_table 
WHERE COSINE_DISTANCE(embedding, ?) < 0.8  -- 利用向量索引过滤
ORDER BY id LIMIT 10;

-- ✅ 可选：分步骤处理复杂查询
CREATE VIEW filtered_candidates AS
SELECT id, content FROM embeddings_table 
WHERE COSINE_DISTANCE(embedding, ?) < 0.8;

SELECT id, content FROM filtered_candidates 
ORDER BY id LIMIT 10;
```

### 存储优化

```sql
-- 大规模数据使用半精度存储
CREATE TABLE large_embeddings (
    id BIGINT,
    embedding VECTOR(FLOAT, 1536),
    
    INDEX embedding_idx (embedding) USING VECTOR PROPERTIES (
        "scalar.type" = "f16",  -- 半精度存储节省内存
        "distance.function" = "cosine_distance"
    )
);
```

### 索引调优

根据应用需求选择合适的索引参数：

* **实时查询场景**：较小的M值和ef\_construction，使用f16类型
* **批量分析场景**：较大的M值和ef\_construction，使用f32类型
* **存储优化场景**：使用f16或i8类型减少内存占用

***

## ⚠️ 注意事项

### 功能限制

* 向量维度在创建时确定，不支持动态调整
* 向量不能用作分区键
* JACCARD\_DISTANCE和HAMMING\_DISTANCE函数有特殊的类型要求
* **当前版本的复杂 SELECT 查询存在限制，建议使用 WHERE 过滤模式**

### 索引管理

* CREATE INDEX只对新增数据生效，已有数据需要执行BUILD INDEX
* 向量索引的性能与内存缓存密切相关
* 建议为向量查询使用专门的Virtual Cluster

### 故障排除

| 问题                 | 可能原因         | 解决方法                     |
| ------------------ | ------------ | ------------------------ |
| 查询性能差              | 索引未生效        | 检查索引状态，执行BUILD INDEX     |
| 维度不匹配错误            | 向量维度不一致      | 检查VECTOR类型定义和输入数据维度      |
| Generated column错误 | 复杂SELECT查询限制 | 使用WHERE过滤模式替代            |
| L2\_NORMALIZE返回零向量 | 使用整数向量       | 改用浮点数向量：vector(3.0, 4.0) |
| 索引参数错误             | 参数名称不规范      | 使用完整参数名：cosine\_distance |
| 内存不足               | 向量索引占用过多内存   | 调整索引参数或增加集群资源            |

***

## 📊 总结

### VECTOR数据类型的核心价值

**类型安全**：通过固定维度定义避免运行时的维度不匹配错误

**开发简化**：提供内置的向量距离计算函数，减少自定义代码

**性能优化**：支持专门的向量索引，提升大规模向量查询的效率

**标准兼容**：兼容SQL语法，支持排序、分组等标准操作

### 适用场景

**推荐使用VECTOR的情况**：

* 需要频繁进行向量相似度计算
* 向量维度固定且明确
* 希望利用向量索引提升查询性能
* 新开发的AI应用项目

**继续使用ARRAY的情况**：

* 主要进行数组操作而非向量计算
* 向量维度经常变化
* 改造现有系统成本较高
* 需要复杂的向量排序查询（当前限制）

### 实施建议

**评估阶段**：分析现有向量数据的规模和维度特征

**试点验证**：选择小规模场景验证VECTOR的效果

**逐步迁移**：采用并行构建的方式平滑迁移现有系统

**持续优化**：根据实际使用情况调整索引参数和查询策略

### 查询模式推荐

**优先使用**：

* WHERE子句中的向量过滤：`WHERE COSINE_DISTANCE(...) < threshold`
* 简单的向量函数计算：`COSINE_DISTANCE(v1, v2)`

**谨慎使用**：

* 复杂的 SELECT 返回距离计算并排序
* 大型向量的嵌套查询

**替代方案**：

* 分步骤查询：先过滤再排序
* 预计算：批量计算距离后存储

***

**注意**：本文档基于Lakehouse 2025年6月的产品文档整理，建议定期查看官方文档获取最新更新。在生产环境中使用前，请务必在测试环境中验证所有操作的正确性和性能影响。
