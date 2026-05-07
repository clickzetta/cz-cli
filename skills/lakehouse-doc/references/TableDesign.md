# 表设计及数据类型操作

创建一张表，覆盖云器 Lakehouse 支持的所有表结构数据类型，并以这张表为基表，创建普通视图。

## 创建schema

```
CREATE SCHEMA IF NOT EXISTS lakehouse_demo_table_design_schema;
USE SCHEMA lakehouse_demo_table_design_schema;
SELECT current_schema();
```

## 创建表和视图

-- 云器 Lakehouse 支持的数据类型

```
CREATE TABLE IF NOT EXISTS lakehouse_demo_table_design_schema.clickzetta_datatypes
(
    c_bigint BIGINT,
    c_boolean BOOLEAN,
    c_binary BINARY,
    c_char CHAR,
    c_date DATE,
    c_decimal DECIMAL(20,6),
    c_double DOUBLE,
    c_float FLOAT,
    c_int INT,
    c_interval INTERVAL DAY,
    c_smallint SMALLINT,
    c_string STRING,
    c_timestamp TIMESTAMP,
    c_tinyint TINYINT,
    c_array ARRAY<STRUCT<a: INT, b: STRING>>,
    c_map MAP<STRING, STRING>,
    c_struct STRUCT<a: INT, b: STRING, c: DOUBLE>,
    c_varchar VARCHAR(1024),
    c_json JSON
);
--LIKE语句可以再创建一个表，使目标表和源表具有相同的表结构。但通过该语句创建的表不复制数据
CREATE  TABLE IF NOT EXISTS lakehouse_demo_table_design_schema.clickzetta_datatypes_like LIKE lakehouse_demo_table_design_schema.clickzetta_datatypes;

--AS语句可用于同步或异步查询原表并基于查询结果创建新表，然后将查询结果插入到新表中,但是不会复制分区信息
CREATE  TABLE IF NOT EXISTS lakehouse_demo_table_design_schema.clickzetta_datatypes_as AS select* from lakehouse_demo_table_design_schema.clickzetta_datatypes;

--创建普通视图
CREATE VIEW  IF NOT EXISTS lakehouse_demo_table_design_schema.clickzetta_datatypes_view as select* from lakehouse_demo_table_design_schema.clickzetta_datatypes;

--检查创建好的表、视图
show tables like 'clickzetta_datatypes%' in lakehouse_demo_table_design_schema;
```

![](.topwrite/assets/image_1718700694135.png)

## 向表中插入记录

```
INSERT INTO lakehouse_demo_table_design_schema.clickzetta_datatypes VALUES
(1, true, X'01', 'a', DATE'2022-02-01', 1000.123456, 2.0, 1.5, 42, INTERVAL 1 DAY, 103, 'test string 1',TIMESTAMP '2022-02-01 20:00:00', 11, ARRAY(STRUCT(1, 'A')), MAP('key1', 'value1'), STRUCT(1, 'A', 2.0), 'varchar example 1',JSON '{"id": 1, "value": "100", "comment": "JSON Sample data"}' ),
(2, false, X'02', 'b', DATE'2022-02-02', 2000.234567, 4.0, 2.5, 84, INTERVAL 2 DAY, 104,'test string 2',TIMESTAMP '2022-02-02 21:00:00', 12, ARRAY(STRUCT(2, 'B')), MAP('key2', 'value2'), STRUCT(2, 'B', 4.0), 'varchar example 2',JSON '{"id": 2, "value": "200", "comment": "JSON Sample data"}' );
```

## 查询表中的date、timestamp、interval类型数据

