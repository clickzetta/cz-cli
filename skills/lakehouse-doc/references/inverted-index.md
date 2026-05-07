# 倒排索引

## 概述

### 倒排索引原理介绍

1. 基本概念
   倒排索引由两部分组成：
   * **词典（Dictionary）**：存储所有文档集合中出现过的唯一单词（或短语）的列表。
   * **倒排表（Posting List）**：对于词典中的每个单词，都有一个与之对应的倒排列表，记录了包含这个单词的所有文档的文档ID以及单词在文档中出现的位置信息。

2. 构建过程
   * **分词（Tokenization）**：将文档内容分割成单词或短语的过程。
   * **标准化（Normalization）**：对分词结果进行处理，如转小写、去除停用词、词干提取等。
   * **构建词典**：将处理后的单词加入词典，并为每个单词分配一个唯一的ID。
   * **构建倒排列表**：对于每个文档，记录下文档中所有单词的ID和位置信息，并将这些信息与词典中的单词ID关联起来，形成倒排列表。

3. 查询过程
   当用户提交一个查询请求时，搜索引擎会执行以下步骤：
   * **查询解析**：将用户的查询语句分解成单词或短语。
   * **查找词典**：在词典中查找这些单词或短语的ID。
   * **检索倒排列表**：根据单词ID，从倒排列表中检索包含这些单词的所有文档ID。
   * **合并结果**：根据查询语句中的逻辑（如AND、OR、NOT等），合并不同单词的检索结果，确定最终的文档列表。

4. 应用场景
   倒排索引主要用于全文搜索领域，如搜索引擎、文档检索系统等，它能够快速响应用户的查询请求，提供高效的检索服务。

### 功能介绍

利用倒排索引可以根据关键词快速定位包含它的行，达到查询加速的目的。同时，如上文原理介绍，词典和倒排列表会产生额外的 Lakehouse 存储。

1. 全文检索能力
   支持字符串类型的全文检索，支持`match_all`、`match_any`、`match_phrase`、`match_phrase_prefix`、`match_regexp`函数。Lakehouse 在部分场景下`like`也会使用倒排索引，但仍推荐您使用全文检索函数。

2. 查询加速
   * 支持字符串、数值类型的 =、!=、>、>=、<, <=
BUILD INDEX index_name ON table_name WHERE partition_name1 = '1' and partition_name2 = '2';
```

* index\_name：指定要添加倒排索引名称
* 支持指定分区构建：可以指定一个或者多个

#### 说明

执行BUILD INDEX是一个同步任务，执行过程会消耗计算资源。查看进度可以通过Job Profile查看。

当分区表数据量较大时，建议以分区为粒度依次创建索引。

#### 案例

```SQL
BUILD INDEX bulkload_data_index ON public.bulkload_data ;
```

### 列出表上所有的倒排索引

命令用于列出指定表中已创建的倒排索引。

#### 语法

```SQL
SHOW INDEX FROM [schema].table_name;
```

#### 案例

```SQL
 show index from public.bulkload_data;
+---------------------+------------+
|     index_name      | index_type |
+---------------------+------------+
| bulkload_data_index | inverted   |
+---------------------+------------+
```

### 查看倒排索引详情

本命令用于列出指定表中已创建的倒排索引的详情，添加上extended关键字可以查看倒排索引大小。

#### 语法

```SQL
DESC INDEX [EXTENDED]  index_name;
```

#### 案例

```SQL
desc index bulkload_data_index;
+--------------------+-------------------------+
|     info_name      |       info_value        |
+--------------------+-------------------------+
| name               | bulkload_data_index     |
| creator            | system_admin            |
| created_time       | 2024-05-27 16:11:23.928 |
| last_modified_time | 2024-05-27 16:11:23.928 |
| comment            |                         |
| index_type         | inverted                |
| table_name         | bulkload_data           |
| table_column       | data                    |
+--------------------+-------------------------+

