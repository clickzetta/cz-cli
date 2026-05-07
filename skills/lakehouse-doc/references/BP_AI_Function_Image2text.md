# 云器 Lakehouse 图像解析最佳实践

## 引言

在数据驱动的时代，图像数据已成为企业数据资产的重要组成部分。云器 Lakehouse 通过集成先进的图像识别和向量检索技术，为企业提供了一套完整的图像数据管理和分析解决方案。本文将通过一个美食图像识别的实战案例，详细介绍如何在云器 Lakehouse 中构建端到端的图像解析系统。

## 1. 关键产品功能

* **多模态存储**：支持图像文件、向量数据、结构化元数据的统一管理
* **外部函数**（EXTERNAL FUNCTION）：无缝调用 AI 模型进行图像识别和向量化
* **向量检索**：原生支持 1024 维向量存储和相似度计算

## 2.实战案例：美食图像识别系统

### 2.1 创建数据表结构

首先，我们需要创建一个包含向量字段的表来存储图像信息：

```sql
-- 创建美食图像识别数据表
CREATE    TABLE IF NOT EXISTS dish_images (
          id BIGINT NOT NULL PRIMARY KEY IDENTITY (1),
          url STRING NOT NULL COMMENT '图片的原始URL地址',
          file_name STRING NOT NULL COMMENT '图片文件名',
          image_content STRING COMMENT '使用fc_image_to_text提取的菜品信息',
          image_vector VECTOR (FLOAT, 1024) COMMENT '使用fc_gen_emmbeding生成的图片向量',
          created_at TIMESTAMP DEFAULT current_timestamp() COMMENT '创建时间'
          )
          COMMENT '美食图片识别数据表';

```

### 2.2 批量上传图像到 VOLUME

云器 Lakehouse 的 VOLUME 功能提供了文件管理能力。以下示例展示如何从 URL 批量下载并上传图像。您可以从下方网址下载图片到本地，再通过 [Lakehouse JDBC 客户端](connect-with-cli.md) 将文件 PUT 到 USER VOLUME 中：