```
-- 1. 按日期筛选
SELECT * FROM lakehouse_demo_table_design_schema.clickzetta_datatypes WHERE c_date >= DATE '2022-02-02';

-- 2. 选择特定时间范围内的记录
SELECT * FROM lakehouse_demo_table_design_schema.clickzetta_datatypes WHERE c_timestamp BETWEEN TIMESTAMP '2022-02-01 20:00:00' AND TIMESTAMP '2022-02-02 21:00:00';

-- 3. 对日期添加天数
SELECT c_date, c_date + INTERVAL 7 DAY as plus_7_days FROM lakehouse_demo_table_design_schema.clickzetta_datatypes;

-- 4. 计算两个日期之间的天数差
SELECT c_date, DATEDIFF((SELECT c_date FROM lakehouse_demo_table_design_schema.clickzetta_datatypes WHERE c_bigint = 2), c_date) as days_difference FROM lakehouse_demo_table_design_schema.clickzetta_datatypes;

-- 5. 提取日期的年份、月份和日
SELECT EXTRACT(YEAR FROM c_date) as year, EXTRACT(MONTH FROM c_date) as month, EXTRACT(DAY FROM c_date) as day FROM lakehouse_demo_table_design_schema.clickzetta_datatypes;

-- 6. 计算时间戳与当前时间的差值（分钟）
SELECT c_timestamp, TIMESTAMPDIFF(MINUTE, c_timestamp, NOW()) as minutes_difference FROM lakehouse_demo_table_design_schema.clickzetta_datatypes;

-- 7. 比较两个日期的大小
SELECT  INTERVAL 10 DAY, c_interval, INTERVAL 10 DAY > c_interval from lakehouse_demo_table_design_schema.clickzetta_datatypes;
```

## 操作复杂数据类型：map、array、struct、json

```
-- 1. 提取map中的值
SELECT
  c_int,
  c_map['key1'] AS map_key1_value, 
  c_map['key2'] AS map_key2_value
FROM lakehouse_demo_table_design_schema.clickzetta_datatypes;

-- 2. 计算map长度
SELECT
  c_int,
  cardinality(c_map) AS map_length
FROM lakehouse_demo_table_design_schema.clickzetta_datatypes;

-- 3. 提取array中的结构字段
SELECT
  c_int,
  c_array[0].a AS array_col1_value, 
  c_array[0].b AS array_col2_value
FROM lakehouse_demo_table_design_schema.clickzetta_datatypes;

-- 4. 计算数组长度
SELECT
  c_int,
  array_size(c_array) AS array_length
FROM lakehouse_demo_table_design_schema.clickzetta_datatypes;

-- 5. 提取结构中的值
SELECT
  c_int,
  c_struct.a AS struct_col1_value,
  c_struct.b AS struct_col2_value,
  c_struct.c AS struct_col3_value
FROM lakehouse_demo_table_design_schema.clickzetta_datatypes;

-- 6. 结果放在一个cell里
SELECT
  c_int,
  concat_ws(
    'Map Value Key1: ', c_map['key1'], ', ',
    'Map Value Key2: ', c_map['key2'], ', ',
    'Array Struct: (', c_array[0].a, ', ', c_array[0].b, ')'
  ) AS combined_result
FROM lakehouse_demo_table_design_schema.clickzetta_datatypes;

-- 7. 提取JSON字段
SELECT
  json_extract_int(c_json,"$.id") as id,
  json_extract_bigint(c_json,"$.value") as value,
  json_extract_string(c_json,"$.comment") as comment
FROM lakehouse_demo_table_design_schema.clickzetta_datatypes;
```

## 查询 MAP 类型数据

以下是针对 clickzetta_datatypes 表中的 c_map 类型列的一些 SELECT 语句示例：

```
-- 1. 提取map中的值
SELECT
  c_int,
  c_map['key1'] AS map_key1_value, 
  c_map['key2'] AS map_key2_value
FROM lakehouse_demo_table_design_schema.clickzetta_datatypes;

-- 2. 计算map长度
SELECT
  c_int,
  cardinality(c_map) AS map_length
FROM lakehouse_demo_table_design_schema.clickzetta_datatypes;

-- 3. 检查map中是否存在指定键
SELECT
  c_int,
  c_map['key_to_check'] IS NOT NULL AS key_exists
FROM lakehouse_demo_table_design_schema.clickzetta_datatypes;

-- 4. 使用map中的值进行条件筛选
SELECT
  c_int,
  c_map
FROM lakehouse_demo_table_design_schema.clickzetta_datatypes
WHERE c_map['key1'] = 'value_to_match';

-- 5. 返回具有最大键值的行
SELECT
  c_int,
  c_map
FROM clickzetta_datatypes
WHERE c_map['key_with_max_value'] = (
  SELECT MAX(c_map['key_with_max_value'])
  FROM lakehouse_demo_table_design_schema.clickzetta_datatypes
);

-- 6. 将map转换为array并提取第一个元素的键和值
SELECT
  c_int,
  map_keys(c_map)[0] AS first_key,
  map_values(c_map)[0] AS first_value
FROM lakehouse_demo_table_design_schema.clickzetta_datatypes;
```

