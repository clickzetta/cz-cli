# Lakehouse 全文检索使用指南

***

## 附录 写在前面

## 附录# 您可能遇到的文本检索场景

## 附录## 附录 场景1：企业知识库搜索系统

**当前在Hive/Spark中的常见做法**：

```sql
-- 在Hive中进行文本搜索
SELECT * FROM knowledge_base 
WHERE content LIKE '%人工智能%' 
   OR content LIKE '%机器学习%' 
   OR content LIKE '%深度学习%';

-- 性能问题：
-- 1. 全表扫描，无法利用索引
-- 2. 只能精确匹配，无法进行语义搜索
-- 3. 中文分词困难，搜索效果差
```

**面临的技术挑战**：

* **性能限制**：LIKE查询需要全表扫描，大数据量时性能极差
* **功能局限**：无法进行分词搜索，只能精确字符串匹配
* **维护复杂**：需要手动管理搜索关键词和同义词
* **扩展困难**：多语言支持需要额外开发

## 附录## 附录 场景2：日志分析与故障排查

**在Elasticsearch中的典型实现**：

```javascript
// Elasticsearch查询
{
  "query": {
    "multi_match": {
      "query": "ERROR timeout connection",
      "fields": ["message", "stack_trace"]
    }
  }
}
```

**常见的技术痛点**：

* **架构复杂**：需要维护独立的搜索引擎系统
* **数据同步**：数据需要从数据湖同步到搜索引擎
* **成本问题**：额外的存储和计算资源消耗
* **一致性风险**：数据同步延迟导致搜索结果不准确

## 附录# 为什么需要原生全文检索

基于以上场景中的技术挑战，Lakehouse原生全文检索的设计目标是：

**统一的数据处理平台**：

* 在同一系统中完成分析计算和全文检索
* 无需维护独立的搜索引擎系统
* 数据存储和检索的强一致性

**高性能的倒排索引**：

* 基于倒排索引的快速文本检索
* 支持多种分词策略和语言
* 比传统LIKE查询性能提升数十倍

**智能的分词和匹配**：

* 支持中文、英文、Unicode等多种分词器
* 提供短语匹配、前缀匹配、正则匹配等多种模式
* 自动大小写转换和标点符号过滤

## 附录# 如何使用这份指南

| 读者角色  | 建议阅读重点             | 预期收获           |
| ----- | ------------------ | -------------- |
| 数据工程师 | 索引创建 → 函数使用 → 性能优化 | 掌握倒排索引的正确使用方法  |
| 系统架构师 | 应用场景 → 架构对比 → 迁移策略 | 获得从传统搜索引擎的迁移指导 |
| 应用开发者 | 快速开始 → 查询模式 → 避坑指南 | 了解全文检索的最佳实践    |

***

## 附录 快速开始

## 附录# 基本使用流程

```sql
-- 1. 创建包含倒排索引的表
CREATE TABLE documents (
    id BIGINT,
    title STRING,
    content STRING,
    created_at TIMESTAMP,
    
    -- 建表时定义倒排索引
    INDEX title_idx (title) INVERTED PROPERTIES('analyzer'='keyword'),
    INDEX content_idx (content) INVERTED PROPERTIES('analyzer'='chinese', 'mode'='smart')
);

-- 2. 插入数据
INSERT INTO documents VALUES 
(1, 'ClickZetta技术指南', '云器Lakehouse支持向量检索和全文搜索功能', CURRENT_TIMESTAMP());

-- 3. 为已有数据构建索引
BUILD INDEX content_idx ON documents;

-- 4. 执行全文检索查询
SELECT id, title FROM documents 
WHERE MATCH_ANY(content, '全文搜索 向量检索', map('analyzer', 'auto'));

-- 5. 使用短语匹配
SELECT id, title FROM documents 
WHERE MATCH_PHRASE(content, '全文搜索功能', map('analyzer', 'auto'));
```

***

## 附录 技术对比：传统方案 vs 原生全文检索

## 附录# 传统LIKE查询方案

```sql
-- 使用LIKE进行文本搜索
SELECT * FROM documents 
WHERE content LIKE '%人工智能%' 
   OR content LIKE '%机器学习%'
   OR content LIKE '%深度学习%';

-- 存在的问题：
-- 1. 全表扫描，性能差
-- 2. 无法分词，只能精确匹配
-- 3. 大小写敏感
-- 4. 无法处理同义词
```

## 附录# 外部搜索引擎方案