desc index extended  bulkload_data_index;
+--------------------------+--------------------------+
|        info_name         |        info_value        |
+--------------------------+--------------------------+
| name                     | bulkload_data_index      |
| creator                  | system_admin             |
| created_time             | 2024-05-27 16:11:23.928  |
| last_modified_time       | 2024-05-27 16:11:23.928  |
| comment                  |                          |
| properties               | (("analyzer","unicode")) |
| index_type               | inverted                 |
| table_name               | bulkload_data            |
| table_column             | data                     |
| index_size_in_data_file  | 0                        |
| index_size_in_index_file | 0                        |
| total_index_size         | 0                        |
+--------------------------+--------------------------+
```

### 删除倒排索引

#### 语法

```SQL
DROP INDEX [IF EXISTS] index_name;
```

参数说明：

* `DROP INDEX`：删除索引的关键字。
* `IF EXISTS`：可选参数，如果指定的索引不存在，则不报错。
* `index_name`：要删除的索引名称。

#### 说明

执行drop index会立即成功，会删除掉index的元数据信息。但是不会立即删除索引存储信息。

## 分析器高级配置

在创建倒排索引时，除了指定分析器类型（`analyzer`），还可以通过 `PROPERTIES` 配置停用词（stopwords）和词干提取（stemmer），进一步控制分词行为。

### 停用词（Stopwords）

停用词是指在全文检索中通常不携带实质意义、需要过滤掉的常见词汇（如英文中的 "the"、"is"、"a" 等）。过滤停用词可以减小索引体积、提升检索精度。

支持两种配置方式：

| 属性 | 说明 |
|------|------|
| `stopwords` | 使用内置停用词表，目前支持 `english` |
| `custom_stopwords` | 自定义停用词，多个词用英文逗号分隔，优先级高于 `stopwords` |

**默认行为**：不配置时停用词过滤默认关闭，所有词均会被索引。

**示例：使用内置英文停用词**

```SQL
CREATE TABLE articles(
   id INT,
   content STRING,
   INDEX content_index (content) INVERTED PROPERTIES('analyzer'='english', 'stopwords'='english')
);
```

分词效果：`"The quick brown fox"` → `["quick", "brown", "fox"]`（"the" 被过滤）

**示例：使用自定义停用词**

```SQL
CREATE TABLE articles(
   id INT,
   content STRING,
   INDEX content_index (content) INVERTED PROPERTIES('analyzer'='english', 'custom_stopwords'='hello,world,test')
);
```

分词效果：`"hello world this is a test"` → `["this", "is", "a"]`

> **注意**：`custom_stopwords` 与 `stopwords` 同时配置时，`custom_stopwords` 优先生效，内置停用词表不会被使用。

**内置英文停用词列表**

内置英文停用词基于 Lucene/Elasticsearch 标准停用词表，包含：`a`、`an`、`and`、`are`、`as`、`at`、`be`、`but`、`by`、`for`、`if`、`in`、`into`、`is`、`it`、`no`、`not`、`of`、`on`、`or`、`such`、`that`、`the`、`their`、`then`、`there`、`these`、`they`、`this`、`to`、`was`、`will`、`with`。

### 词干提取（Stemmer）

词干提取将单词还原为词根形式，使不同形态的同一词汇能够匹配（如 `running`、`runs`、`ran` 均还原为 `run`）。底层使用 [Snowball](https://snowballstem.org/) 算法库。

配置方式：

| 属性 | 说明 |
|------|------|
| `stemmer` | 指定 Snowball 算法，格式为 `snowball_<language>`，如 `snowball_english`、`snowball_german`、`snowball_french` 等 |

**示例：英文词干提取**

```SQL
CREATE TABLE articles(
   id INT,
   content STRING,
   INDEX content_index (content) INVERTED PROPERTIES('analyzer'='english', 'stemmer'='snowball_english')
);
```

分词效果：`"running quickly"` → `["run", "quick"]`

**示例：词干提取 + 停用词组合使用**

```SQL
CREATE TABLE articles(
   id INT,
   content STRING,
   INDEX content_index (content) INVERTED PROPERTIES(
     'analyzer'='english',
     'stemmer'='snowball_english',
     'stopwords'='english'
   )
);
```

分词效果：`"The dogs are running"` → `["dog", "run"]`（"the"、"are" 被停用词过滤，"dogs" 和 "running" 经词干提取还原）

> **注意**：词干提取在停用词过滤之前执行，处理顺序为：分词器 → 词干提取 → 停用词过滤。

**在查询函数中使用**

查询时同样可以通过 `option` 参数指定停用词和词干提取，确保查询分词与索引分词一致：

```SQL
-- 使用停用词
SELECT tokenize('The quick brown fox', map('analyzer', 'english', 'stopwords', 'english'));
-- 返回: ["quick", "brown", "fox"]

-- 使用词干提取
SELECT tokenize('running quickly', map('analyzer', 'english', 'stemmer', 'snowball_english'));
-- 返回: ["run", "quick"]

