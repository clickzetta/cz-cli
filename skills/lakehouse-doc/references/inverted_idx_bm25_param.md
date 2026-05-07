# Lakehouse 倒排索引 BM25 参数调优

BM25（Best Matching 25）是现代全文检索中最重要的相关性评分算法之一。Lakehouse 的倒排索引支持 BM25 算法，并允许用户调整关键参数以优化不同场景下的搜索效果。

支持参数：

`k1`  - 词频饱和度控制

* **取值范围**:` [0.0, 3.0]`，推荐范围 `[1.0, 2.0]`

* **默认值**: `1.2`

* **作用**: 控制词频对相关性评分的影响程度

* **效果**:

  * **k1 越大**: 词频对评分的影响越大，高频词文档更容易获得高评分
* **k1 越小**: 词频饱和更快，减少高频词的过度影响

`b`  - 文档长度归一化

* **取值范围**:` [0.0, 1.0]`

* **默认值**: `0.75`

* **作用**: 控制文档长度对相关性评分的影响程度

* **效果**:

  * **b = 0**: 完全忽略文档长度，长短文档同等对待
  * **b = 1**: 完全长度归一化，短文档获得显著优势
  * **b = 0.75**: 平衡长度影响，适合大多数场景

在 Lakehouse 中，通过在 SQL 语句之前添加以下语句：

```
SET cz.storage.parquet.inverted.index.similarity.bm25={"k1": 1.2, "b": 0.75} 
```

实现对搜索效果的控制。

## 示例：

### Step 1：数据准备

```
-- 1. CREATE TEST TABLE

CREATE TABLE bm25_demo_table (
    id INT,
    title STRING,
    content_en STRING,
    content_cn STRING,
    doc_type STRING
);

-- 2. Create index and insert data
CREATE INVERTED INDEX idx_content_cn_score ON TABLE bm25_demo_table(content_cn) 
     PROPERTIES("analyzer"="chinese", "support_score"="true")
;
CREATE INVERTED INDEX idx_content_en_score ON TABLE bm25_demo_table(content_en) 
     PROPERTIES("analyzer"="english", "support_score"="true")
;

INSERT INTO bm25_demo_table VALUES
-- 短文档系列：高密度关键词
(1, 'AI简介', 'AI technology.', '人工智能技术。', 'short'),
(2, 'AI应用', 'AI AI applications in business.', '人工智能人工智能在商业中的应用。', 'short'),

-- 中等文档系列：中等密度关键词  
(3, 'AI发展历史', 'The history of AI technology spans decades. AI researchers developed machine learning algorithms. Modern AI systems use deep learning techniques.', '人工智能技术的发展历史跨越数十年。人工智能研究者开发了机器学习算法。现代人工智能系统使用深度学习技术。', 'medium'),
(4, 'AI实际应用', 'AI technology revolutionizes industries. Companies implement AI solutions for automation. AI chatbots improve customer service efficiency.', '人工智能技术革命性地改变了各行各业。公司实施人工智能解决方案进行自动化。人工智能聊天机器人提高客户服务效率。', 'medium'),

-- 长文档系列：低密度但多次出现
(5, 'AI技术综述', 'Artificial intelligence represents one of the most transformative technologies of our time. AI systems can process vast amounts of data, recognize patterns, and make predictions with remarkable accuracy. The field of AI encompasses machine learning, deep learning, natural language processing, and computer vision. Modern AI applications span across healthcare, finance, transportation, and entertainment industries. As AI technology continues to evolve, researchers are exploring new frontiers in artificial general intelligence and quantum computing integration with AI systems.', '人工智能代表了我们时代最具变革性的技术之一。人工智能系统可以处理大量数据，识别模式，并以惊人的准确性进行预测。人工智能领域包括机器学习、深度学习、自然语言处理和计算机视觉。现代人工智能应用跨越医疗保健、金融、交通运输和娱乐行业。随着人工智能技术的不断发展，研究人员正在探索通用人工智能和量子计算与人工智能系统集成的新前沿。', 'long'),

-- 干扰文档：不包含目标关键词
(6, '区块链技术', 'Blockchain technology provides decentralized solutions. Cryptocurrency mining requires significant computational power. Smart contracts automate business processes.', '区块链技术提供去中心化解决方案。加密货币挖矿需要大量计算能力。智能合约自动化业务流程。', 'control'),

-- 高频关键词文档
(7, 'AI密集讨论', 'AI AI AI is everywhere. AI development, AI research, AI implementation, AI optimization, AI performance, AI scalability, AI security, AI ethics, AI governance, AI regulation.', '人工智能人工智能人工智能无处不在。人工智能开发、人工智能研究、人工智能实施、人工智能优化、人工智能性能、人工智能可扩展性、人工智能安全、人工智能伦理、人工智能治理、人工智能监管。', 'high_freq'),

-- 低频但精确匹配
(8, '精确AI定义', 'The definition of AI varies among experts.', '人工智能的定义在专家中各不相同。', 'precise')
;
```