```yaml
# 需要维护额外的Elasticsearch集群
version: '3'
services:
  elasticsearch:
    image: elasticsearch:7.14.0
    environment:
      - discovery.type=single-node
    ports:
      - "9200:9200"
```

```python
# 需要数据同步脚本
from elasticsearch import Elasticsearch

def sync_data_to_es():
    # 从数据湖读取数据
    # 转换格式
    # 同步到Elasticsearch
    pass
```

## 附录# Lakehouse原生全文检索

```sql
-- 一站式解决方案
CREATE TABLE documents (
    id BIGINT,
    content STRING,
    INDEX content_idx (content) INVERTED PROPERTIES('analyzer'='chinese')
);

-- 直接使用内置函数
SELECT * FROM documents 
WHERE MATCH_ALL(content, '人工智能 机器学习', map('analyzer', 'auto'));
```

## 附录# 方案对比总结

| 特性    | LIKE查询   | 外部搜索引擎 | Lakehouse全文检索 | 优势            |
| ----- | -------- | ------ | ------------- | ------------- |
| 性能    | 极差（全表扫描） | 优秀     | 优秀（倒排索引）      | 无需外部系统即可获得高性能 |
| 架构复杂度 | 简单       | 复杂     | 简单            | 统一平台，减少运维成本   |
| 数据一致性 | 强一致      | 最终一致   | 强一致           | 避免数据同步延迟      |
| 开发成本  | 低        | 高      | 中等            | 减少集成开发工作      |
| 分词支持  | 无        | 丰富     | 丰富            | 原生支持多语言分词     |
| 维护成本  | 低        | 高      | 低             | 无需维护独立搜索集群    |

***

## 附录 倒排索引核心概念

## 附录# 倒排索引原理

**基本概念**：

* **词典（Dictionary）**：存储所有文档中出现的唯一单词列表
* **倒排表（Posting List）**：记录每个单词在哪些文档中出现及位置信息

**构建过程**：

1. **分词（Tokenization）**：将文档内容分割成单词或短语
2. **标准化（Normalization）**：转小写、去除停用词等处理
3. **构建词典**：为每个单词分配唯一ID
4. **构建倒排表**：记录单词与文档的映射关系

## 附录# 索引创建语法

## 附录## 附录 建表时定义索引

```sql
CREATE TABLE table_name (
    column_definitions,
    INDEX index_name (column_name) INVERTED 
    [COMMENT 'description'] 
    PROPERTIES(
        'analyzer'='english|chinese|keyword|unicode',
        'mode'='smart|max_word'  -- 仅中文分词支持
    )
);
```

## 附录## 附录 已有表添加索引

```sql
CREATE INVERTED INDEX [IF NOT EXISTS] index_name 
ON TABLE [schema.]table_name(column_name)
[COMMENT 'description'] 
PROPERTIES(
    'analyzer'='english|chinese|keyword|unicode',
    'mode'='smart|max_word'
);
```

## 附录# 支持的数据类型

| 数据类型类别 | 具体类型                                          | 是否需要PROPERTIES | 说明          |
| ------ | --------------------------------------------- | -------------- | ----------- |
| 数值类型   | TINYINT, SMALLINT, INT, BIGINT, FLOAT, DOUBLE | ❌              | 用于等值和范围查询加速 |
| 日期类型   | DATE, TIMESTAMP                               | ❌              | 用于时间范围查询加速  |
| 字符串类型  | STRING, VARCHAR, CHAR                         | ✅              | 必须指定分词器     |

***

## 附录 分词器详解

## 附录# 分词器类型对比

## 附录## 附录 keyword分词器

```sql
SELECT TOKENIZE('ClickZetta Lakehouse 技术指南', map('analyzer', 'keyword'));
-- 结果：["ClickZetta Lakehouse 技术指南"]
```

* **特点**：不分词，保留完整字符串
* **适用场景**：精确匹配、ID字段、状态字段
* **性能**：最优，直接字符串匹配

## 附录## 附录 english分词器

```sql
SELECT TOKENIZE('ClickZetta Lakehouse Technical Guide', map('analyzer', 'english'));
-- 结果：["clickzetta", "lakehouse", "technical", "guide"]
```

* **特点**：识别ASCII字母数字，转小写，过滤标点
* **适用场景**：纯英文内容
* **性能**：优秀，针对英文优化

## 附录## 附录 chinese分词器

```sql
SELECT TOKENIZE('ClickZetta Lakehouse 技术指南', map('analyzer', 'chinese'));
-- 结果：["clickzetta", "lakehouse", "技术", "指南"]
```