-- 组合使用
SELECT match_all(content, 'dogs running', map('analyzer', 'english', 'stemmer', 'snowball_english', 'stopwords', 'english'))
FROM articles;
```

## 使用倒排索引查询

### 倒排索引函数

函数中要求分词和表保持一致，否则无法使用倒排索引加速查询。不指定option参数时会自动映射字段已有索引中的分词。

#### tokenize

**语法：**

```SQL
tokenize(input[, option])
```

**功能：** 分词，返回值为array

**示例：**

```SQL
SELECT tokenize('a b', map('analyzer', 'english'));
-- 返回: ["a", "b"]
```

#### match_all

**语法：**

```SQL
match_all(input, query[, option])
```

**功能：** 匹配所有，先将query分词，再将input分词，需要保证input的分词结果包含所有query分词结果，返回bool

**示例：**

```SQL
SELECT match_all('a b c', 'b a', map('analyzer', 'english'));
-- 返回: true
```

#### match_any

**语法：**

```SQL
match_any(input, query[, option])
```

**功能：** 匹配任意，input的分词结果包含query分词结果的任意元素即可，返回bool

**示例：**

```SQL
SELECT match_any('a b c', 'd a', map('analyzer', 'english'));
-- 返回: true
```

#### match_phrase

**语法：**

```SQL
match_phrase(input, query[, option])
```

**功能：** 匹配短语，在match_all的基础上，匹配的结果顺序要和query分词结果的顺序要一致且连续

**示例：**

```SQL
SELECT match_phrase('a b c', 'a b', map('analyzer', 'english'));
-- 返回: true

SELECT match_phrase('a b c', 'a c', map('analyzer', 'english'));
-- 返回: false (因为'a'和'c'在原文中不连续)
```

#### match_phrase_prefix

**语法：**

```SQL
match_phrase_prefix(input, query[, option])
```

**功能：** 匹配短语前缀，input的分词结果，前n-1个匹配规则和match_phrase相同，最后一个元素符合前缀匹配

**示例：**

```SQL
SELECT match_phrase_prefix('a b cd', 'b c', map('analyzer', 'english'));
-- 返回: true
```

#### match_regexp

**语法：**

```SQL
match_regexp(input, query[, option])
```

**功能：** 匹配正则表达式，将input的分词结果，使用query的正则表达式匹配，有任意匹配即可

**示例：**

```SQL
SELECT match_regexp('a b cd', 'c.*', map('analyzer', 'english'));
-- 返回: true
```

### 查询示例

创建倒排索引的表

```SQL
CREATE TABLE bulkload_data(
   id INT,
   data STRING,
   INDEX id_index (id) INVERTED,
   INDEX data_index (data) INVERTED PROPERTIES('analyzer'='unicode')
);
```

**插入测试数据：**

```SQL
INSERT INTO bulkload_data VALUES
(1, 'Lakehouse provides distributed storage'),
(2, 'Inverted index accelerates full text search'),
(3, 'Lakehouse supports multiple data types'),
(4, 'Full text search with inverted index'),
(5, 'Data analytics on Lakehouse platform');
```

**全文检索示例：**

```SQL
--匹配所有，包含Lakehouse和storage
SELECT id, data FROM bulkload_data WHERE match_all(data, 'Lakehouse storage');
+----+---------------------------------------+
| id |                 data                  |
+----+---------------------------------------+
| 1  | Lakehouse provides distributed storage |
+----+---------------------------------------+

--匹配任意，包含search或analytics
SELECT id, data FROM bulkload_data WHERE match_any(data, 'search analytics');
+----+-------------------------------------------+
| id |                   data                    |
+----+-------------------------------------------+
| 2  | Inverted index accelerates full text search |
| 4  | Full text search with inverted index      |
| 5  | Data analytics on Lakehouse platform      |
+----+-------------------------------------------+

--匹配短语，包含full text search且连续
SELECT id, data FROM bulkload_data WHERE match_phrase(data, 'full text search');
+----+-------------------------------------------+
| id |                   data                    |
+----+-------------------------------------------+
| 2  | Inverted index accelerates full text search |
| 4  | Full text search with inverted index      |
+----+-------------------------------------------+
```

**等值查询示例：**

```SQL
--使用倒排索引加速id列的等值查询
SELECT id, data FROM bulkload_data WHERE id = 3;
+----+------------------------------------------+
| id |                   data                   |
+----+------------------------------------------+
| 3  | Lakehouse supports multiple data types   |
+----+------------------------------------------+

--使用倒排索引加速id列的范围查询
SELECT id, data FROM bulkload_data WHERE id >

## 使用注意事项

### 倒排索引无法优化场景

* 在大多数情况下，倒排索引并不会显著提升亚秒级查询的性能。
* 不支持外部表。
* 仅支持数据类型一致的查询，例如：

```SQL
--可以查询加速的，表中数据类型string
where string_col='10086';
--对需要匹配的值进行转化
where string_col=cast(10086 as string);

--无法查询加速的，因为对表列进行了强制转化
where cast(string_col as int)=10086 ;
```

## 计费说明

* 存储资源：倒排索引会在数据文件之外额外创建倒排索引文件，索引文件和数据文件将按照存储大小统一计收存储费用。
