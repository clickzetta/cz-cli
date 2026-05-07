# Lakehouse 向量索引创建指南

## 概述

Lakehouse 提供完整的向量检索能力，包括向量数据类型、搜索函数和专用索引。向量作为固定维度的数值集合，可以表示 LLM 生成的文本嵌入、图像特征、时序数据等多种信息。
系统原生支持 VECTOR 类型，能够高效存储和查询由大语言模型（LLM）等深度学习模型生成的向量嵌入。这些向量嵌入将非结构化数据（如文本、图像）转化为保留语义相似性的数值表示。通过构建专门的向量索引，Lakehouse 可以在海量数据中实现毫秒级的相似性搜索，为基于 LLM 的 RAG 应用、智能问答、语义搜索等 AI 场景提供高性能的基础设施支持。

## 1. 准备工作

### 1.1 创建测试 Schema

```sql
-- 创建一个专门用于向量索引测试的 schema
CREATE SCHEMA IF NOT EXISTS vector_demo COMMENT '向量索引演示';

-- 切换到新创建的 schema
USE SCHEMA vector_demo;
```

### 1.2 准备向量生成函数

Lakehouse 支持创建 AI 函数，可以将文本转换为向量表示，请参考：[创建 Embedding 函数](https://www.yunqi.tech/documents/Create_Embeding_Function)

```sql
-- 函数签名
-- fc_embeddings(mode, text, api_key, model, dimension)
-- 参数说明：
-- mode: 'text' - 文本模式
-- text: 要转换的文本内容
-- api_key: API密钥 (请替换为您的实际密钥)
-- model: 模型名称，如 'text-embedding-v4'
-- dimension: 向量维度，如 1024

-- 测试向量生成函数
SELECT public.fc_embeddings(
    'text', 
    'hello world', 
    '${API_KEY}', 
    'text-embedding-v4',
    1024
) as embedding;
```

## 2. 创建包含向量列的表

### 创建产品描述表

```sql
-- 创建产品表，包含向量列（简化版本，避免IDENTITY问题）
CREATE TABLE IF NOT EXISTS vector_demo.product_embeddings (
    product_id INT COMMENT '产品ID',
    product_name VARCHAR(255) NOT NULL COMMENT '产品名称',
    category VARCHAR(100) COMMENT '产品类别',
    description STRING COMMENT '产品描述',
    embedding VECTOR(FLOAT, 1024) COMMENT '产品描述的向量表示',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP() COMMENT '创建时间',
    
    -- 创建向量索引（简化的语法）
    INDEX idx_product_embedding (embedding) USING VECTOR
) 
COMMENT '产品向量表';

```

## 3. 插入向量数据

### 3.1 使用向量生成函数插入数据

**重要提示**：使用 `fc_embeddings` 函数生成的向量需要显式转换为 `VECTOR` 类型。

```sql
-- 插入向量数据，注意需要使用 CAST 转换
INSERT INTO vector_demo.product_embeddings (product_id, product_name, category, description, embedding)
VALUES 
-- 智能手机类
(1, 'iPhone 15 Pro', '智能手机', 
    '苹果最新旗舰手机，采用钛金属设计，A17 Pro芯片，支持光线追踪游戏，4800万像素主摄，USB-C接口',
    CAST(public.fc_embeddings('text', 
        '苹果最新旗舰手机，采用钛金属设计，A17 Pro芯片，支持光线追踪游戏，4800万像素主摄，USB-C接口', 
        '${API_KEY}', 'text-embedding-v4', 1024) AS VECTOR(FLOAT, 1024))),

(2, '小米14 Pro', '智能手机', 
    '小米高端旗舰，骁龙8 Gen3处理器，徕卡影像系统，120W快充，2K AMOLED屏幕',
    CAST(public.fc_embeddings('text', 
        '小米高端旗舰，骁龙8 Gen3处理器，徕卡影像系统，120W快充，2K AMOLED屏幕', 
        '${API_KEY}', 'text-embedding-v4', 1024) AS VECTOR(FLOAT, 1024))),

(3, '华为Mate 60 Pro', '智能手机', 
    '华为旗舰手机，麒麟9000S芯片，卫星通信功能，鸿蒙系统，玄武架构抗摔',
    CAST(public.fc_embeddings('text', 
        '华为旗舰手机，麒麟9000S芯片，卫星通信功能，鸿蒙系统，玄武架构抗摔', 
        '${API_KEY}', 'text-embedding-v4', 1024) AS VECTOR(FLOAT, 1024))),

-- 笔记本电脑类
(4, 'MacBook Pro M3 Max', '笔记本电脑', 
    '苹果专业笔记本，M3 Max芯片，最高128GB统一内存，Mini-LED显示屏，22小时续航',
    CAST(public.fc_embeddings('text', 
        '苹果专业笔记本，M3 Max芯片，最高128GB统一内存，Mini-LED显示屏，22小时续航', 
        '${API_KEY}', 'text-embedding-v4', 1024) AS VECTOR(FLOAT, 1024))),

(5, '联想ThinkPad X1 Carbon', '笔记本电脑', 
    '商务轻薄本，第13代英特尔酷睿处理器，14英寸2.8K OLED屏，仅1.12kg重量',
    CAST(public.fc_embeddings('text', 
        '商务轻薄本，第13代英特尔酷睿处理器，14英寸2.8K OLED屏，仅1.12kg重量', 
        '${API_KEY}', 'text-embedding-v4', 1024) AS VECTOR(FLOAT, 1024))),

(6, '华硕ROG幻16', '笔记本电脑', 
    '游戏本，RTX 4070显卡，Intel i9-13900HX处理器，240Hz电竞屏，液金散热',
    CAST(public.fc_embeddings('text', 
        '游戏本，RTX 4070显卡，Intel i9-13900HX处理器，240Hz电竞屏，液金散热', 
        '${API_KEY}', 'text-embedding-v4', 1024) AS VECTOR(FLOAT, 1024))),

-- 耳机音频类
(7, 'AirPods Pro 2', '耳机', 
    '主动降噪耳机，自适应音频，空间音频功能，H2芯片，最长30小时续航',
    CAST(public.fc_embeddings('text', 
        '主动降噪耳机，自适应音频，空间音频功能，H2芯片，最长30小时续航', 
        '${API_KEY}', 'text-embedding-v4', 1024) AS VECTOR(FLOAT, 1024))),

(8, '索尼WH-1000XM5', '耳机', 
    '头戴式降噪耳机，业界领先降噪技术，30小时续航，LDAC高音质传输',
    CAST(public.fc_embeddings('text', 
        '头戴式降噪耳机，业界领先降噪技术，30小时续航，LDAC高音质传输', 
        '${API_KEY}', 'text-embedding-v4', 1024) AS VECTOR(FLOAT, 1024))),

(9, 'Bose QC Ultra', '耳机', 
    '旗舰降噪耳机，沉浸式空间音频，CustomTune技术，24小时续航',
    CAST(public.fc_embeddings('text', 
        '旗舰降噪耳机，沉浸式空间音频，CustomTune技术，24小时续航', 
        '${API_KEY}', 'text-embedding-v4', 1024) AS VECTOR(FLOAT, 1024))),

-- 智能手表类
(10, 'Apple Watch Ultra 2', '智能手表', 
    '户外运动手表，双频GPS，100米防水，血氧监测，最深40米潜水功能',
    CAST(public.fc_embeddings('text', 
        '户外运动手表，双频GPS，100米防水，血氧监测，最深40米潜水功能', 
        '${API_KEY}', 'text-embedding-v4', 1024) AS VECTOR(FLOAT, 1024))),

(11, '华为Watch GT4', '智能手表', 
    '全天候健康监测，14天超长续航，支持100+运动模式，科学睡眠监测',
    CAST(public.fc_embeddings('text', 
        '全天候健康监测，14天超长续航，支持100+运动模式，科学睡眠监测', 
        '${API_KEY}', 'text-embedding-v4', 1024) AS VECTOR(FLOAT, 1024))),

(12, '三星Galaxy Watch6', '智能手表', 
    '健康追踪手表，身体成分分析，睡眠指导，5ATM+IP68防水',
    CAST(public.fc_embeddings('text', 
        '健康追踪手表，身体成分分析，睡眠指导，5ATM+IP68防水', 
        '${API_KEY}', 'text-embedding-v4', 1024) AS VECTOR(FLOAT, 1024))),

-- 平板电脑类
(13, 'iPad Pro 13英寸', '平板电脑', 
    'M4芯片平板，OLED显示屏，支持Apple Pencil Pro，专业创作工具',
    CAST(public.fc_embeddings('text', 
        'M4芯片平板，OLED显示屏，支持Apple Pencil Pro，专业创作工具', 
        '${API_KEY}', 'text-embedding-v4', 1024) AS VECTOR(FLOAT, 1024))),

(14, '小米平板6 Pro', '平板电脑', 
    '骁龙8+处理器，144Hz高刷屏，67W快充，支持小米灵感触控笔',
    CAST(public.fc_embeddings('text', 
        '骁龙8+处理器，144Hz高刷屏，67W快充，支持小米灵感触控笔', 
        '${API_KEY}', 'text-embedding-v4', 1024) AS VECTOR(FLOAT, 1024))),

-- 智能音箱类
(15, 'HomePod 2', '智能音箱', 
    '智能音箱，空间音频，Siri语音助手，智能家居中枢，温湿度感应',
    CAST(public.fc_embeddings('text', 
        '智能音箱，空间音频，Siri语音助手，智能家居中枢，温湿度感应', 
        '${API_KEY}', 'text-embedding-v4', 1024) AS VECTOR(FLOAT, 1024))),

(16, '小爱音箱Pro', '智能音箱', 
    '小爱同学语音助手，DTS音效，智能家居控制，红外遥控功能',
    CAST(public.fc_embeddings('text', 
        '小爱同学语音助手，DTS音效，智能家居控制，红外遥控功能', 
        '${API_KEY}', 'text-embedding-v4', 1024) AS VECTOR(FLOAT, 1024))),

-- 相机类
(17, '索尼A7R5', '相机', 
    '全画幅微单，6100万像素，8档防抖，8K视频录制，AI对焦系统',
    CAST(public.fc_embeddings('text', 
        '全画幅微单，6100万像素，8档防抖，8K视频录制，AI对焦系统', 
        '${API_KEY}', 'text-embedding-v4', 1024) AS VECTOR(FLOAT, 1024))),

(18, '佳能EOS R5', '相机', 
    '专业全画幅相机，4500万像素，机身防抖，8K RAW视频，双卡槽',
    CAST(public.fc_embeddings('text', 
        '专业全画幅相机，4500万像素，机身防抖，8K RAW视频，双卡槽', 
        '${API_KEY}', 'text-embedding-v4', 1024) AS VECTOR(FLOAT, 1024))),

-- 游戏设备类
(19, 'PlayStation 5 Pro', '游戏机', 
    '次世代游戏主机，8K输出，光线追踪，超高速SSD，DualSense手柄',
    CAST(public.fc_embeddings('text', 
        '次世代游戏主机，8K输出，光线追踪，超高速SSD，DualSense手柄', 
        '${API_KEY}', 'text-embedding-v4', 1024) AS VECTOR(FLOAT, 1024))),

(20, 'Nintendo Switch OLED', '游戏机', 
    '便携游戏机，7英寸OLED屏幕，增强音频，64GB存储，可拆卸手柄',
    CAST(public.fc_embeddings('text', 
        '便携游戏机，7英寸OLED屏幕，增强音频，64GB存储，可拆卸手柄', 
        '${API_KEY}', 'text-embedding-v4', 1024) AS VECTOR(FLOAT, 1024)))
;

```

## 4. 构建向量索引

> ### 对已有数据构建索引
>
> 如果想对表中已经存在的数据创建索引，需要使用 BUILD INDEX 命令构建索引（新插入的数据会自动构建索引）。
>
> ```sql
> -- 构建向量索引（实际验证过的命令）
> BUILD INDEX idx_embedding ON vector_demo.simple_embeddings;
>
> -- 构建文档表的向量索引（指定范围）
> BUILD INDEX idx_doc_embedding ON vector_demo.document_embeddings 
> WHERE create_date >= '2024-01-01' AND create_date <= '2024-12-31';
> ```

### 4.1 监控索引构建进度

```sql
-- 查看表的索引列表
SHOW INDEXES FROM vector_demo.product_embeddings;

-- 查看表的详细信息，包括索引
DESC EXTENDED vector_demo.product_embeddings ;
```

## 5. 使用向量索引进行相似度搜索

### 5.1 基本向量搜索

```sql
WITH query_vector AS (
    SELECT CAST(public.fc_embeddings(
        'text', 
        '拍照功能强大的手机，相机系统好，影像能力出色', 
        '${API_KEY}', 
        'text-embedding-v4',
        1024
    ) AS VECTOR(FLOAT, 1024)) as vec
)
SELECT 
    p.product_id,
    p.product_name,
    p.category,
    p.description,
    cosine_distance(p.embedding, q.vec) as similarity_score
FROM vector_demo.product_embeddings p, query_vector q
ORDER BY similarity_score ASC
LIMIT 5;

```

展示结果：

### ![](.topwrite/assets/vector.jpeg)

### 5.3 带过滤条件的向量搜索

```sql
WITH query_vector AS (
    SELECT CAST(public.fc_embeddings(
        'text', 
        '国产高端旗舰手机', 
        '${API_KEY}', 
        'text-embedding-v4',
        1024
    ) AS VECTOR(FLOAT, 1024)) as vec
)
SELECT 
    product_id,
    product_name,
    description,
    ROUND(cosine_distance(embedding, vec), 4) as distance
FROM vector_demo.product_embeddings, query_vector
WHERE product_name NOT LIKE '%iPhone%'  -- 排除苹果产品
ORDER BY distance ASC
LIMIT 3;
```

展示结果：

![](.topwrite/assets/vector_search_w_filter.jpeg)

## 6. 向量索引优化建议

### 6.1 距离函数选择

| 距离函数                   | 适用场景  | 特点              |
| ---------------------- | ----- | --------------- |
| cosine_distance       | 文本相似度 | 不受向量长度影响，适合文本嵌入 |
| l2_distance           | 图像特征  | 欧氏距离，对绝对差异敏感    |
| negative_dot_product | 推荐系统  | 点积的负值，适合评分预测    |

### 6.2 参数调优

```sql
-- 高精度配置（查询准确但较慢）
CREATE INDEX idx_high_precision (embedding) USING VECTOR 
PROPERTIES(
    "m" = "64",
    "ef.construction" = "500",
    "scalar.type" = "f32"
);

-- 高性能配置（查询快速但精度略低）
CREATE INDEX idx_high_performance (embedding) USING VECTOR 
PROPERTIES(
    "m" = "8",
    "ef.construction" = "100",
    "scalar.type" = "f16",
    "compress.codec" = "lz4"
);
```

### 6.3 存储优化

```sql
-- 使用向量列复用减少存储
CREATE INDEX idx_storage_optimized (embedding) USING VECTOR 
PROPERTIES(
    "reuse.vector.column" = "true",
    "scalar.type" = "i8"  -- 使用8位整数进一步压缩
);
```

## 7. 管理向量索引

### 7.1 查看索引信息

```sql
-- 查看表的所有索引
SHOW INDEXES FROM vector_demo.product_embeddings;

-- 查看索引详细信息
DESC INDEX idx_product_embedding ON vector_demo.product_embeddings;
```

### 7.2 删除和重建索引

```sql
-- 删除索引
DROP INDEX idx_product_embedding ON vector_demo.product_embeddings;

-- 重新创建索引（使用新参数）
CREATE INDEX idx_product_embedding_v2 ON vector_demo.product_embeddings(embedding) 
USING VECTOR PROPERTIES(
    "distance.function" = "negative_dot_product",
    "m" = "24",
    "ef.construction" = "300"
);

-- 构建新索引
BUILD INDEX idx_product_embedding_v2 ON vector_demo.product_embeddings;
```

## 8. 性能监控和故障排查

### 8.1 查询性能分析

```sql
-- 使用 EXPLAIN 分析查询计划
EXPLAIN 
WITH query_vector AS (
    SELECT public.fc_embeddings('text', '测试查询', '${API_KEY}', 'text-embedding-v4', 1024) as vec
)
SELECT * FROM vector_demo.product_embeddings p, query_vector q
ORDER BY cosine_distance(p.embedding, q.vec) ASC
LIMIT 10;
```

### 8.2 常见问题处理

1. **索引构建失败**
   * 检查内存是否充足
   * 确认向量维度一致
   * 验证向量数据完整性

2. **查询性能慢**
   * 调整 m 和 ef.construction 参数
   * 考虑使用更小的 scalar.type
   * 检查是否正确使用了索引

3. **精度不足**
   * 增加 m 值
   * 提高 ef.construction
   * 使用 f32 而非压缩格式

## 重要注意事项

1. **向量类型转换**：使用 `fc_embeddings` 函数生成的向量结果为 String 类型，需使用 `CAST` 转换为 `VECTOR(FLOAT, 1024)` 类型。

2. **BUILD INDEX**：对于已有数据的表，必须执行 BUILD INDEX 命令来构建索引，否则向量搜索性能会受影响。

3. **距离函数选择**：
   * `cosine_distance`：适用于文本嵌入，值越小越相似
   * `l2_distance`：欧氏距离，适用于图像特征
   * `negative_dot_product`：点积的负值，适用于推荐系统

4. **向量检索查询时支持的参数**

   | Name                                                  | Default Value | Notes                                        |
   | ----------------------------------------------------- | ------------- | -------------------------------------------- |
   | cz.storage.parquet.vector.index.read.memory.cache     | false         | 是否使用内存缓存                                     |
   | cz.storage.parquet.vector.index.read.local.cache      | false         | 是否使用本地SSD缓存                                  |
   | cz.storage.parquet.vector.index.read.vectors.ondemand | adaptive      | 是否按需加载向量索引（比使用内存缓存稍慢）                        |
   | cz.storage.parquet.vector.index.write.parallel        | 0             | 是否开启并行写入，0表示关闭，8表示8个线程写入。注意，性能提升比例并不与线程数成正比。 |

   使用示例：使用SQL查询时选中一起执行。

   ```
   SET cz.sql.index.prewhere.enabled=true; -- 当前需要设置开关，后续版本会默认开启
   SELECT id, doc, l2_distance(vec, vector(1,2,3,4)) as dist FROM some_table WHERE match_regexp(doc, '.*hello.*', map('analyzer', 'keyword')) AND l2_distance(vec, vector(1,2,3,4)) < 1000 ORDER BY dist LIMIT 100
   ```

5. **计费**

   存储资源：向量索引会创建向量索引文件，该文件和数据文件都保存在对象存储中，统一计费。

^