* **特点**：支持中英文混合，智能分词
* **适用场景**：中文文档、中英文混合内容
* **分词模式**：
  * `smart`：智能分词，粗粒度，高准确率
  * `max_word`：最大分词，细粒度，高召回率

## 附录## 附录 unicode分词器

```sql
SELECT TOKENIZE('ClickZetta Lakehouse 技術指南', map('analyzer', 'unicode'));
-- 结果：["clickzetta", "lakehouse", "技", "術", "指", "南"]
```

* **特点**：支持所有Unicode字符
* **适用场景**：多语言混合内容
* **性能**：相对较慢，但支持范围最广

## 附录# 分词模式详解

仅中文分词器支持分词模式：

```sql
-- smart模式：智能分词
SELECT TOKENIZE('自然语言处理技术', map('analyzer', 'chinese', 'mode', 'smart'));
-- 结果：["自然语言", "处理", "技术"]

-- max_word模式：最大分词
SELECT TOKENIZE('自然语言处理技术', map('analyzer', 'chinese', 'mode', 'max_word'));
-- 结果：["自然", "语言", "自然语言", "处理", "技术"]
```

**选择建议**：

* **短文本匹配**：使用 `smart` 模式，提高准确率
* **全文搜索**：使用 `max_word` 模式，提高召回率

***

## 附录 全文检索函数

## 附录# 函数概览

| 函数名                   | 功能      | 返回类型    | 适用场景   |
| --------------------- | ------- | ------- | ------ |
| TOKENIZE              | 分词测试    | ARRAY   | 验证分词效果 |
| MATCH\_ALL            | 匹配所有关键词 | BOOLEAN | 精确搜索   |
| MATCH\_ANY            | 匹配任意关键词 | BOOLEAN | 宽泛搜索   |
| MATCH\_PHRASE         | 短语匹配    | BOOLEAN | 顺序敏感搜索 |
| MATCH\_PHRASE\_PREFIX | 短语前缀匹配  | BOOLEAN | 自动补全   |
| MATCH\_REGEXP         | 正则表达式匹配 | BOOLEAN | 模式匹配   |

## 附录# TOKENIZE - 分词测试函数

```sql
TOKENIZE(input, option)
```

**功能**：将文本按指定分词器进行分词，用于验证分词效果

**参数**：

* `input`：要分词的文本
* `option`：分词选项，如 `map('analyzer', 'chinese')`

**使用示例**：

```sql
-- 测试不同分词器效果
SELECT 
    'keyword' as analyzer,
    TOKENIZE('机器学习算法', map('analyzer', 'keyword')) as tokens
UNION ALL
SELECT 
    'chinese',
    TOKENIZE('机器学习算法', map('analyzer', 'chinese'))
UNION ALL
SELECT 
    'unicode',
    TOKENIZE('机器学习算法', map('analyzer', 'unicode'));
```

## 附录# MATCH\_ALL - 全匹配函数

```sql
MATCH_ALL(column, query, option)
```

**功能**：要求文档包含查询文本中的所有分词结果

**逻辑**：AND关系，所有词都必须存在

**使用示例**：

```sql
-- 查找同时包含"机器学习"和"算法"的文档
SELECT id, title FROM documents 
WHERE MATCH_ALL(content, '机器学习 算法', map('analyzer', 'auto'));
```

## 附录# MATCH\_ANY - 任意匹配函数

```sql
MATCH_ANY(column, query, option)
```

**功能**：文档包含查询文本中任意一个分词即可

**逻辑**：OR关系，任一词存在即可

**使用示例**：

```sql
-- 查找包含"人工智能"或"机器学习"或"深度学习"的文档
SELECT id, title FROM documents 
WHERE MATCH_ANY(content, '人工智能 机器学习 深度学习', map('analyzer', 'auto'));
```

## 附录# MATCH\_PHRASE - 短语匹配函数

```sql
MATCH_PHRASE(column, query, option)
```

**功能**：要求文档中包含查询短语，且词序必须一致且连续

**特点**：

* 对词序敏感
* 要求连续出现
* 忽略大小写

**使用示例**：

```sql
-- 查找包含"自然语言处理"短语的文档
SELECT id, title FROM documents 
WHERE MATCH_PHRASE(content, '自然语言处理', map('analyzer', 'auto'));

-- 反例：不会匹配"自然 语言 处理"（不连续）
-- 反例：不会匹配"语言 自然 处理"（顺序不对）
```

## 附录# MATCH\_PHRASE\_PREFIX - 短语前缀匹配

```sql
MATCH_PHRASE_PREFIX(column, query, option)
```

**功能**：前n-1个词按短语匹配，最后一个词按前缀匹配

