# 探索和分析数据湖Volume上的Parquet文件里的数据

## 引言

数据湖是Lakehouse的重要组成部分，允许您以原始格式存储所有结构化和非结构化数据，无需事先定义模式，这充分体现了湖仓一体的优势，将Lakehouse的数据管理扩展到对非结构化数据的一体化管理，不再局限于数仓里的结构化数据管理。本文将介绍如何利用SQL在Lakehouse环境中探索和分析存储在Volume上的Parquet文件数据，以纽约市出租车数据分析为实例，展示数据探索的完整过程和方法。

## Parquet格式简介

Parquet是一种列式存储格式，专为大数据处理而设计，具有以下主要特点：

* **列式存储**：数据按列而非按行存储，特别适合于分析查询
* **高效压缩**：相比传统行式存储如CSV，可节省50-75%的存储空间
* **高性能**：支持谓词下推(predicate pushdown)，允许查询引擎仅读取需要的列和行
* **自包含元数据**：文件包含模式定义，支持自描述
* **广泛兼容**：被Hadoop、Spark、Presto等大数据工具广泛支持

Parquet格式特别适合存储和查询大规模的结构化数据，如日志数据、事务数据和传感器数据，非常适合数据湖场景。

## 数据湖Volume概念

在Lakehouse平台中，Volume是一个关键概念：

* **Volume**是数据湖中的逻辑存储单元，类似于传统数据库中的表空间
* Volume可以指向内部存储或外部存储(如OSS、S3、HDFS等)
* 通过Volume机制，数据湖可以直接查询外部存储系统中的数据，无需导入
* 每个Volume可以包含多个文件，支持目录层次结构

本文以`yellow_trip_record_data`为例，这是一个指向外部对象存储的Volume，包含纽约市黄色出租车的行程数据。

## 样例数据介绍

本文使用的纽约市出租车数据(NYC Yellow Taxi Trip Records)是一个公开的交通数据集：

* 数据存储在名为`yellow_trip_record_data`的Volume中
* 数据以Parquet格式存储，按月份组织
* 文件命名格式为`yellow_tripdata_YYYY-MM.parquet`（例如：`yellow_tripdata_2024-01.parquet`表示2024年1月的数据）
* 每个文件包含该月份所有黄色出租车行程的详细记录
* 数据包含上下车时间、地点、费用、乘客数等丰富信息

这些数据可用于分析城市交通模式、出租车需求、价格趋势等多方面内容。

## 目录