> 注意：如果先插入数据，再创建索引，需要 BUILD INDEX 使索引生效：
>
> ```
> BUILD INDEX idx_content_cn_score ON bm25_demo_table;
> BUILD INDEX idx_content_en_score ON bm25_demo_table;
> ```

我们构造了一个包含不同类型文档的测试集：

* **短文档** (2-20 字符): 高关键词密度
* **中等文档** (100-200 字符): 中等关键词密度
* **长文档** (500+ 字符): 低关键词密度但多次出现
* **高频文档**: 大量重复关键词
* **精确匹配**: 少量但精确的关键词匹配

### Step 2 搜索验证：

#### 英文搜索测试

**情况1：默认参数** `(undefined) ` - **平衡配置**

搜索关键词：`"AI"`

```
SELECT score (),
    id,
    title,
    doc_type,
    LENGTH(content_en) AS len,
    REGEXP_COUNT (content_en, 'AI') AS ai_count,
    SUBSTRING(content_en, 1, 50) AS preview
FROM bm25_demo_table
WHERE match_any(content_en, 'AI')
ORDER BY score () DESC, id
LIMIT 50;
```

| score()    | id | title  | doc\_type  | len | ai\_count | preview                                            |
| ---------- | -- | ------ | ---------- | --- | --------- | -------------------------------------------------- |
| 0.16484952 | 7  | AI密集讨论 | high\_freq | 174 | 13        | AI AI AI is everywhere. AI development, AI researc |
| 0.14495456 | 2  | AI应用   | short      | 31  | 2         | AI AI applications in business.                    |
| 0.13709007 | 4  | AI实际应用 | medium     | 138 | 3         | AI technology revolutionizes industries. Companies |
| 0.13152356 | 1  | AI简介   | short      | 14  | 1         | AI technology.                                     |
| 0.13141003 | 3  | AI发展历史 | medium     | 145 | 3         | The history of AI technology spans decades. AI res |
| 0.1138232  | 8  | 精确AI定义 | precise    | 42  | 1         | The definition of AI varies among experts.         |
| 0.10628956 | 5  | AI技术综述 | long       | 580 | 5         | Artificial intelligence represents one of the most |

**关键观察**：
* 高频词文档排名第一（符合预期）
* 短文档获得显著的长度优势
* 长文档尽管有较多匹配，但被长度惩罚

**情况2**：`undefined ` - **忽略文档长度**

```
SET cz.storage.parquet.inverted.index.similarity.bm25={"k1": 1.2, "b": 0.0};
SELECT score (),
    id,
    title,
    doc_type,
    LENGTH(content_en) AS len,
    REGEXP_COUNT (content_en, 'AI') AS ai_count,
    SUBSTRING(content_en, 1, 50) AS preview
FROM bm25_demo_table
WHERE match_any(content_en, 'AI')
ORDER BY score () DESC, id
LIMIT 10;
```

| score()        | id    | title      | doc\_type  | len     | ai\_count | preview                                                |
| -------------- | ----- | ---------- | ---------- | ------- | --------- | ------------------------------------------------------ |
| 0.16691414     | 7     | AI密集讨论     | high\_freq | 174     | 13        | AI AI AI is everywhere. AI development, AI researc     |
| **0.14703354** | **5** | **AI技术综述** | **long**   | **580** | **5**     | **Artificial intelligence represents one of the most** |
| 0.13022971     | 3     | AI发展历史     | medium     | 145     | 3         | The history of AI technology spans decades. AI res     |
| 0.13022971     | 4     | AI实际应用     | medium     | 138     | 3         | AI technology revolutionizes industries. Companies     |
| 0.11395099     | 2     | AI应用       | short      | 31      | 2         | AI AI applications in business.                        |
| 0.08287345     | 1     | AI简介       | short      | 14      | 1         | AI technology.                                         |
| 0.08287345     | 8     | 精确AI定义     | precise    | 42      | 1         | The definition of AI varies among experts.             |