**适用场景**：搜索建议、自动补全

**使用示例**：

```sql
-- 查找以"数据 分"开头的短语（如"数据分析"、"数据分类"）
SELECT id, title FROM documents 
WHERE MATCH_PHRASE_PREFIX(content, '数据 分', map('analyzer', 'auto'));
```

## 附录# MATCH\_REGEXP - 正则匹配函数

```sql
MATCH_REGEXP(column, query, option)
```

**功能**：对分词结果进行正则表达式匹配

**使用示例**：

```sql
-- 查找包含以"学"结尾的词的文档
SELECT id, title FROM documents 
WHERE MATCH_REGEXP(content, '.*学', map('analyzer', 'auto'));

-- 查找包含数字的文档
SELECT id, title FROM documents 
WHERE MATCH_REGEXP(content, '.*[0-9].*', map('analyzer', 'auto'));
```

## 附录# 重要参数说明

## 附录## 附录 analyzer选项

**推荐使用 `auto` 参数**：

```sql
map('analyzer', 'auto')  -- 自动匹配列的分词设置
```

**手动指定分词器**：

```sql
map('analyzer', 'chinese')
map('analyzer', 'chinese', 'mode', 'smart')
```

⚠️ **重要提醒**：函数中的分词器必须与索引创建时使用的分词器一致，否则无法利用索引加速！

***

## 附录 索引管理

## 附录# 索引生命周期

## 附录## 附录 1. 创建索引

```sql
-- 方式1：建表时创建
CREATE TABLE documents (
    id BIGINT,
    content STRING,
    INDEX content_idx (content) INVERTED PROPERTIES('analyzer'='chinese')
);

-- 方式2：为已有表创建
CREATE INVERTED INDEX content_idx ON TABLE documents(content) 
PROPERTIES('analyzer'='chinese', 'mode'='smart');
```

## 附录## 附录 2. 构建索引（重要！）

```sql
-- 对已有数据构建索引（同步任务）
BUILD INDEX content_idx ON documents;

-- 按分区构建索引
BUILD INDEX content_idx ON documents 
WHERE partition_date >= '2024-01-01';
```

⚠️ **关键提醒**：

* `CREATE INDEX` 仅对新增数据生效
* 已有数据必须执行 `BUILD INDEX` 才能利用索引
* 构建索引会消耗计算资源，建议在业务低峰期执行

## 附录## 附录 3. 查看索引

```sql
-- 列出表上所有索引
SHOW INDEX FROM table_name;

-- 查看索引详情（如果环境支持）
DESC INDEX index_name;
DESC INDEX EXTENDED index_name;  -- 包含大小信息
```

## 附录## 附录 4. 删除索引

```sql
DROP INDEX index_name ON table_name;
```

**删除特点**：

* 立即删除元数据
* 索引文件异步清理
* 不影响数据本身

## 附录# 索引性能调优

## 附录## 附录 分区表索引策略

```sql
-- 大表分区构建建议
BUILD INDEX content_idx ON large_table 
WHERE year = '2024' AND month = '01';

BUILD INDEX content_idx ON large_table 
WHERE year = '2024' AND month = '02';
-- 逐个分区构建，避免资源消耗过大
```

## 附录## 附录 存储成本优化

```sql
-- 查看索引存储占用（如果支持）
DESC INDEX EXTENDED index_name;

-- 根据业务需求选择合适的分词器
-- keyword: 存储最少，仅精确匹配
-- chinese: 中等存储，支持智能分词
-- unicode: 存储最多，支持全语言
```

***

## 附录 应用场景设计

## 附录# 企业知识库系统

```sql
-- 知识库表设计
CREATE TABLE knowledge_base (
    doc_id BIGINT PRIMARY KEY,
    title STRING,
    content STRING,
    category STRING,
    tags STRING,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    
    -- 多层次索引设计
    INDEX title_keyword_idx (title) INVERTED PROPERTIES('analyzer'='keyword'),
    INDEX content_chinese_idx (content) INVERTED PROPERTIES('analyzer'='chinese', 'mode'='smart'),
    INDEX tags_unicode_idx (tags) INVERTED PROPERTIES('analyzer'='unicode')
);

-- 多维度搜索查询
SELECT doc_id, title FROM knowledge_base 
WHERE MATCH_ANY(content, '人工智能 机器学习', map('analyzer', 'auto'))
   OR MATCH_ANY(tags, 'AI ML', map('analyzer', 'auto'))
ORDER BY updated_at DESC LIMIT 20;
```

## 附录# 日志分析系统

