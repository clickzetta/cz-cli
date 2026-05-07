# 分区

分区是一种通过在写入时将相似的行分组在一起来加快查询速度的方法。使用分区可以实现数据裁剪，优化查询。查询表时通过WHERE子句指定所需查询的分区，避免全表扫描，提高处理效率，降低计算资源消耗。

## Lakehouse分区实现

Lakehouse的分区类似于Apache Iceberg的[隐藏分区](https://iceberg.apache.org/docs/latest/partitioning/#icebergs-hidden-partitioning)。为了便于理解，我们参考Apache Iceberg的分区概念来介绍Lakehouse分区。
Apache Iceberg是一个开源的表格格式，Apache Iceberg支持两种分区方式：标识分区和转换分区。

* 标识分区：将表的一个或多个列作为分区键，根据列的值将数据划分为不同的分区。通过获取列值并选择性地对其进行转换来生成分区值
* 转换分区：将表的一个或多个列经过某种转换函数后作为分区键，根据转换后的值将数据划分为不同的分区。例如，如果表有一个timestamp列，可以使用`years(timestamp)`函数将数据按照从1970年到现在的多少年，不能直接使用TIMESTAMP类型作为分区列,需要使用生成列转换为整数类型(如
years, months, days)

分区信息和数据文件的路径存储在元数据中。这样做的好处是可以在不影响数据的情况下修改分区策略，也可以隐藏分区信息，不需要在写SQL时指定分区条件。同时分区数量没有限制，因为数据就是分区。

Lakehouse兼容了一部分Apache Iceberg的转换分区函数。但是Apache Iceberg的year、month、day、hour转换分区和数据库中的常用日期函数名称冲突，因此在Lakehouse中的转换分区为years、months、days、hours。以下是Lakehouse支持的分区转换函数：

|                           |                                   |                                                         |      |
| ------------------------- | --------------------------------- | ------------------------------------------------------- | ---- |
| 分区函数名称                    | 描述                                | 源类型                                                     | 结果类型 |
| bucket(numBuckets, colName) | 值的散列值，对N取模                        | int, long, decimal, date, timestamp\_ltz, string binary | int  |
| truncate(colName,W)       | 值截断到宽度W                           | int, long, decimal, string                              | 源类型  |
| years                     | 提取日期或时间戳的年份，以1970年为基准             | date, timestamp, timestamptz                            | int  |
| months                    | 提取日期或时间戳的月份，以1970-01-01为基准        | date, timestamp, timestamptz                            | int  |
| days                      | 提取日期或时间戳的天数，以1970-01-01为基准        | date, timestamp, timestamptz                            | int  |
| hours                     | 提取时间戳的小时数，以1970-01-01 00:00:00为基准 | timestamp, timestamptz                                  | int  |

## Lakehouse分区语法

### 介绍

Lakehouse是基于Apache Iceberg实现的[隐藏分区](https://iceberg.apache.org/docs/latest/partitioning/#icebergs-hidden-partitioning)，为了兼容大多数习惯使用Hive语法的用户，Lakehouse在语法层面实现了一些语法糖。**特别需要注意的是，Apache Hive要求分区列位于列定义的末尾，但Apache Iceberg没有这种强制要求。因此，如果按照原来的Hive方式加列，可能会将列加到最后一个位置，所以加列时必须指定位置。**比如Apache Iceberg在创建分区时语法为如下

```SQL
CREATE TABLE prod.db.sample (
id bigint,
category string,
data string
)
PARTITIONED BY(category)
```

Hive的语法必须这样

```SQL
CREATE TABLE prod.db.sample (
id bigint,
data string)
PARTITIONED BY(category string)
```

Lakehouse做了兼容，既支持Iceberg语法也支持Hive语法。分区字段和类型写在PARTITIONED BY语句中。

### 支持的语法

lakehouse兼容了Hive的分区语法，支持以下几种分区操作：

* Insert into…partition：向表的一个或多个分区中插入数据，如果分区不存在，则自动创建分区，因为分区就是数据。partition子句可以省略，数据会自动根据列的顺序进行映射，但要求分区列和表中对应列的位置必须一致。而在Hive中您必须指定partition子句

* Insert overwrite…partition：覆盖表的一个或多个分区中的数据，如果分区不存在，则自动创建分区。
  * partition子句可以省略，数据会自动根据列的顺序映射要求必须分区列和表的位置应映射一致。

  * overwrite行为遵循Hive的原则，如果指定分区且为静态值，则是静态覆盖，即只覆盖指定的分区；如果指定分区且为动态值，或者不指定分区，则是动态覆盖，即覆盖所有匹配的分区。如果表中分区是转换分区，partition子句不支持指定转换函数，可以直接使用insert overwrite table插入数据。

  * ```SQL
    INSERT OVERWRITE [TABLE] table_name 
    --partition关键字可选
    [ PARTITION partition_spec] 
    [ column_list ]
    VALUES(value [,...])| select_statement
    --如果指定PARTITION关键字时partition_spec必选
    partition_spec ::=
        partition_col_name = partition_col_val [ , ... ] | partition_col_name
    ```

* Truncate partition：清空表的一个或多个分区中的数据。但在Hive中会保留分区值，Lakehouse中则不会保留，因为Lakehouse的partition是数据

  * ```SQL
    TRUNCATE [TABLE] table_name [PARTITION partition_spec];
    --partition_spec解释
    partition_spec::=
      partition_column = partition_col_value, partition_column = partition_col_value, ...)
    ```

* Drop partition：删除表的一个或多个分区。

  * ```SQL
    ALTER TABLE table_name DROP [IF EXISTS] PARTITION 
    partition_spec[, PARTITION partition_spec, ...]
    ```

* Rename partition:目前您可以直接update更新数据即可

  * ```SQL
     update sales set order_date='2023-02-02' where order_date= '2023-02-01';
    ```

* Show partition:建议使用SQL，select distinct进行统计，如`select distinct pt from table_pt;`

### 支持的分区数据类型


| 数据类型                     | 是否支持 |
| ------------------------ | ---- |
| TINYINT                  | 支持   |
| SMALLINT                 | 支持   |
| INT                      | 支持   |
| BIGINT                   | 支持   |
| STRING                   | 支持   |
| CHAR(n)                  | 支持   |
| VARCHAR(n)               | 支持   |
| BOOLEAN                  | 支持   |
| BINARY                   | 不支持  |
| FLOAT                    | 不支持  |
| DOUBLE                   | 不支持  |
| DECIMAL(precision,scale) | 不支持  |
| TIMESTAMP\_LTZ           | 不支持  |
| INTERVAL（时间间隔类型）         | 不支持  |
| ARRAY                    | 不支持  |
| MAP                      | 不支持  |
| STRUCT                   | 不支持  |

### 写入分区

* Insert into…partition：向表的一个或多个分区中插入数据，如果分区不存在，则自动创建分区，因为分区就是数据。partition子句可以省略，数据会自动根据列的顺序进行映射，但要求分区列和表中对应列的位置必须一致。在Hive中您必须指定partition子句

* Insert overwrite…partition：覆盖表的一个或多个分区中的数据，如果分区不存在，则自动创建分区。partition子句可以省略，数据会自动根据列的顺序映射要求必须分区列和表的位置应映射一致。overwrite行为遵循Hive的原则，如果指定分区且为静态值，则是静态覆盖，即只覆盖指定的分区；如果指定分区且为动态值，或者不指定分区，则是动态覆盖，即覆盖所有匹配的分区。如果表中分区是转换分区，partition子句不支持指定转换函数，可以直接使用insert overwrite table插入数据。

  * ```SQL
    INSERT OVERWRITE [TABLE] table_name 
    --partition关键字可选
    [ PARTITION partition_spec] 
    [ column_list ]
    VALUES(value [,...])| select_statement
    --如果指定PARTITION关键字时partition_spec必选
    partition_spec ::=
        partition_col_name = partition_col_val [ , ... ] | partition_col_name
    ```

**注意**：
执行写入分区时单个任务目前限制2048个分区，超出此限制将会报错：`The count of dynamic partitions exceeds the maximum number 2048`。插入之前建议您先统计分区的数量如：`select count(distinct pt) from table`。如果您确实有这么多分区可以分批次导入，lakehouse的分区总数没有限制，会在单个任务限制。如果您的数据量较小，建议可以不用设置cluster key和partition key。建议单分区和cluster key的数据量在百MB到GB级别。例如，Parquet格式文件压缩后128MB。

### 示例

以下是一些分区语法的示例：

```SQL
-- 创建一个按照年份和月份分区的表
CREATE TABLE sales (
  order_id INT,
  customer_id INT,
  amount DOUBLE
) 
PARTITIONED BY (order_date string);

-- 向表中插入数据，不指定分区
INSERT INTO sales VALUES
(1, 101, 100.0, '2023-01-01'),
(2, 102, 200.0, '2023-01-02'),
(3, 103, 300.0, '2023-02-01'),
(4, 104, 400.0, '2023-02-02');

-- 向表中插入数据，指定分区
INSERT INTO sales PARTITION (order_date='2023-03-01') VALUES
(5, 105, 500.0),
(6, 106, 600.0);
+----------+-------------+--------+------------+
| order_id | customer_id | amount | order_date |
+----------+-------------+--------+------------+
| 1        | 101         | 100.0  | 2023-01-01 |
| 5        | 105         | 500.0  | 2023-03-01 |
| 6        | 106         | 600.0  | 2023-03-01 |
| 2        | 102         | 200.0  | 2023-01-02 |
| 3        | 103         | 300.0  | 2023-02-01 |
| 4        | 104         | 400.0  | 2023-02-02 |
+----------+-------------+--------+------------+
-- 覆盖表中的数据，指定分区
INSERT OVERWRITE sales PARTITION (order_date='2023-03-01') VALUES
(7, 107, 700.0),
(8, 108, 800.0);
+----------+-------------+--------+------------+
| order_id | customer_id | amount | order_date |
+----------+-------------+--------+------------+
| 1        | 101         | 100.0  | 2023-01-01 |
| 2        | 102         | 200.0  | 2023-01-02 |
| 7        | 107         | 700.0  | 2023-03-01 |
| 8        | 108         | 800.0  | 2023-03-01 |
| 3        | 103         | 300.0  | 2023-02-01 |
| 4        | 104         | 400.0  | 2023-02-02 |
+----------+-------------+--------+------------+
-- 覆盖表中的数据，不指定分区
INSERT OVERWRITE sales VALUES
(9, 109, 900.0, '2023-04-01'),
(10, 110, 1000.0, '2023-04-02');
+----------+-------------+--------+------------+
| order_id | customer_id | amount | order_date |
+----------+-------------+--------+------------+
| 1        | 101         | 100.0  | 2023-01-01 |
| 9        | 109         | 900.0  | 2023-04-01 |
| 2        | 102         | 200.0  | 2023-01-02 |
| 7        | 107         | 700.0  | 2023-03-01 |
| 8        | 108         | 800.0  | 2023-03-01 |
| 3        | 103         | 300.0  | 2023-02-01 |
| 4        | 104         | 400.0  | 2023-02-02 |
| 10       | 110         | 1000.0 | 2023-04-02 |
+----------+-------------+--------+------------+

-- 重命名分区，修改分区值
UPDATE sales SET order_date = '2023-02-02'
WHERE     order_date = '2023-02-01';
+----------+-------------+--------+------------+
| order_id | customer_id | amount | order_date |
+----------+-------------+--------+------------+
| 1        | 101         | 100.0  | 2023-01-01 |
| 2        | 102         | 200.0  | 2023-01-02 |
| 4        | 104         | 400.0  | 2023-02-02 |
| 3        | 103         | 300.0  | 2023-02-02 |
| 7        | 107         | 700.0  | 2023-03-01 |
| 8        | 108         | 800.0  | 2023-03-01 |
| 9        | 109         | 900.0  | 2023-04-01 |
| 10       | 110         | 1000.0 | 2023-04-02 |
+----------+-------------+--------+------------+
-- 清空分区中的数据
TRUNCATE TABLE sales PARTITION (order_date='2023-03-01');
+----------+-------------+--------+------------+
| order_id | customer_id | amount | order_date |
+----------+-------------+--------+------------+
| 1        | 101         | 100.0  | 2023-01-01 |
| 2        | 102         | 200.0  | 2023-01-02 |
| 4        | 104         | 400.0  | 2023-02-02 |
| 3        | 103         | 300.0  | 2023-02-02 |
| 9        | 109         | 900.0  | 2023-04-01 |
| 10       | 110         | 1000.0 | 2023-04-02 |
+----------+-------------+--------+------------+
-- 删除分区
ALTER TABLE sales DROP PARTITION (order_date='2023-02-02');
+----------+-------------+--------+------------+
| order_id | customer_id | amount | order_date |
+----------+-------------+--------+------------+
| 1        | 101         | 100.0  | 2023-01-01 |
| 2        | 102         | 200.0  | 2023-01-02 |
| 9        | 109         | 900.0  | 2023-04-01 |
| 10       | 110         | 1000.0 | 2023-04-02 |
+----------+-------------+--------+------------+
--添加列,指定在分区列前面
ALTER TABLE sales ADD COLUMN col1 string AFTER amount;
+-------------------------+-----------+---------+
|       column_name       | data_type | comment |
+-------------------------+-----------+---------+
| order_id                | int       |         |
| customer_id             | int       |         |
| amount                  | double    |         |
| col1                    | string    |         |
| order_date              | string    |         |
| # Partition Information |           |         |
| # col_name              | data_type | comment |
| order_date              | string    |         |
+-------------------------+-----------+---------+
```

**Iceberg语法创建分区**

```SQL
-- 创建一个按照年份和月份分区的表
CREATE TABLE sales_ice (
  order_id INT,
  customer_id INT,
  order_date string,
  amount DOUBLE
) 
PARTITIONED BY (order_date);



-- 向表中插入数据，不指定分区，按照顺序对应
INSERT INTO sales_ice VALUES
(1, 101, '2023-01-01',100.0),
(2, 102, '2023-01-02',200.0 ),
(3, 103, '2023-02-01',300.0 ),
(4, 104, '2023-02-02',400.0);

-- 向表中插入数据，指定分区
INSERT INTO sales_ice PARTITION (order_date='2023-03-01') VALUES
(5, 105, 500.0),
(6, 106, 600.0);
+----------+-------------+------------+--------+
| order_id | customer_id | order_date | amount |
+----------+-------------+------------+--------+
| 1        | 101         | 2023-01-01 | 100.0  |
| 2        | 102         | 2023-01-02 | 200.0  |
| 3        | 103         | 2023-02-01 | 300.0  |
| 4        | 104         | 2023-02-02 | 400.0  |
| 5        | 105         | 2023-03-01 | 500.0  |
| 6        | 106         | 2023-03-01 | 600.0  |
+----------+-------------+------------+--------+
-- 覆盖表中的数据，指定分区
INSERT OVERWRITE sales_ice PARTITION (order_date='2023-03-01') VALUES
(7, 107, 700.0),
(8, 108, 800.0);
+----------+-------------+------------+--------+
| order_id | customer_id | order_date | amount |
+----------+-------------+------------+--------+
| 1        | 101         | 2023-01-01 | 100.0  |
| 2        | 102         | 2023-01-02 | 200.0  |
| 3        | 103         | 2023-02-01 | 300.0  |
| 4        | 104         | 2023-02-02 | 400.0  |
| 7        | 107         | 2023-03-01 | 700.0  |
| 8        | 108         | 2023-03-01 | 800.0  |
+----------+-------------+------------+--------+
--动态分区
INSERT OVERWRITE sales_ice PARTITION (order_date) VALUES
(11, 111,'2023-03-01', 700.0),
(12, 112,'2023-03-01', 800.0);
+----------+-------------+------------+--------+
| order_id | customer_id | order_date | amount |
+----------+-------------+------------+--------+
| 1        | 101         | 2023-01-01 | 100.0  |
| 2        | 102         | 2023-01-02 | 200.0  |
| 3        | 103         | 2023-02-01 | 300.0  |
| 4        | 104         | 2023-02-02 | 400.0  |
| 11       | 111         | 2023-03-01 | 700.0  |
| 12       | 112         | 2023-03-01 | 800.0  |
+----------+-------------+------------+--------+
-- 覆盖表中的数据，不指定分区,按照数据映射
INSERT OVERWRITE sales_ice VALUES
(9, 109,'2023-04-01', 900.0 ),
(10, 110, '2023-04-02',1000.0 );
+----------+-------------+------------+--------+
| order_id | customer_id | order_date | amount |
+----------+-------------+------------+--------+
| 1        | 101         | 2023-01-01 | 100.0  |
| 2        | 102         | 2023-01-02 | 200.0  |
| 3        | 103         | 2023-02-01 | 300.0  |
| 4        | 104         | 2023-02-02 | 400.0  |
| 11       | 111         | 2023-03-01 | 700.0  |
| 12       | 112         | 2023-03-01 | 800.0  |
| 9        | 109         | 2023-04-01 | 900.0  |
| 10       | 110         | 2023-04-02 | 1000.0 |
+----------+-------------+------------+--------+
```

## 查看分区

[SHOW PARTITIONS](list-partition.md)