**关键观察**：
* **长文档显著受益**：从最后一名跃升到第二名
* **短文档失去优势**：长度优势被完全消除
* **纯粹按词频排序**：完全基于内容相关性

^

### 中文搜索测试

**情况1：默认参数** `(undefined) ` - **平衡配置**

```
SET cz.storage.parquet.inverted.index.similarity.bm25={"k1": 1.2, "b": 0.75};
SELECT score (),
    id,
    title,
    doc_type,
    LENGTH(content_en) AS len,
    REGEXP_COUNT (content_en, '人工智能') AS ai_count,
    SUBSTRING(content_en, 1, 50) AS preview
FROM bm25_demo_table
WHERE match_any(content_en, '人工智能')
ORDER BY score () DESC, id
LIMIT 10;
```

| score()     | id | title  | doc\_type  | len | ai\_count | preview                                            |
| ----------- | -- | ------ | ---------- | --- | --------- | -------------------------------------------------- |
| 0.16505295  | 7  | AI密集讨论 | high\_freq | 89  | 13        | 人工智能人工智能人工智能无处不在。人工智能开发、人工智能研究、人工智能实施、人工智能优化、人工智能性 |
| 0.13975275  | 2  | AI应用   | short      | 16  | 2         | 人工智能人工智能在商业中的应用。                                   |
| 0.13214059  | 4  | AI实际应用 | medium     | 54  | 3         | 人工智能技术革命性地改变了各行各业。公司实施人工智能解决方案进行自动化。人工智能聊天机器人提高客户服 |
| 0.1313231   | 1  | AI简介   | short      | 7   | 1         | 人工智能技术。                                            |
| 0.12937927  | 3  | AI发展历史 | medium     | 51  | 3         | 人工智能技术的发展历史跨越数十年。人工智能研究者开发了机器学习算法。现代人工智能系统使用深度学习技术 |
| 0.12602468  | 5  | AI技术综述 | long       | 161 | 7         | 人工智能代表了我们时代最具变革性的技术之一。人工智能系统可以处理大量数据，识别模式，并以惊人的准确性 |
| 0.113299355 | 8  | 精确AI定义 | precise    | 16  | 1         | 人工智能的定义在专家中各不相同。                                   |

## 参数调优策略

### 场景化参数推荐

#### 1. 新闻搜索场景

```sql
-- 优化配置：平衡词频和文档长度
SET cz.storage.parquet.inverted.index.similarity.bm25={"k1": 1.2, "b": 0.8};
```

* **适用场景**：新闻文章、博客内容
* **优化目标**：短文档获得更多关注，避免长文章淹没重要短讯
* **效果**：提升短新闻的曝光度

#### 2. 学术文献搜索

```sql
-- 优化配置：降低长度惩罚，重视内容质量
SET cz.storage.parquet.inverted.index.similarity.bm25={"k1": 1.0, "b": 0.3};
```

* **适用场景**: 论文、研究报告、技术文档
* **优化目标**: 长文档不被过度惩罚，内容丰富性更重要
* **效果**：详细文档排名提升

#### 3. 产品搜索场景

```sql
-- 优化配置：强化精确匹配
SET cz.storage.parquet.inverted.index.similarity.bm25={"k1": 0.8, "b": 0.5};
```

* **适用场景**: 电商搜索、产品目录
* **优化目标**: 精确匹配优于高频匹配
* **效果**：减少词频堆积对排名的影响

#### 4. 社交媒体搜索

```sql
-- 优化配置：重视短内容
SET cz.storage.parquet.inverted.index.similarity.bm25={"k1": 1.5, "b": 0.9};
```

* **适用场景**: 微博、评论、短视频描述
* **优化目标**: 短内容优先，快速定位关键信息
* **效果**：短内容排名显著提升

^