```sql
-- 应用日志表
CREATE TABLE application_logs (
    log_id BIGINT,
    timestamp TIMESTAMP,
    level STRING,
    message STRING,
    stack_trace STRING,
    source_ip STRING,
    
    INDEX message_idx (message) INVERTED PROPERTIES('analyzer'='english'),
    INDEX stack_trace_idx (stack_trace) INVERTED PROPERTIES('analyzer'='keyword')
) PARTITIONED BY (DATE(timestamp));

-- 故障排查查询
SELECT log_id, timestamp, message FROM application_logs 
WHERE DATE(timestamp) >= CURRENT_DATE() - INTERVAL '7' DAY
  AND level = 'ERROR'
  AND MATCH_ANY(message, 'timeout connection database', map('analyzer', 'auto'))
ORDER BY timestamp DESC;
```

## 附录# 电商商品搜索

```sql
-- 商品信息表
CREATE TABLE products (
    product_id BIGINT,
    name STRING,
    description STRING,
    brand STRING,
    category STRING,
    tags STRING,
    price DECIMAL(10,2),
    
    INDEX name_chinese_idx (name) INVERTED PROPERTIES('analyzer'='chinese', 'mode'='max_word'),
    INDEX desc_chinese_idx (description) INVERTED PROPERTIES('analyzer'='chinese', 'mode'='max_word'),
    INDEX brand_keyword_idx (brand) INVERTED PROPERTIES('analyzer'='keyword')
);

-- 商品搜索查询
SELECT product_id, name, price FROM products 
WHERE MATCH_ANY(name, '手机 智能 拍照', map('analyzer', 'auto'))
   OR MATCH_ANY(description, '手机 智能 拍照', map('analyzer', 'auto'))
ORDER BY price;
```

## 附录# 内容管理系统

```sql
-- 文章内容表
CREATE TABLE articles (
    article_id BIGINT,
    title STRING,
    content STRING,
    author STRING,
    publish_date DATE,
    status STRING,
    
    INDEX title_chinese_idx (title) INVERTED PROPERTIES('analyzer'='chinese'),
    INDEX content_chinese_idx (content) INVERTED PROPERTIES('analyzer'='chinese', 'mode'='smart'),
    INDEX author_keyword_idx (author) INVERTED PROPERTIES('analyzer'='keyword')
);

-- 内容搜索
SELECT article_id, title, author FROM articles 
WHERE status = 'published'
  AND publish_date >= CURRENT_DATE() - INTERVAL '30' DAY
  AND MATCH_PHRASE(content, '技术发展趋势', map('analyzer', 'auto'))
ORDER BY publish_date DESC;
```

***

## 附录 重要避坑指南

## 附录# 分词器一致性问题

## 附录## 附录 常见错误：分词器不匹配

```sql
-- ❌ 错误示例：索引使用chinese分词，查询使用english分词
CREATE TABLE docs (
    content STRING,
    INDEX content_idx (content) INVERTED PROPERTIES('analyzer'='chinese')
);

SELECT * FROM docs 
WHERE MATCH_ANY(content, '测试', map('analyzer', 'english'));
-- 结果：无法利用索引，性能差
```

## 附录## 附录 正确做法：

```sql
-- ✅ 方案1：使用auto参数（推荐）
SELECT * FROM docs 
WHERE MATCH_ANY(content, '测试', map('analyzer', 'auto'));

-- ✅ 方案2：手动匹配索引分词器
SELECT * FROM docs 
WHERE MATCH_ANY(content, '测试', map('analyzer', 'chinese'));
```

## 附录# 索引构建避坑

## 附录## 附录 BUILD INDEX的必要性

```sql
-- ❌ 常见错误：忘记构建索引
CREATE INVERTED INDEX content_idx ON TABLE existing_table(content) 
PROPERTIES('analyzer'='chinese');

-- 直接查询（只对新数据有效，已有数据无法利用索引）
SELECT * FROM existing_table 
WHERE MATCH_ANY(content, '关键词', map('analyzer', 'auto'));
```

## 附录## 附录 正确的索引构建流程

```sql
-- ✅ 完整流程
-- 1. 创建索引
CREATE INVERTED INDEX content_idx ON TABLE existing_table(content) 
PROPERTIES('analyzer'='chinese');

-- 2. 构建索引（必须！）
BUILD INDEX content_idx ON existing_table;

-- 3. 验证索引
SHOW INDEX FROM existing_table;

-- 4. 执行查询
SELECT * FROM existing_table 
WHERE MATCH_ANY(content, '关键词', map('analyzer', 'auto'));
```

