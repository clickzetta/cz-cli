# 创建BLOOMFILTER索引

## 功能

布隆过滤器（Bloom Filter）是一种概率型数据结构，用于判断一个元素是否属于某个集合。本功能允许用户在表中创建布隆过滤器索引，以提高查询效率。具体介绍参考 [Bloomfilter Index](bloomfilter-summary.md)。

## 语法

```
CREATE BLOOMFILTER INDEX [IF NOT EXISTS] index_name ON TABLE 
[schema].table_name(column_name)
[COMMENT 'comment']
[PROPERTIES ('key'='value')]
```

**bloomfilter**：索引类型，使用布隆过滤器算法。

**index_name**：要创建的索引名称，需位于指定的schema下，且在同一schema下不能重复。

**schema**：可选参数，用于指定表的schema名称。

**table_name**：要创建索引的表名称。

**column_name**：要创建索引的列名称，目前仅支持单列索引。

**COMMENT**：可选参数，用于添加关于索引的描述信息。

**PROPERTIES**：可选参数，Lakehouse保留属性，方便之后扩展添加属性。当前可选参数如下：
| 参数名称 | 描述 |
| :---| :----|
| analyzer |   将字符串按固定长度分割为 ngram |
| n | ngram的长度， 例如：当 ngram 长度设为4时，字符串 "Lakehouse" 将被索引为：Lake hous e ' |

## 示例
```
CREATE TABLE IF NOT EXISTS demo_bloomfilter_index (
col_1 string,
col_2 string,
col_3 string,
index idx_bf (col_1) bloomfilter,
index idx_ngram_bf (col_2) bloomfilter properties ('analyzer' = 'ngram', 'n' = '10')
) USING parquet;

CREATE BLOOMFILTER INDEX IF NOT EXISTS idx_ngram_bf1 
ON TABLE demo_bloomfilter_index(col_3)
COMMENT 'ngram 索引'
properties ('analyzer' = 'ngram', 'n' = '3');

SHOW INDEX FROM demo_bloomfilter_index;
```

## 参考文档

* [构建索引](build-inverted-index.md)
* [删除索引](DROP-INDEX.md)
* [列出所有索引](SHOW-INDEX.md)
* [查看索引详情](DESC-INDEX.md)

## 使用注意事项

1. BLOOMFILTER INDEX 添加完成后，只有新写入的数据才会生效。旧数据不会生效。如果旧数据需要生效，必须重写数据。
2. 一张表可以创建多个布隆过滤器索引。
3. 类型限制：不支持 INTERVAL、STRUCT、MAP、ARRAY 等类型。如果尝试使用不支持的类型，系统将报错。

## 使用说明

[BLOOMFILTER INDEX使用说明](bloomfilter-summary.md)

## 示例

1. 建表时指定 BLOOMFILTER 索引

   ```
   DROP TABLE IF EXISTS t;
   CREATE    TABLE t (
             order_id INT,
             customer_id INT,
             amount DOUBLE,
             order_year string,
             order_month string,
             INDEX order_id_index (order_id) BLOOMFILTER COMMENT 'BLOOMFILTER'
             );         
   INSERT INTO t
   VALUES (1, 101, 100.0, '2023','01'),
          (2, 102, 200.0, '2023','02'),
          (3, 103, 300.0, '2023','03'),
          (4, 104, 400.0, '2023','04'),
          (5, 105, 500.0, '2023','04');
   SHOW INDEX FROM t;
   +----------------+--------------+
   |   index_name   |  index_type  |
   +----------------+--------------+
   | order_id_index | bloom_filter |
   +----------------+--------------+

   DESC INDEX order_id_index;
   +--------------------+-------------------------+
   |     info_name      |       info_value        |
   +--------------------+-------------------------+
   | name               | order_id_index          |
   | creator            | UAT_TEST                |
   | created_time       | 2024-12-26 21:20:43.914 |
   | last_modified_time | 2024-12-26 21:20:43.914 |
   | comment            | BLOOMFILTER             |
   | index_type         | bloom_filter            |
   | table_name         | t                       |
   | table_column       | order_id                |
   +--------------------+-------------------------+
   DROP INDEX order_id_index;

   ```

2. 给已有的列添加 BLOOMFILTER 索引

   ```
   CREATE BLOOMFILTER INDEX customer_id_index
   ON TABLE public.t (customer_id)
   COMMENT 'xx';
   --BLOOMFILTER INDEX添加完成后只有新写入的数据才会生效。老数据不会生效。如果老数据需要生效必须重写数据
   INSERT OVERWRITE t SELECT * FROM t;
   DESC INDEX customer_id_index;
   +--------------------+-------------------------+
   |     info_name      |       info_value        |
   +--------------------+-------------------------+
   | name               | customer_id_index       |
   | creator            | UAT_TEST                |
   | created_time       | 2024-12-26 21:24:57.649 |
   | last_modified_time | 2024-12-26 21:24:57.649 |
   | comment            | xx                      |
   | index_type         | bloom_filter            |
   | table_name         | t                       |
   | table_column       | customer_id             |
   +--------------------+-------------------------+
   DROP INDEX customer_id_index;

   ```