1. [数据湖Volume基础操作](#1-数据湖volume基础操作)
2. [初步数据探索](#2-初步数据探索)
3. [数据预览](#3-数据预览)
4. [基础数据分析](#4-基础数据分析)
5. [高级分析和聚合](#5-高级分析和聚合)
6. [时间序列分析](#6-时间序列分析)
7. [最佳实践和优化技巧](#7-最佳实践和优化技巧)
8. [结论](#结论)

## 1. 数据湖Volume基础操作

在开始分析前，需要了解和掌握数据湖Volume的基础操作，这是与数据交互的第一步。

### 1.1 列出可用Volume

```sql
SHOW VOLUMES;
```

通过此命令可以查看所有可用的数据卷，包括Volume名称、创建时间、类型(内部/外部)、URL地址等信息。在我们的示例中，这个命令会显示包括`yellow_trip_record_data`在内的所有可用Volume。

执行结果示例：

```
volume_name: yellow_trip_record_data
create_time: 2025-05-14T06:40:56.571000+00:00
external: true
workspace_name: ns227206
url: oss://tlc-trip-record-data/yellow-trip-record-data/
recursive_file_lookup: true
connection: ns227206.oss_sh_conn_ak
```

从结果可以看出，这是一个外部Volume，指向OSS对象存储中的一个路径，并且启用了递归文件查找选项。

### 1.2 列出Volume中的文件

```sql
LIST VOLUME yellow_trip_record_data SUBDIRECTORY '/';
```

此命令将显示指定Volume根目录中的所有文件，包括文件相对路径、完整URL、文件大小和最后修改时间等信息。`SUBDIRECTORY '/'`表示查看根目录下的文件，如果数据有层次结构，可以指定子目录路径。

执行结果示例：

```
relative_path: yellow_tripdata_2024-01.parquet
url: oss://tlc-trip-record-data/yellow-trip-record-data/yellow_tripdata_2024-01.parquet
size: 49961641
last_modified_time: 2025-05-14T12:02:21+00:00

relative_path: yellow_tripdata_2024-02.parquet
...
```

此结果显示Volume中包含多个按月命名的Parquet文件，每个约50MB大小，包含2024年1月至2025年2月的数据。

## 2. 初步数据探索

在处理不熟悉的数据集时，首先需要了解数据的整体情况，建立对数据内容和结构的初步认识。

### 2.1 列出文件

对于我们的示例数据集，首先列出所有可用的数据文件：

```sql
LIST VOLUME yellow_trip_record_data SUBDIRECTORY '/';
```

执行该命令后，我们看到Volume中包含多个Parquet文件，命名模式为`yellow_tripdata_YYYY-MM.parquet`。

### 2.2 了解文件格式和命名规则

通过观察文件名(如`yellow_tripdata_2024-01.parquet`)，我们可以了解到:

* 文件格式为Parquet（通过.parquet后缀识别）
* 命名规则为"yellow\_tripdata\_年份-月份.parquet"
* 数据按月份组织，覆盖2024年1月至2025年2月
* 每个文件大小约为50-60MB

这种命名和组织方式是数据湖中常见的分区策略，按时间维度分割数据，方便查询特定时间段的数据并提高查询效率。

### 2.3 了解数据来源和背景

纽约出租车与豪华轿车委员会(TLC)收集的黄色出租车行程记录数据包含出租车行程的上下车日期/时间、位置、行程距离、详细费用、费率类型、付款方式等信息。此类公共交通数据对城市规划、交通管理和商业决策具有重要价值。

## 3. 数据预览

在深入分析前，先预览数据结构和内容至关重要，这样可以了解数据的质量、格式和可能的分析方向。

### 3.1 预览Parquet文件内容

Clickzetta允许我们直接使用SQL查询来预览Parquet文件的内容，无需先创建表或导入数据：

```sql
SELECT * FROM VOLUME yellow_trip_record_data
USING parquet
FILES('yellow_tripdata_2024-01.parquet')
LIMIT 10;
```

这个查询语法的关键部分：

* `FROM VOLUME yellow_trip_record_data`：指定数据来源是哪个Volume
* `USING parquet`：声明文件格式为Parquet
* `FILES('yellow_tripdata_2024-01.parquet')`：指定要查询的具体文件
* `LIMIT 10`：只返回前10条记录，用于快速预览

执行结果示例：

```
VendorID: 2
tpep_pickup_datetime: 2024-01-01T00:57:55
tpep_dropoff_datetime: 2024-01-01T01:17:43
passenger_count: 1
trip_distance: 1.72
RatecodeID: 1
store_and_fwd_flag: N
PULocationID: 186
DOLocationID: 79
payment_type: 2
fare_amount: 17.7
extra: 1.0
mta_tax: 0.5
tip_amount: 0.0
tolls_amount: 0.0
improvement_surcharge: 1.0
total_amount: 22.7
congestion_surcharge: 2.5
Airport_fee: 0.0
...
```

### 3.2 分析数据结构

通过预览，我们可以详细了解纽约出租车数据包含以下关键字段:

| 字段名                     | 数据类型 | 描述                                                      |
| ----------------------- | ---- | ------------------------------------------------------- |
| VendorID                | 整数   | 提供记录的供应商ID (1=Creative Mobile Technologies, 2=VeriFone) |
| tpep\_pickup\_datetime  | 时间戳  | 乘客上车的日期和时间                                              |
| tpep\_dropoff\_datetime | 时间戳  | 乘客下车的日期和时间                                              |
| passenger\_count        | 整数   | 车辆中的乘客数量                                                |
| trip\_distance          | 浮点数  | 行程距离(英里)                                                |
| PULocationID            | 整数   | 上车地点ID（对应纽约市区域编码）                                       |
| DOLocationID            | 整数   | 下车地点ID（对应纽约市区域编码）                                       |
| payment\_type           | 整数   | 支付方式编码 (1=信用卡, 2=现金, 3=免费, 4=纠纷, 5=未知)                  |
| fare\_amount            | 浮点数  | 行程基本费用                                                  |
| total\_amount           | 浮点数  | 包含所有费用的总金额                                              |

通过这种初步检查，我们现在了解了数据的结构和字段含义，为后续的分析奠定了基础。

## 4. 基础数据分析

获取数据基本概况，包括数量统计、平均值和异常值检测。

### 4.1 基础统计分析

```sql
SELECT 
  COUNT(*) as total_trips,
  AVG(trip_distance) as avg_distance,
  MIN(trip_distance) as min_distance,
  MAX(trip_distance) as max_distance,
  AVG(total_amount) as avg_fare,
  MIN(total_amount) as min_fare,
  MAX(total_amount) as max_fare,
  AVG(TIMESTAMPDIFF(MINUTE, tpep_pickup_datetime, tpep_dropoff_datetime)) as avg_trip_duration_minutes
FROM VOLUME yellow_trip_record_data
USING parquet
FILES('yellow_tripdata_2024-01.parquet');
```

### 4.2 分类分析

分析分类变量(如支付方式)的分布情况:

```sql
SELECT 
  payment_type,
  COUNT(*) as trip_count,
  ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM VOLUME yellow_trip_record_data USING parquet FILES('yellow_tripdata_2024-01.parquet')), 2) as percentage
FROM VOLUME yellow_trip_record_data
USING parquet
FILES('yellow_tripdata_2024-01.parquet')
GROUP BY payment_type
ORDER BY trip_count DESC;
```

### 4.4 热点区域分析

```sql
-- 最热门的上车地点
SELECT 
  PULocationID,
  COUNT(*) as pickup_count,
  ROUND(AVG(trip_distance), 2) as avg_distance,
  ROUND(AVG(total_amount), 2) as avg_fare
FROM VOLUME yellow_trip_record_data
USING parquet
FILES('yellow_tripdata_2024-01.parquet')
GROUP BY PULocationID
ORDER BY pickup_count DESC
LIMIT 5;
```

**执行结果**：

```
| PULocationID | pickup_count | avg_distance | avg_fare |
|--------------|--------------|--------------|----------|
| 132          | 145240       | 15.49        | 76.58    |
| 161          | 143471       | 2.56         | 23.48    |
| 237          | 142708       | 1.70         | 19.45    |
| 236          | 136465       | 1.85         | 20.00    |
| 162          | 106717       | 2.23         | 22.88    |
```

该查询揭示了最受欢迎的上车点：

* PULocationID 132是最热门的上车点，有145,240次乘车
* 该区域平均行程距离显著高于其他区域（15.49英里），平均费用也最高（76.58美元），这表明它可能是一个主要机场或交通枢纽
* 其他热门上车点（如161、237、236和162）的平均行程距离和费用明显低于132，可能是市区热门位置

### 4.5 数值分布分析

```sql
-- 行程距离与价格的分布
SELECT 
  CASE 
    WHEN trip_distance BETWEEN 0 AND 1 THEN '0-1'
    WHEN trip_distance BETWEEN 1 AND 2 THEN '1-2'
    WHEN trip_distance BETWEEN 2 AND 3 THEN '2-3'
    WHEN trip_distance BETWEEN 3 AND 5 THEN '3-5'
    WHEN trip_distance BETWEEN 5 AND 10 THEN '5-10'
    ELSE '10+'
  END AS distance_range,
  COUNT(*) as trip_count,
  ROUND(AVG(total_amount), 2) as avg_fare
FROM VOLUME yellow_trip_record_data
USING parquet
FILES('yellow_tripdata_2024-01.parquet')
WHERE trip_distance <= 100 -- 过滤掉异常值
GROUP BY distance_range
ORDER BY CASE 
    WHEN distance_range = '0-1' THEN 1
    WHEN distance_range = '1-2' THEN 2
    WHEN distance_range = '2-3' THEN 3
    WHEN distance_range = '3-5' THEN 4
    WHEN distance_range = '5-10' THEN 5
    ELSE 6
  END;
```

**执行结果**：

```
| distance_range | trip_count | avg_fare |
|----------------|------------|----------|
| 0-1            | 778076     | 15.00    |
| 1-2            | 967440     | 18.37    |
| 2-3            | 448775     | 23.83    |
| 3-5            | 308574     | 30.39    |
| 5-10           | 233505     | 46.68    |
| 10+            | 228195     | 83.41    |
```

这个分析提供了行程距离和费用之间关系的重要见解：

* 1-2英里是最常见的行程距离范围，有967,440次行程
* 短距离行程（0-3英里）占总行程的73.7%
* 行程距离与平均费用呈明显的正相关关系
* 10英里以上的长途行程均价高达83.41美元，是短途行程（0-1英里）均价的5.5倍

```sql
SELECT 
  CASE 
    WHEN trip_distance BETWEEN 0 AND 1 THEN '0-1'
    WHEN trip_distance BETWEEN 1 AND 2 THEN '1-2'
    WHEN trip_distance BETWEEN 2 AND 3 THEN '2-3'
    WHEN trip_distance BETWEEN 3 AND 5 THEN '3-5'
    WHEN trip_distance BETWEEN 5 AND 10 THEN '5-10'
    WHEN trip_distance BETWEEN 10 AND 20 THEN '10-20'
    WHEN trip_distance > 20 THEN '20+'
    ELSE 'Unknown'
  END AS distance_range,
  COUNT(*) as trip_count,
  ROUND(AVG(total_amount), 2) as avg_fare
FROM VOLUME yellow_trip_record_data
USING parquet
FILES('yellow_tripdata_2024-01.parquet')
WHERE trip_distance <= 100 -- 过滤掉异常值
GROUP BY distance_range
ORDER BY CASE 
    WHEN distance_range = '0-1' THEN 1
    WHEN distance_range = '1-2' THEN 2
    WHEN distance_range = '2-3' THEN 3
    WHEN distance_range = '3-5' THEN 4
    WHEN distance_range = '5-10' THEN 5
    WHEN distance_range = '10-20' THEN 6
    WHEN distance_range = '20+' THEN 7
    ELSE 8
  END;
```

## 5. 高级分析和聚合

更深入的数据分析，包括多维度聚合、热点分析等。

### 5.1 时间维度聚合

```sql
-- 每小时行程分布
SELECT 
  HOUR(tpep_pickup_datetime) as hour_of_day,
  COUNT(*) as trip_count,
  ROUND(AVG(trip_distance), 2) as avg_distance,
  ROUND(AVG(total_amount), 2) as avg_fare
FROM VOLUME yellow_trip_record_data
USING parquet
FILES('yellow_tripdata_2024-01.parquet')
GROUP BY hour_of_day
ORDER BY hour_of_day ASC;
```

### 5.2 热点区域分析

```sql
-- 最热门的上车地点
SELECT 
  PULocationID,
  COUNT(*) as pickup_count,
  ROUND(AVG(trip_distance), 2) as avg_distance,
  ROUND(AVG(total_amount), 2) as avg_fare
FROM VOLUME yellow_trip_record_data
USING parquet
FILES('yellow_tripdata_2024-01.parquet')
GROUP BY PULocationID
ORDER BY pickup_count DESC
LIMIT 10;
```

### 5.3 多维度对比分析

```sql
-- 工作日vs周末的行程情况
SELECT 
  CASE 
    WHEN DAYOFWEEK(tpep_pickup_datetime) IN (1, 7) THEN '周末'
    ELSE '工作日'
  END AS day_type,
  COUNT(*) as trip_count,
  ROUND(AVG(trip_distance), 2) as avg_distance,
  ROUND(AVG(total_amount), 2) as avg_fare,
  ROUND(AVG(passenger_count), 2) as avg_passengers
FROM VOLUME yellow_trip_record_data
USING parquet
FILES('yellow_tripdata_2024-01.parquet')
WHERE trip_distance <= 100 -- 过滤掉异常值
GROUP BY day_type;
```

## 6. 时间序列分析

分析多个时间段的数据变化趋势。

### 6.1 多月份数据合并分析

由于无法直接通过文件名变量引用多个文件，可以使用以下方法处理多月份数据:

```sql
-- 使用CTE合并多月数据
WITH jan AS (
  SELECT 
    '2024-01' as month,
    COUNT(*) as trip_count,
    ROUND(AVG(trip_distance), 2) as avg_distance,
    ROUND(AVG(total_amount), 2) as avg_fare
  FROM VOLUME yellow_trip_record_data
  USING parquet
  FILES('yellow_tripdata_2024-01.parquet')
  WHERE trip_distance <= 100
),
feb AS (
  SELECT 
    '2024-02' as month,
    COUNT(*) as trip_count,
    ROUND(AVG(trip_distance), 2) as avg_distance,
    ROUND(AVG(total_amount), 2) as avg_fare
  FROM VOLUME yellow_trip_record_data
  USING parquet
  FILES('yellow_tripdata_2024-02.parquet')
  WHERE trip_distance <= 100
)
SELECT * FROM jan
UNION ALL SELECT * FROM feb
ORDER BY month;
```

### 6.2 季度数据分析

```sql
-- 分析各季度支付方式趋势
WITH q1 AS (
  SELECT 
    '2024-Q1' as quarter,
    payment_type,
    COUNT(*) as payment_count
  FROM VOLUME yellow_trip_record_data
  USING parquet
  FILES('yellow_tripdata_2024-01.parquet', 'yellow_tripdata_2024-02.parquet', 'yellow_tripdata_2024-03.parquet')
  GROUP BY quarter, payment_type
),
q2 AS (
  SELECT 
    '2024-Q2' as quarter,
    payment_type,
    COUNT(*) as payment_count
  FROM VOLUME yellow_trip_record_data
  USING parquet
  FILES('yellow_tripdata_2024-04.parquet', 'yellow_tripdata_2024-05.parquet', 'yellow_tripdata_2024-06.parquet')
  GROUP BY quarter, payment_type
)
SELECT * FROM q1
UNION ALL SELECT * FROM q2
ORDER BY quarter, payment_type;
```

## 7. 最佳实践和优化技巧

### 7.1 数据过滤

在处理大数据时，合理的过滤条件可以大幅提高查询效率:

```sql
-- 使用WHERE子句过滤异常值
SELECT 
  COUNT(*) as trip_count,
  ROUND(AVG(trip_distance), 2) as avg_distance
FROM VOLUME yellow_trip_record_data
USING parquet
FILES('yellow_tripdata_2024-01.parquet')
WHERE 
  trip_distance BETWEEN 0.5 AND 100 AND  -- 排除可能的异常距离
  total_amount > 0 AND                   -- 排除免费或错误记录的行程
  passenger_count > 0;                   -- 排除无乘客记录
```

有效的过滤条件能够：

* 排除数据异常值，提高分析结果的准确性
* 减少处理的数据量，提高查询性能
* 专注于最相关的数据子集，满足特定的分析需求

### 7.2 列剪裁和谓词下推

充分利用Parquet格式的列式存储和谓词下推特性：

```sql
-- 只选择需要的列而非所有列
SELECT 
  tpep_pickup_datetime,
  tpep_dropoff_datetime,
  trip_distance,
  total_amount
FROM VOLUME yellow_trip_record_data
USING parquet
FILES('yellow_tripdata_2024-01.parquet')
WHERE HOUR(tpep_pickup_datetime) BETWEEN 8 AND 10  -- 利用谓词下推只读取需要的行
LIMIT 1000;
```

这种优化策略能够：

* 减少I/O量，仅读取查询所需的列数据
* 利用Parquet内置的过滤能力，在文件里跳过不符合条件的数据块
* 显著提高大数据集上的查询性能

### 7.3 分阶段分析

对于大型数据集，采用分阶段分析策略:

1. 先在单个文件上进行探索性分析
2. 验证分析逻辑后再扩展到全部数据
3. 使用CTE组织复杂查询，增强可读性和可维护性

```sql
-- 使用CTE简化复杂查询
WITH hourly_stats AS (
  SELECT 
    HOUR(tpep_pickup_datetime) as hour_of_day,
    COUNT(*) as trip_count,
    AVG(trip_distance) as avg_distance
  FROM VOLUME yellow_trip_record_data
  USING parquet
  FILES('yellow_tripdata_2024-01.parquet')
  GROUP BY HOUR(tpep_pickup_datetime)
),
peak_hours AS (
  SELECT 
    hour_of_day,
    trip_count,
    avg_distance,
    RANK() OVER (ORDER BY trip_count DESC) as popularity_rank
  FROM hourly_stats
)
SELECT * FROM peak_hours
WHERE popularity_rank <= 5
ORDER BY popularity_rank;
```

这种方法使得复杂查询更易于理解、调试和维护。

### 7.4 数据质量检查

在分析前进行数据质量检查:

```sql
-- 检查缺失值和异常值
SELECT 
  COUNT(*) as total_records,
  SUM(CASE WHEN passenger_count IS NULL OR passenger_count = 0 THEN 1 ELSE 0 END) as missing_passenger_count,
  SUM(CASE WHEN trip_distance IS NULL OR trip_distance = 0 THEN 1 ELSE 0 END) as zero_distance,
  SUM(CASE WHEN trip_distance > 100 THEN 1 ELSE 0 END) as suspicious_long_trips,
  SUM(CASE WHEN total_amount < 0 THEN 1 ELSE 0 END) as negative_fares
FROM VOLUME yellow_trip_record_data
USING parquet
FILES('yellow_tripdata_2024-01.parquet');
```

数据质量检查能够：

* 发现数据中的问题和异常
* 指导后续分析中的数据清理和转换
* 提高分析结果的可靠性和准确性

## 结论

通过SQL方式直接分析数据湖Volume中的Parquet文件，我们可以:

1. 快速探索和了解数据结构
2. 进行全方位的统计分析
3. 发现数据中的时间和空间模式
4. 比较不同时间段的数据变化趋势

这种方法避免了数据复制和转换的开销，直接在数据湖上进行分析，提高了效率。对于大数据环境，这种分析方式既灵活又高效，特别适合数据科学家和分析师进行数据探索和初步分析。

通过本文的纽约出租车数据案例，我们展示了从基础的数据探索到复杂的时间序列分析的完整流程，为数据湖环境下的Parquet文件分析提供了实用指南。与传统的先导入后分析的方法相比，这种直接查询方法极大地提高了数据分析的灵活性和响应速度，特别适合于初步数据探索和验证分析假设。

在实际项目中，这些分析可以为出租车公司优化车辆调度、城市管理部门改善交通规划、金融分析师了解消费趋势等多种场景提供数据支持。数据湖上的SQL分析正成为连接原始数据和商业洞察的关键桥梁。

^

## 参考

[外部Volume](external_volume.md)