## 附录# 查询性能避坑

## 附录## 附录 亚秒查询的性能限制

根据官方文档：**在大多数情况下，倒排索引并不会显著提高执行时间为亚秒的查询的性能**。

<1秒）
-- 3. 简单的等值查询

-- ✅ 适合倒排索引的场景
-- 1. 大数据量表（万行以上）
-- 2. 复杂的文本搜索
-- 3. 多关键词匹配
```

#### 不支持的查询模式

```sql
-- ❌ 不支持：对列进行类型转换
SELECT * FROM docs 
WHERE MATCH_ANY(CAST(id AS STRING), '123', map('analyzer', 'auto'));

-- ✅ 支持：对查询值进行转换
SELECT * FROM docs 
WHERE MATCH_ANY(content, CAST(123 AS STRING), map('analyzer', 'auto'));

-- ❌ 不支持：外部表
-- 倒排索引不支持外部表
```

### 存储成本避坑

#### 索引存储开销

```sql
-- 倒排索引会创建额外的索引文件
-- 存储成本 = 原始数据 + 索引文件

-- 优化建议：
-- 1. 仅为真正需要搜索的列创建索引
-- 2. 根据查询模式选择合适的分词器
-- 3. 定期清理不必要的索引
```

#### 分词器选择策略

| 分词器     | 索引大小 | 查询性能 | 功能丰富度 | 推荐场景     |
| ------- | ---- | ---- | ----- | -------- |
| keyword | 最小   | 最快   | 精确匹配  | ID、状态、标签 |
| english | 小    | 快    | 英文分词  | 纯英文内容    |
| chinese | 中等   | 中等   | 中文分词  | 中文文档     |
| unicode | 最大   | 相对慢  | 全语言支持 | 多语言混合    |

***

## 性能优化

### 查询优化策略

#### 1. 合理选择查询函数

```sql
-- 根据业务需求选择合适的函数
-- 精确搜索：使用 MATCH_ALL
SELECT * FROM docs WHERE MATCH_ALL(content, '机器学习 算法', map('analyzer', 'auto'));

-- 宽泛搜索：使用 MATCH_ANY  
SELECT * FROM docs WHERE MATCH_ANY(content, '人工智能 机器学习 深度学习', map('analyzer', 'auto'));

-- 短语搜索：使用 MATCH_PHRASE
SELECT * FROM docs WHERE MATCH_PHRASE(content, '自然语言处理', map('analyzer', 'auto'));
```

#### 2. 组合查询优化

```sql
-- ✅ 推荐：将全文检索作为主要过滤条件
SELECT * FROM documents 
WHERE MATCH_ANY(content, '关键词', map('analyzer', 'auto'))
  AND category = 'tech'  -- 在全文检索基础上进行二次过滤
  AND created_at >

## 附录## 附录 3. 分页查询优化

```sql
-- ✅ 高效的分页查询
SELECT id, title FROM documents 
WHERE MATCH_ANY(content, '关键词', map('analyzer', 'auto'))
ORDER BY id  -- 使用主键排序
LIMIT 20 OFFSET 0;

-- ⚠️ 避免深度分页
-- LIMIT 20 OFFSET 10000; -- 性能会随offset增大而下降
```

## 附录# 索引优化策略

## 附录## 附录 1. 分区表索引管理

```sql
-- 按分区逐步构建索引
BUILD INDEX content_idx ON large_table 
WHERE year = '2024' AND month = '06';

-- 监控构建进度
-- 可通过Job Profile查看进度
```

## 附录## 附录 2. 索引维护策略

```sql
-- 定期检查索引状态
SHOW INDEX FROM table_name;

-- 对于经常更新的表，可能需要重建索引
DROP INDEX old_idx ON table_name;
CREATE INVERTED INDEX new_idx ON TABLE table_name(column) 
PROPERTIES('analyzer'='chinese');
BUILD INDEX new_idx ON table_name;
```

## 附录# 系统资源优化

## 附录## 附录 1. 计算资源配置

* **索引构建**：使用较大的Virtual Cluster进行BUILD INDEX操作
* **查询执行**：可使用较小的Virtual Cluster进行日常查询
* **混合负载**：分离索引构建和查询工作负载

## 附录## 附录 2. 存储资源优化

```sql
-- 监控索引存储占用（如果支持）
DESC INDEX EXTENDED index_name;

-- 清理不必要的索引
DROP INDEX unused_idx ON table_name;
```

***

## 附录 迁移策略

## 附录# 从传统LIKE查询迁移