## 查询 Array 类型数据

以下是针对 clickzetta_datatypes 表中的 c_array 类型列的一些 SELECT 语句示例：

```
-- 1. 提取array中的值
SELECT
  c_int,
  c_array[0] AS array_element_1, 
  c_array[1] AS array_element_2
FROM lakehouse_demo_table_design_schema.clickzetta_datatypes;

-- 2. 计算array长度
SELECT
  c_int,
  cardinality(c_array) AS array_length
FROM lakehouse_demo_table_design_schema.clickzetta_datatypes;
```

## 查询 Struct 类型数据

以下是针对 clickzetta_datatypes 表中的 c_struct 类型列的一些 SELECT 语句示例，包括对 c_struct 列执行各种运算。

```
-- 1. 选择c_struct的所有属性
SELECT c_struct.a, c_struct.b, c_struct.c
FROM lakehouse_demo_table_design_schema.clickzetta_datatypes;

-- 2. 对c_struct列进行运算

-- 2.1 选择c_struct列中a属性乘以某个值（例如：2）的结果
SELECT c_struct.a * 2 as multiplied_a
FROM lakehouse_demo_table_design_schema.clickzetta_datatypes;

-- 2.2 使用c_struct列中的a和c属性计算平均值
SELECT (c_struct.a + c_struct.c) / 2 as avg_a_c
FROM lakehouse_demo_table_design_schema.clickzetta_datatypes;

-- 2.3 根据c_struct列中的b属性对结果进行排序
SELECT c_struct.a, c_struct.b, c_struct.c
FROM lakehouse_demo_table_design_schema.clickzetta_datatypes
ORDER BY c_struct.b;

-- 3. 使用聚合函数处理c_struct列

-- 3.1 计算c_struct列中a属性的总和
SELECT SUM(c_struct.a) as total_a
FROM lakehouse_demo_table_design_schema.clickzetta_datatypes;

-- 3.2 计算c_struct列中c属性的平均值
SELECT AVG(c_struct.c) as avg_c
FROM lakehouse_demo_table_design_schema.clickzetta_datatypes;

-- 3.3 获取c_struct列中a属性的最大值
SELECT MAX(c_struct.a) as max_a
FROM lakehouse_demo_table_design_schema.clickzetta_datatypes;
```

## 清理

```
DROP TABLE IF EXISTS lakehouse_demo_table_design_schema.clickzetta_datatypes;
DROP TABLE IF EXISTS lakehouse_demo_table_design_schema.clickzetta_datatypes_like;
DROP TABLE IF EXISTS lakehouse_demo_table_design_schema.clickzetta_datatypes_as;
DROP VIEW IF EXISTS lakehouse_demo_table_design_schema.clickzetta_datatypes_view;
DROP SCHEMA IF EXISTS lakehouse_demo_table_design_schema;
```

## 恭喜，任务完成！

请享受学习过程并了解更多！

## 附录

### 下载Zeppelin Notebook源文件

本文代码也提供了运行在 [Zeppelin](eco_integration/Zeppelin.md) 上的版本。如果您想直接运行本文代码，请按照文档说明安装 [Zeppelin](eco_integration/Zeppelin.md)。

[02.表设计.ipynb](https://github.com/yunqiqiliang/clickzetta_quickstart/blob/main/zeppelin_notebook/02.%E8%A1%A8%E8%AE%BE%E8%AE%A1.ipynb)
