## 功能概述

`INSERT INTO` 语句用于将数据插入表中。您可以为表中的每个列显式指定值，或者使用 `SELECT` 查询的结果作为插入的数据源。

## 语法结构

```SQL
INSERT INTO|OVERWRITE [TABLE] table_name 
[ PARTITION partition_spec] 
[ (column1, column2, ...)]
{VALUES(value1 [,...],(value2 [,...]),...) | subquery}

partition_spec ::=
    partition_column_name = partition_column_val [ , ... ]
```

## 参数详解

1. **INSERT INTO**：以追加模式插入数据。
2. **INSERT OVERWRITE**：重写目标表或目标表的某些分区。
   * 对于分区表，将覆盖指定分区的数据。
   * 对于非分区表，将覆盖整个表的数据。
3. **TABLE**：（可选）关键字，用于指定目标表。
4. **partition\_spec**：（可选）分区规范，用于指定插入数据的分区。
   * 静态分区：直接指定分区列的值，例如 `PARTITION (dt='shanghai')`。
   * 动态分区：系统根据 `VALUES` 或 `SELECT` 语句的值自动映射到相应分区。
   * 如果未指定分区规范，系统将根据分区列的值自动选择分区。
5. **column\_list**：指定要插入数据的列，确保输入查询的列顺序与表中的列顺序相匹配。

## 使用指南

* **数据类型匹配**：确保插入的数据类型与表定义中的列类型相匹配。

* **查询结果匹配**：使用 `SELECT` 语句插入数据时，查询返回的列数量和顺序应与目标表的列相匹配。

* **分区规范**：在分区表中插入数据时，如果未指定分区规范，系统将根据分区列的值自动选择分区。确保插入的数据中包含有效的分区值。

* **INSERT OVERWRITE**：使用此语句插入数据时，确保目标表或分区存在，否则操作将失败。

* **数据检查**：执行插入操作前，检查数据类型和列数量是否与目标表匹配，以避免数据插入错误。**特别注意的是，Apache Hive要求分区列是最后一个位置。没有这种强制要求，因此加列的时候特别注意：按照原来Hive方式加列可能会将列加到最后一个位置，所以加列的时候必须指定位置。否则会造成数据错误。**

* **自动分区处理**：当使用分区字段为函数的表时，无需指定 `PARTITION` 子句，系统会自动根据函数返回值处理分区。

* **大量数据导入**：在lakehouse环境中，不推荐使用 `INSERT INTO...VALUES` 方式导入大量数据，这种方式更适合测试场景。对于大量数据导入，请参阅[数据导入指南](data-load-summary.md)。

## 使用示例

**普通表插入**
假设`test` 表包含两个列`c1`, `c2`。

1. 向`test`表中导入一行数据

```
INSERT INTO test VALUES (1, 2);
INSERT INTO test (c1, c2) VALUES (1, 2);
INSERT INTO test (c1) VALUES (1);
```

其中第一条、第二条语句是一样的效果。在不指定目标列时，使用表中的列顺序来作为默认的目标列。 第三条语句未指定`c2`则使用null来填充，如果`c2`列有默认值则使用默认值填充。

2. 向`test`表中一次性导入多行数据

```
INSERT INTO test VALUES (3, 5), (5, 5 + 2);
INSERT INTO test (c1, c2) VALUES (6, 7), (6, 7* 2);
INSERT INTO test (c1) VALUES (1), (3);
```

其中第一条、第二条语句效果一样，向`test`表中一次性导入两条数据。第三条语句未指定`c2`则使用null来填充，如果有默认值则使用默认值，向`test`表中导入两条数据。

3. 向 `test` 表中导入一个查询语句结果

```
INSERT INTO test SELECT * FROM test2;
INSERT INTO test (c1, c2) SELECT * from test2;
```

4. 分区表插入数据

```SQL
-- 创建分区表
CREATE TABLE sales (
  id BIGINT,
  name VARCHAR(64),
  dt STRING
)
PARTITIONED BY (dt);

-- 插入单行数据
INSERT INTO sales VALUES (1001, 'Alice', '2021-01-01');

-- 插入多行数据
INSERT INTO sales VALUES (1002, 'Bob', '2021-01-02'), (1003, 'Charlie', '2021-01-03');

-- 指定分区插入数据
INSERT INTO sales PARTITION (dt='2021-01-04') (id, name) VALUES (1004, 'David');

-- 使用 SELECT 语句插入数据
INSERT INTO sales SELECT * FROM sales_temp;
```

5. 插入数据时指定列顺序

```SQL
-- 假设表结构为 (id, name, dt)
CREATE TABLE sales (id BIGINT, name VARCHAR(64), dt STRING);

-- 插入数据时仅指定 id 和 name 列。未指定的列则会显示null
INSERT INTO sales (id, name) VALUES (1005, 'Eve');
+------+------+----+
|  id  | name | dt |
+------+------+----+
| 1005 | Eve  |    |
+------+------+----+
```

6. 使用INSERT OVERWRITE插入数据

```SQL
-- 创建分区表
CREATE TABLE sales (
  id BIGINT,
  name VARCHAR(64),
  dt STRING
)
PARTITIONED BY (dt);

-- 插入单行数据
INSERT OVERWRITE sales VALUES (1001, 'Alice', '2021-08-01');

-- 插入多行数据
INSERT OVERWRITE sales VALUES (1002, 'Bob', '2021-08-02'), (1003, 'Charlie', '2021-08-03');

-- 指定分区插入数据
INSERT OVERWRITE sales PARTITION (dt='2021-08-04') VALUES (1004, 'David', '2021-08-04');

-- 使用查询结果插入数据
INSERT OVERWRITE sales SELECT * FROM sales_temp;
```

7. 插入不同的数据类型

```
CREATE TABLE lakehouse_datatype(
  `c_bigint` bigint,
  `c_boolean` boolean,
  `c_binary` binary,
  `c_char` char(1),
  `c_date` date,
  `c_decimal` decimal(20,6),
  `c_double` double,
  `c_float` float,
  `c_int` int,
  `c_smallint` smallint,
  `c_string` string,
  `c_timestamp` timestamp,
  `c_tinyint` tinyint,
  `c_array` array<int>,
  `c_map` map<string,string>,
  `c_struct` struct<a:int,b:string,c:double>,
  `c_varchar` varchar(100),
  `c_json` json);
INSERT INTO lakehouse_datatype
VALUES (
    1l, -- c_bigint
    true, -- c_boolean
    X'7A', -- c_binary
    'A', -- c_char
    date'2025-05-21' , -- c_date
    1.1bd, -- c_decimal
    1.1d, -- c_double
    1.1f, -- c_float
    1, -- c_int
    1s, -- c_smallint
    'This is a string', -- c_string
    timestamp'2025-05-21 12:00:00', -- c_timestamp
    127, -- c_tinyint
    ARRAY(1,2,3), -- c_array
    MAP('key1', 'value1', 'key2', 'value2'), -- c_map
    STRUCT(1, 'a', 3.14), -- c_struct
    'This is a varchar string', -- c_varchar
    json'123' -- c_json
);
```