## 附录## 附录 迁移评估

**适合迁移的场景**：

* 频繁的文本搜索查询
* 大数据量表（万行以上）
* 复杂的多关键词搜索
* 需要中文分词的场景

**不急于迁移的场景**：

* 小数据量表
* 偶尔的文本查询
* 已经很快的简单查询（<1秒）

#### 迁移步骤

```sql
-- 1. 分析现有查询模式
-- 识别频繁的LIKE查询
SELECT query_text, execution_count 
FROM query_logs 
WHERE query_text LIKE '%LIKE%'
ORDER BY execution_count DESC;

-- 2. 创建测试表验证效果
CREATE TABLE docs_test AS SELECT * FROM docs_original LIMIT 1000;

-- 3. 添加倒排索引
CREATE INVERTED INDEX content_idx ON TABLE docs_test(content) 
PROPERTIES('analyzer'='chinese');

BUILD INDEX content_idx ON docs_test;

-- 4. 性能对比测试
-- 原始LIKE查询
SELECT COUNT(*) FROM docs_test WHERE content LIKE '%关键词%';

-- 全文检索查询
SELECT COUNT(*) FROM docs_test 
WHERE MATCH_ANY(content, '关键词', map('analyzer', 'auto'));

-- 5. 逐步迁移生产环境
```

### 从外部搜索引擎迁移

#### Elasticsearch迁移对照

| Elasticsearch查询       | Lakehouse全文检索         | 说明      |
| --------------------- | --------------------- | ------- |
| `match_all`           | `MATCH_ALL`           | 匹配所有关键词 |
| `match`               | `MATCH_ANY`           | 匹配任意关键词 |
| `match_phrase`        | `MATCH_PHRASE`        | 短语匹配    |
| `match_phrase_prefix` | `MATCH_PHRASE_PREFIX` | 短语前缀匹配  |
| `regexp`              | `MATCH_REGEXP`        | 正则表达式匹配 |

#### 迁移收益评估

**架构简化收益**：

* 减少1个独立的搜索引擎系统
* 统一数据存储和检索平台
* 降低运维复杂度

**成本优化收益**：

* 减少额外的存储和计算资源
* 无需数据同步ETL流程
* 降低系统总体拥有成本

**数据一致性收益**：

* 强一致性保证
* 无数据同步延迟
* 实时搜索最新数据

### 混合方案设计

对于复杂的企业环境，可以采用混合方案：

```sql
-- 方案1：按数据类型分离
-- 结构化查询 + 简单文本搜索：使用Lakehouse全文检索
-- 复杂语义搜索 + 推荐算法：保留Elasticsearch

-- 方案2：按实时性分离  
-- 实时搜索：使用Lakehouse全文检索
-- 离线分析：使用Elasticsearch

-- 方案3：按数据规模分离
-- 大数据量：使用Lakehouse全文检索
-- 小数据量快速原型：使用Elasticsearch
```

***

## 最佳实践总结

### 索引设计最佳实践

#### 1. 分词器选择原则

```sql
-- 根据数据特点选择分词器
CREATE TABLE multilingual_docs (
    id BIGINT,
    title_cn STRING,      -- 中文标题
    title_en STRING,      -- 英文标题  
    content STRING,       -- 混合内容
    tags STRING,          -- 标签（精确匹配）
    
    INDEX title_cn_idx (title_cn) INVERTED PROPERTIES('analyzer'='chinese', 'mode'='smart'),
    INDEX title_en_idx (title_en) INVERTED PROPERTIES('analyzer'='english'),
    INDEX content_idx (content) INVERTED PROPERTIES('analyzer'='unicode'),
    INDEX tags_idx (tags) INVERTED PROPERTIES('analyzer'='keyword')
);
```

#### 2. 索引维护策略

```sql
-- 生产环境索引维护流程
-- 1. 非峰期创建索引
CREATE INVERTED INDEX content_idx ON TABLE large_table(content) 
PROPERTIES('analyzer'='chinese');

-- 2. 分批构建索引
BUILD INDEX content_idx ON large_table 
WHERE partition_date = '2024-06-01';

-- 3. 验证索引效果
SELECT COUNT(*) FROM large_table 
WHERE MATCH_ANY(content, '测试关键词', map('analyzer', 'auto'));

-- 4. 监控索引状态
SHOW INDEX FROM large_table;
```

### 查询模式最佳实践

#### 1. 查询函数选择指南