[图片地址](http://viapi-test.oss-cn-shanghai.aliyuncs.com/viapi-3.0domepic/imagerecog/RecognizeFood/RecognizeFood1.jpg)（可通过变换结果中的数字下载更多图片）

```sql
-- 注意：PUT命令需要通过 JDBC 客户端执行，不能在 SQL 编辑器中直接运行
-- 从URL批量下载并上传图像到 USER VOLUME
PUT 
    '/User/Downloads/RecognizeFood1.jpg',
    '/User/Downloads/RecognizeFood2.jpg',
    '/User/Downloads/RecognizeFood3.jpg' 
TO USER VOLUME SUBDIRECTORY 'dish_images';

-- 查看上传的文件
LIST USER VOLUME SUBDIRECTORY 'dish_images';
```

### 2.3 利用函数识别图片

利用云函数实现图像的自动识别和向量化：

```sql
-- 插入单条记录，调用云函数进行图像识别和向量生成
INSERT INTO dish_images (url, file_name, image_content, image_vector)
VALUES 
(
    'http://viapi-test.oss-cn-shanghai.aliyuncs.com/viapi-3.0domepic/imagerecog/RecognizeFood/RecognizeFood1.jpg',
    'RecognizeFood1.jpg',
    -- 调用图像识别函数
    public.fc_image_to_text('dish_recognition', 'http://viapi-test.oss-cn-shanghai.aliyuncs.com/viapi-3.0domepic/imagerecog/RecognizeFood/RecognizeFood1.jpg'),
    -- 生成图像向量（注意：向量维度必须匹配）
    CAST(public.fc_gen_emmbeding('multimodal', '', 'http://viapi-test.oss-cn-shanghai.aliyuncs.com/viapi-3.0domepic/imagerecog/RecognizeFood/RecognizeFood1.jpg') AS VECTOR(FLOAT, 1024))
);

-- 批量插入多条记录
INSERT INTO dish_images (url, file_name, image_content, image_vector)
VALUES 
('http://viapi-test.oss-cn-shanghai.aliyuncs.com/viapi-3.0domepic/imagerecog/RecognizeFood/RecognizeFood2.jpg', 
 'RecognizeFood2.jpg',
 public.fc_image_to_text('dish_recognition', 'http://viapi-test.oss-cn-shanghai.aliyuncs.com/viapi-3.0domepic/imagerecog/RecognizeFood/RecognizeFood2.jpg'),
 CAST(public.fc_gen_emmbeding('multimodal', '', 'http://viapi-test.oss-cn-shanghai.aliyuncs.com/viapi-3.0domepic/imagerecog/RecognizeFood/RecognizeFood2.jpg') AS VECTOR(FLOAT, 1024))
),
('http://viapi-test.oss-cn-shanghai.aliyuncs.com/viapi-3.0domepic/imagerecog/RecognizeFood/RecognizeFood3.jpg', 
 'RecognizeFood3.jpg',
 public.fc_image_to_text('dish_recognition', 'http://viapi-test.oss-cn-shanghai.aliyuncs.com/viapi-3.0domepic/imagerecog/RecognizeFood/RecognizeFood3.jpg'),
 CAST(public.fc_gen_emmbeding('multimodal', '', 'http://viapi-test.oss-cn-shanghai.aliyuncs.com/viapi-3.0domepic/imagerecog/RecognizeFood/RecognizeFood3.jpg') AS VECTOR(FLOAT, 1024))
);
```

### 2.4 向量相似度搜索

实现基于图像内容的相似度搜索：

```sql
-- 查找与目标图像最相似的菜品
WITH target_vector AS (
    SELECT CAST(public.fc_gen_emmbeding('multimodal', '', 'http://viapi-test.oss-cn-shanghai.aliyuncs.com/viapi-3.0domepic/imagerecog/RecognizeFood/RecognizeFood5.jpg') AS VECTOR(FLOAT, 1024)) as vec
)
SELECT 
    d.id,
    d.file_name,
    d.url,
    d.image_content,
    cosine_distance(d.image_vector, t.vec) as similarity_score
FROM dish_images d, target_vector t
ORDER BY similarity_score ASC
LIMIT 5;

-- 基于已有图像查找相似图像
SELECT 
    d1.file_name as source_image,
    d2.file_name as similar_image,
    d2.image_content,
    cosine_distance(d1.image_vector, d2.image_vector) as similarity_score
FROM dish_images d1, dish_images d2
WHERE d1.file_name = 'RecognizeFood1.jpg'
  AND d1.id != d2.id
ORDER BY similarity_score ASC
LIMIT 5;
```

## 3.高级应用场景

### 3.1 多维度图像分析

结合结构化查询和向量搜索，实现复杂的分析需求：

```sql
-- 查找特定类别的图像
SELECT 
    id,
    file_name,
    image_content
FROM dish_images
WHERE image_content LIKE '%海鲜%' 
   OR image_content LIKE '%鱼%'
   OR image_content LIKE '%虾%'
   OR image_content LIKE '%蟹%'
ORDER BY id;

-- 分析菜品识别结果的置信度分布
SELECT 
    file_name,
    image_content,
    -- 提取置信度（需要根据实际JSON格式调整）
    CAST(SUBSTRING(image_content, 
         POSITION('probability' IN image_content) + 15, 
         8) AS DOUBLE) as confidence
FROM dish_images
ORDER BY confidence DESC;

-- 统计各类菜品数量
SELECT 
    CASE 
        WHEN image_content LIKE '%牛%' THEN '牛肉类'
        WHEN image_content LIKE '%鱼%' THEN '鱼类'
        WHEN image_content LIKE '%虾%' OR image_content LIKE '%蟹%' THEN '海鲜类'
        WHEN image_content LIKE '%菜%' AND image_content NOT LIKE '%非菜%' THEN '蔬菜类'
        ELSE '其他'
    END as category,
    COUNT(*) as count
FROM dish_images
WHERE image_content NOT LIKE '%非菜%'
GROUP BY 1
ORDER BY count DESC;
```

### 3.2 创建图像处理管道

使用动态表实现自动化的数据处理：

```sql
-- 创建动态表，自动提取和聚合菜品信息
CREATE OR REPLACE DYNAMIC TABLE dish_summary
REFRESH_INTERVAL = '1 HOUR'
AS
SELECT 
    file_name,
    url,
    -- 提取菜品名称（简化的字符串处理）
    SUBSTRING(image_content, 
              POSITION('name' IN image_content) + 9,
              POSITION('}' IN SUBSTRING(image_content, POSITION('name' IN image_content))) - 10
    ) as dish_name,
    -- 提取卡路里信息
    CASE 
        WHEN image_content LIKE '%calorie%' THEN
            SUBSTRING(image_content, 
                     POSITION('calorie' IN image_content) + 12,
                     3)
        ELSE NULL
    END as calorie,
    created_at
FROM dish_images
WHERE image_content IS NOT NULL;

-- 查看动态表数据
SELECT * FROM dish_summary;
```

## 结语

通过本文的实践案例和可执行代码，我们展示了云器 Lakehouse 在图像数据管理和分析方面的强大能力。从简单的图像识别到复杂的向量搜索，从批量处理到实时分析，云器 Lakehouse 为企业提供了一站式的解决方案。

正如 MCP Server 所体现的技术追求，云器团队对每一个功能细节的打磨，让这个平台不仅仅是一个数据仓库，更是连接 AI 能力与业务需求的桥梁。随着技术的不断进步，我们相信云器 Lakehouse 将在多模态数据分析领域发挥越来越重要的作用。

***

*本文基于云器 Lakehouse 最新版本编写，所有 SQL 代码均已在实际环境中测试通过。具体功能可能随版本更新而变化。更多技术细节请参考官方文档：* <https://yunqi.tech/documents>
