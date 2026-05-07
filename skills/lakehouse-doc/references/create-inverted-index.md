## 创建倒排索引

具体介绍参考[倒排索引](inverted-index.md)介绍

### 语法

```SQL
CREATE TABLE table_name(
  columns_difinition,
  INDEX index_name (column_name) INVERTED [COMMENT '']  PROPERTIES('analyzer'='english｜chinese|keyword｜unicode'),
  INDEX index_name (column_name) INVERTED [COMMENT '']  PROPERTIES('analyzer'='english｜chinese|keyword｜unicode'),
....
  INDEX index_name (column_name) INVERTED [COMMENT '']  PROPERTIES('analyzer'='english｜chinese|keyword｜unicode')
);
```

**columns\_difinition**:定义表的字段信息，最后一个字段必须使用逗号隔开

**INDEX**：关键字

**index\_name**：自定义index的名称

**column\_name**：需要添加索引的字段名称

**INVERTED**：关键字，表示倒排索引

**COMMENT**：指定index的说明信息

**PROPERTIES**：指定INDEX的参数，支持的属性目前支持指定分词。数值和日期类型则不需要指定properties，如果是字符串类型要求必须指定分词

* 分词参数：'analyzer'='english｜chinese | keyword｜unicode'，用于指定文本分词的策略，适用于不同的语言和需求。
  * **keyword**: 此类型的字段不会进行分词。整个字符串被视为单一的词根，并存储在倒排索引中。搜索时，需要提供完整的字段值以实现精确匹配。
  * **english**: 专为英文设计的分词器，仅识别连续的ASCII字母和数字，并将文本统一转换为小写。适合处理英文内容，忽略非字母数字字符。
  * **chinese**: 中文文本分词插件，识别中文和英文字符，同时过滤掉标点符号，并将英文字母转换为小写。适用于中英文混合文本的处理。
  * **unicode**: 基于Unicode文本分割算法的分词器，能够识别多种语言的文本边界，有效将文本分割成单词，并将字母转换为小写。适合多语言环境下的文本处理。

## 参考文档

* [构建索引](build-inverted-index.md)
* [删除索引](DROP-INDEX.md)
* [列出所有索引](SHOW-INDEX.md)
* [查看索引详情](DESC-INDEX.md)

### **案例**

```SQL
CREATE TABLE inverted_index_test(
  id int,
  name string,
  INDEX id_index (id) INVERTED ,
  INDEX name_index (name) INVERTED  PROPERTIES('analyzer'='keyword')
);
```

## 已有的表增加倒排索引

### 语法

```SQL
CREATE  INVERTED INDEX [IF NOT EXISTS] index_name ON TABLE 
[schema].table_name(col_name)
[COMMENT 'comment']
PROPERTIES('analyzer'='english｜chinese|keyword｜unicode')
```

**INVERTED**: 索引类型，倒排索引

**index\_name**: 表名字，位于schema下，schema下索引名称不能重复

**col\_name**：列名只支持单列

**PROPERTIES**：指定INDEX的参数，支持的属性目前支持指定分词。数值和日期类型则不需要指定properties，如果是字符串类型要求必须指定分词

### 说明

执行CREATE INDEX仅对新增数据有效，对已有数据进行索引请使用BUILD INDEX命令。

### **案例**

1. 建表时指定倒排索引

```SQL
DROP TABLE IF EXISTS t;
CREATE    TABLE t (
          order_id INT,
          customer_id INT,
          amount DOUBLE,
          order_year string,
          order_month string,
          INDEX order_id_index (order_id) INVERTED COMMENT 'INVERTED'
          );
INSERT INTO t
VALUES (1, 101, 100.0, '2023','01'),
       (2, 102, 200.0, '2023','02'),
       (3, 103, 300.0, '2023','03'),
       (4, 104, 400.0, '2023','04'),
       (5, 105, 500.0, '2023','04');
DESC INDEX order_id_index;	
+--------------------+-------------------------+
|     info_name      |       info_value        |
+--------------------+-------------------------+
| name               | order_id_index          |
| creator            | UAT_TEST                |
| created_time       | 2024-12-27 10:39:44.778 |
| last_modified_time | 2024-12-27 10:39:44.778 |
| comment            | INVERTED                |
| index_type         | inverted                |
| table_name         | t                       |
| table_column       | order_id                |
+--------------------+-------------------------+
--使用倒排索引查询
SELECT    *
FROM      t
WHERE     match_any (order_id, 3);
+----------+-------------+--------+------------+-------------+
| order_id | customer_id | amount | order_year | order_month |
+----------+-------------+--------+------------+-------------+
| 3        | 103         | 300.0  | 2023       | 03          |
+----------+-------------+--------+------------+-------------+
```

2. 给已有的列添加倒排索引

```
CREATE INVERTED INDEX order_year_index
ON TABLE public.t (order_year)
PROPERTIES('analyzer'='chinese');
--倒排索引添加完成后只有新写入的数据才会生效。老数据不会生效。如果老数据需要可以使用BUILD INDEX命令
BUILD INDEX order_year_index ON public.t;
DESC INDEX EXTENDED order_year_index;
+--------------------------+--------------------------+
|        info_name         |        info_value        |
+--------------------------+--------------------------+
| name                     | order_year_index         |
| creator                  | UAT_TEST                 |
| created_time             | 2024-12-27 10:51:58.977  |
| last_modified_time       | 2024-12-27 10:51:58.977  |
| comment                  |                          |
| properties               | (("analyzer","chinese")) |
| index_type               | inverted                 |
| table_name               | t                        |
| table_column             | order_year               |
| index_size_in_data_file  | 0                        |
| index_size_in_index_file | 296                      |
| total_index_size         | 296                      |
+--------------------------+--------------------------+

SELECT    *
FROM      t
WHERE     match_all (order_year, '2023');
+----------+-------------+--------+------------+-------------+
| order_id | customer_id | amount | order_year | order_month |
+----------+-------------+--------+------------+-------------+
| 1        | 101         | 100.0  | 2023       | 01          |
| 2        | 102         | 200.0  | 2023       | 02          |
| 3        | 103         | 300.0  | 2023       | 03          |
| 4        | 104         | 400.0  | 2023       | 04          |
| 5        | 105         | 500.0  | 2023       | 04          |
+----------+-------------+--------+------------+-------------+

```