| 业务场景      | 推荐函数                  | 示例查询               |
| --------- | --------------------- | ------------------ |
| 精确搜索多个关键词 | MATCH\_ALL            | 必须包含"AI"和"机器学习"    |
| 宽泛主题搜索    | MATCH\_ANY            | 包含"AI"或"ML"或"深度学习" |
| 专业术语搜索    | MATCH\_PHRASE         | 精确匹配"自然语言处理"       |
| 搜索建议/自动补全 | MATCH\_PHRASE\_PREFIX | 以"数据分"开头的短语        |
| 模式匹配      | MATCH\_REGEXP         | 包含数字或特定格式          |

#### 2. 性能优化查询模式

```sql
--  高效查询模式
-- 1. 利用分区过滤
SELECT * FROM logs 
WHERE log_date >）

## 附录# 监控和诊断

## 附录## 附录 1. 索引效果验证

```sql
-- 验证索引是否被使用（通过执行计划）
EXPLAIN SELECT * FROM documents 
WHERE MATCH_ANY(content, '关键词', map('analyzer', 'auto'));

-- 对比LIKE查询性能
-- 方法：记录查询执行时间，对比优化效果
```

## 附录## 附录 2. 常见问题诊断

```sql
-- 检查分词效果
SELECT TOKENIZE('测试文本', map('analyzer', 'auto'));

-- 检查索引状态
SHOW INDEX FROM table_name;

-- 验证查询语法
SELECT MATCH_ANY('测试文本', '关键词', map('analyzer', 'chinese'));
```

***

## 附录 已知限制与注意事项

## 附录# 功能限制

## 附录## 附录 1. 不支持的场景

* **外部表**：倒排索引不支持外部表
* **列类型转换**：不支持对表列进行强制类型转换

## 附录## 附录 2. 查询限制

```sql
-- ❌ 不支持的查询模式
-- 1. 对表列进行类型转换
WHERE MATCH_ANY(CAST(column AS STRING), 'value', map('analyzer', 'auto'))

-- 2. 在外部表上创建倒排索引
CREATE INVERTED INDEX idx ON EXTERNAL_TABLE table_name(column) 
PROPERTIES('analyzer'='chinese');
```

## 附录# 性能考虑

## 附录## 附录 1. 索引构建成本

* BUILD INDEX是同步操作，会消耗计算资源
* 大表建议分区逐步构建
* 建议在业务低峰期执行

## 附录## 附录 2. 存储成本

* 倒排索引会创建额外的索引文件
* 索引大小取决于数据量和分词器类型
* 需要在查询性能和存储成本间平衡

## 附录# 运维注意事项

## 附录## 附录 1. 版本兼容性

* 建议在测试环境充分验证
* 关注版本更新和功能改进

## 附录## 附录 2. 备份恢复

* 索引元数据会随表结构备份
* 索引文件需要重新构建
* 恢复后需要执行BUILD INDEX

## 附录

## 附录# 快速参考卡片

## 附录## 附录 分词器选择速查

```sql
-- 精确匹配（ID、状态等）
'analyzer'='keyword'

-- 纯英文内容
'analyzer'='english'

-- 中文内容（推荐）
'analyzer'='chinese', 'mode'='smart'

-- 多语言混合
'analyzer'='unicode'

-- 自动匹配（推荐）
'analyzer'='auto'
```

## 附录## 附录 常用查询模板

```sql
-- 1. 基础文本搜索
SELECT * FROM table_name 
WHERE MATCH_ANY(column, '关键词', map('analyzer', 'auto'));

-- 2. 精确短语搜索
SELECT * FROM table_name 
WHERE MATCH_PHRASE(column, '精确短语', map('analyzer', 'auto'));

-- 3. 多条件组合搜索
SELECT * FROM table_name 
WHERE MATCH_ALL(content, '关键词1 关键词2', map('analyzer', 'auto'))
  AND category = 'target_category';

-- 4. 分页查询
SELECT id, title FROM table_name 
WHERE MATCH_ANY(content, '关键词', map('analyzer', 'auto'))
ORDER BY id LIMIT 20 OFFSET 0;
```

## 附录## 附录 索引管理命令

```sql
-- 创建索引
CREATE INVERTED INDEX idx_name ON TABLE table_name(column) 
PROPERTIES('analyzer'='chinese');

-- 构建索引
BUILD INDEX idx_name ON table_name;

-- 查看索引
SHOW INDEX FROM table_name;

-- 删除索引
DROP INDEX idx_name ON table_name;
```

***

**注意**：本文档基于Lakehouse 2025年6月的产品文档整理，建议定期查看官方文档获取最新更新。在生产环境中使用前，请务必在测试环境中验证所有操作的正确性和性能影响。
