# 概述

Star Schema Benchmark（简称 SSB）是一种用于评估 OLAP 系统性能的基准测试。SSB 基于 TPC-H 提供了一个简化版的星型模型数据集，主要用于测试在星型模型下多表关联查询的性能表现。ClickHouse 官方将 SSB 的星型模型打平转化成宽表，改造成了一个单表测试集，参见 [ClickHouse官方说明](https://clickhouse.com/docs/en/getting-started/example-datasets/star-schema)。

本报告为您提供了云器 Lakehouse 与 ClickHouse 在 SSB 单表测试集 100GB 规模上的测试结果，结论如下：

![](.topwrite/assets/image_1731490816583.png)

* 在 SSB 单表测试集 100GB 规模数据集上执行的 13 个查询中，ClickHouse 总耗时是云器 Lakehouse 的 1.48 倍，云器 Lakehouse 性能更优。

# 测试环境

* **ClickHouse 测试环境**

| **配置项** | **配置信息**                                      |
| ------- | --------------------------------------------- |
| 服务器     | 1 台阿里云 ECS 服务器（ecs.g7.16xlarge，64 vCPU，256 GiB） |
| 网络带宽    | 32 Gbps                                        |
| 软件      | ClickHouse 23.3                               |
| 存储服务    | ESSD 高效云盘，200 GB，PL1，单盘 IOPS 上限 5 万                 |
| 硬件费用    | 17.164 元/小时                                    |

* **云器 Lakehouse 测试环境**

| **配置项** | **配置信息**       |
| ------- | ------------------------- |
| 计算资源    | Large 规格的计算集群（64 vCPU 等效算力） |
| 软件      | 阿里云上海 Region - 云器 Lakehouse 服务 |
| 存储服务    | 托管存储，阿里云OSS对象存储           |

# 测试数据

测试使用了 SSB 标准数据集，包含以下表和记录数：

* **lineorder**：6 亿条记录
* **customer**：300 万条记录
* **part**：140 万条记录
* **supplier**：20 万条记录
* **dates**：2556 条记录
* **lineorder_flat**：6 亿条记录（展平后宽表）

# 测试过程

## ClickHouse

DDL 与查询语句（Query）与 ClickHouse 官网测试方式一致，详情参见 [ClickHouse官方文档](https://clickhouse.com/docs/en/getting-started/example-datasets/star-schema)。

## 云器 Lakehouse

### 创建集群

* 在Lakehouse中创建Large规格的虚拟集群

```SQL
create vcluster if not exists LARGE_CLUSTER vcluster_size='LARGE' vcluster_type='Analytics' AUTO_RESUME=TRUE AUTO_SUSPEND_IN_SECOND=300 min_replicas=1 max_replicas=1;
```

### 建表语句

```SQL
  --建表语句
CREATE TABLE demo_examples.ssb_100g.lineorder_flat(
  `lo_orderkey` int not null,
  `lo_linenumber` int not null,
  `lo_custkey` int not null,
  `lo_partkey` int not null,
  `lo_suppkey` int not null,
  `lo_orderdate` date not null,
  `lo_orderpriority` string not null,
  `lo_shippriority` int not null,
  `lo_quantity` int not null,
  `lo_extendedprice` int not null,
  `lo_ordtotalprice` int not null,
  `lo_discount` int not null,
  `lo_revenue` int not null,
  `lo_supplycost` int not null,
  `lo_tax` int not null,
  `lo_commitdate` date not null,
  `lo_shipmode` string not null,
  `c_name` string not null,
  `c_address` string not null,
  `c_city` string not null,
  `c_nation` string not null,
  `c_region` string not null,
  `c_phone` string not null,
  `c_mktsegment` string not null,
  `s_name` string not null,
  `s_address` string not null,
  `s_city` string not null,
  `s_nation` string not null,
  `s_region` string not null,
  `s_phone` string not null,
  `p_name` string not null,
  `p_mfgr` string not null,
  `p_category` string not null,
  `p_brand` string not null,
  `p_color` string not null,
  `p_type` string not null,
  `p_size` int not null,
  `p_container` string not null)
 CLUSTERED BY(lo_orderkey) SORTED BY(lo_orderdate, lo_orderkey) INTO 64 BUCKETS
  PROPERTIES ('cz.storage.parquet.compression'='lz4');

 --收集统计信息
 analyze table lineorder_flat compute statistics for all columns;
```

### 运行查询

```SQL
--禁用结果缓存
set cz.sql.enable.shortcut.result.cache=false;

--Q1.1
SELECT /*Q1.1*/ sum(LO_EXTENDEDPRICE * LO_DISCOUNT) AS revenue 
FROM lineorder_flat 
WHERE Year(LO_ORDERDATE) = 1993 AND LO_DISCOUNT BETWEEN 1 AND 3 AND LO_QUANTITY < 25;

--Q1.2
SELECT /*Q1.2*/ sum(LO_EXTENDEDPRICE * LO_DISCOUNT) AS revenue 
FROM lineorder_flat 
WHERE Year(LO_ORDERDATE) = 1994 and Month(LO_ORDERDATE) = 1 AND LO_DISCOUNT BETWEEN 4 AND 6 AND LO_QUANTITY BETWEEN 26 AND 35;

--Q1.3
SELECT /*Q1.3*/ sum(LO_EXTENDEDPRICE * LO_DISCOUNT) AS revenue 
FROM lineorder_flat WHERE WeekOfYear(LO_ORDERDATE) = 6 AND Year(LO_ORDERDATE) = 1994 AND LO_DISCOUNT BETWEEN 5 AND 7 AND LO_QUANTITY BETWEEN 26 AND 35;

--Q2.1
SELECT /*Q2.1*/
    sum(LO_REVENUE),
    Year(LO_ORDERDATE) AS year,
    P_BRAND 
FROM lineorder_flat 
WHERE P_CATEGORY = 'MFGR#12' AND S_REGION = 'AMERICA' 
GROUP BY 
    year,
    P_BRAND 
ORDER BY year,P_BRAND;

--Q2.2
SELECT /*Q2.2*/
    sum(LO_REVENUE),
    Year(LO_ORDERDATE) AS year,
    P_BRAND 
FROM lineorder_flat 
WHERE P_BRAND >= 'MFGR#2221' AND P_BRAND <= 'MFGR#2228' AND S_REGION = 'ASIA' GROUP BY year,P_BRAND ORDER BY year,P_BRAND;

--Q2.3
SELECT /*Q2.3*/ sum(LO_REVENUE),Year(LO_ORDERDATE) AS year,P_BRAND FROM lineorder_flat WHERE P_BRAND = 'MFGR#2239' AND S_REGION = 'EUROPE' GROUP BY year, P_BRAND ORDER BY year,P_BRAND;

--Q3.1
SELECT /*Q3.1*/ C_NATION,S_NATION,Year(LO_ORDERDATE) AS year,sum(LO_REVENUE) AS revenue FROM lineorder_flat WHERE C_REGION = 'ASIA' AND S_REGION = 'ASIA' GROUP BY C_NATION,S_NATION,year HAVING year >= 1992 AND year <= 1997 ORDER BY year ASC,revenue DESC;

--Q3.2
SELECT /*Q3.2*/ C_CITY,S_CITY,Year(LO_ORDERDATE) AS year,sum(LO_REVENUE) AS revenue FROM lineorder_flat WHERE C_NATION = 'UNITED STATES' AND S_NATION = 'UNITED STATES' GROUP BY C_CITY,S_CITY,year HAVING year >= 1992 AND year <= 1997 ORDER BY year ASC,revenue DESC;

--Q3.3
SELECT /*Q3.3*/
    C_CITY,
    S_CITY,
    Year(LO_ORDERDATE) AS year,
    sum(LO_REVENUE) AS revenue 
FROM lineorder_flat 
WHERE (C_CITY = 'UNITED KI1' OR C_CITY = 'UNITED KI5') 
AND (S_CITY = 'UNITED KI1' OR S_CITY = 'UNITED KI5') 
GROUP BY C_CITY,S_CITY,year HAVING year >= 1992 AND year <= 1997 
ORDER BY year ASC,revenue DESC;

--Q3.4
SELECT /*Q3.4*/
    C_CITY,
    S_CITY,
    Year(LO_ORDERDATE) AS year,
    sum(LO_REVENUE) AS revenue FROM lineorder_flat 
WHERE (C_CITY = 'UNITED KI1' OR C_CITY = 'UNITED KI5') AND (S_CITY = 'UNITED KI1' OR S_CITY = 'UNITED KI5') AND Year(LO_ORDERDATE) = 1997 AND Month(LO_ORDERDATE) = 12 GROUP BY C_CITY,S_CITY,year ORDER BY year ASC,revenue DESC;

--Q4.1
SELECT /*Q4.1*/ Year(LO_ORDERDATE) AS year,
    C_NATION,
    sum(LO_REVENUE - LO_SUPPLYCOST) AS profit 
FROM lineorder_flat WHERE C_REGION = 'AMERICA' AND S_REGION = 'AMERICA' AND (P_MFGR = 'MFGR#1' OR P_MFGR = 'MFGR#2') GROUP BY year,C_NATION ORDER BY year ASC,C_NATION ASC;

--Q4.2
SELECT /*Q4.2*/ Year(LO_ORDERDATE) AS year,
    S_NATION,
    P_CATEGORY,
    sum(LO_REVENUE - LO_SUPPLYCOST) AS profit 
FROM lineorder_flat 
WHERE C_REGION = 'AMERICA' AND S_REGION = 'AMERICA' AND (P_MFGR = 'MFGR#1' OR P_MFGR = 'MFGR#2') GROUP BY year,S_NATION,P_CATEGORY HAVING year == 1997 OR year == 1998 ORDER BY year ASC,S_NATION ASC,P_CATEGORY ASC;

SELECT /*Q4.3*/ Year(LO_ORDERDATE) AS year,
    S_CITY,
    P_BRAND,
    sum(LO_REVENUE - LO_SUPPLYCOST) AS profit 
FROM lineorder_flat 
WHERE S_NATION = 'UNITED STATES' AND P_CATEGORY = 'MFGR#14' 
GROUP BY year,S_CITY,P_BRAND 
HAVING year = 1997 OR year = 1998 
ORDER BY year ASC,S_CITY ASC,P_BRAND ASC;
```

# 测试结果

以下是云器 Lakehouse 和 ClickHouse 在 13 个查询上的性能测试结果，单位为毫秒 (ms)，数值越低表示性能越好。

ClickHouse 使用了默认的 LZ4 压缩方式，云器 Lakehouse 也使用 LZ4 压缩方式。所有查询预热一次后，执行三次取平均值作为结果。

| 查询   | 云器 Lakehouse | ClickHouse 23.3 | ClickHouse vs. 云器 Lakehouse |
| ---- | ----------- | --------------- | ------------------------ |
| Q1.1 | 59          | 48              | 0.81                     |
| Q1.2 | 30          | 15              | 0.50                     |
| Q1.3 | 28          | 14              | 0.50                     |
| Q2.1 | 197         | 301             | 1.53                     |
| Q2.2 | 183         | 273             | 1.49                     |
| Q2.3 | 149         | 255             | 1.71                     |
| Q3.1 | 259         | 398             | 1.54                     |
| Q3.2 | 200         | 319             | 1.60                     |
| Q3.3 | 146         | 227             | 1.55                     |
| Q3.4 | 34          | 18              | 0.53                     |
| Q4.1 | 281         | 469             | 1.67                     |
| Q4.2 | 117         | 160             | 1.37                     |
| Q4.3 | 101         | 148             | 1.47                     |
| 总计  | 1784        | 2645            | 1.48                     |

