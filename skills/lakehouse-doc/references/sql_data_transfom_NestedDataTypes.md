# 通过嵌套数据类型(Nested Data Types)进行数据转换

## 基本概念

SQL嵌套数据类型（Nested Data Types）允许在表的列中包含复杂的数据结构，如**STRUCT** 和 **ARRAY**。这些数据结构使得表示一对一、多对一以及层次关系变得更加简洁和清晰。

* **STRUCT**: 表示包含多个相关列的单个字段，这些列可以表示对象的属性。
* **ARRAY**: 表示包含多个结构字段的数组，适用于多对一关系。

## 优势

1. **简化数据模式**：使用STRUCT和ARRAY类型可以简化数据表的模式，使得存储和检索相关列数据更加方便。
2. **提高查询性能**：嵌套数据类型可以减少表的联接操作，因为相关的数据已经在一个字段中嵌套好。
3. **增强可读性**：嵌套结构使得数据模式更加直观，开发人员更容易理解和使用。
4. **灵活的数据处理**：嵌套数据类型支持对复杂对象的灵活操作和排序，以及在数据处理过程中高效拆分和重组数据。

## 使用场景

* **一对一和层次关系**：适用于需要将多个相关字段组合在一起的场景，如用户信息和地址信息的组合。

```sql
SELECT 
    c_custkey, 
    STRUCT(c_name, c_address, c_phone) AS customer_info 
FROM 
    clickzetta_sample_data.tpch_100g.customer;
```

* **多对一关系**：适用于需要在一个字段中存储多个相关对象的场景，如订单和订单项的组合。

```sql
SELECT 
    o.o_orderkey, 
    ARRAY_AGG(STRUCT(o.o_clerk, o.o_totalprice, o.o_orderpriority)) AS items 
FROM 
    clickzetta_sample_data.tpch_100g.orders o 
GROUP BY 
    o.o_orderkey;
```

* **数据转换和清洗**：嵌套数据类型可以用于将数据拆分成更小的部分进行转换和清洗，然后再重新组合。

```sql
-- 使用CTE定义orders_array
WITH orders_array AS ( 
    -- 聚合每个客户的所有订单ID到一个数组中
    SELECT 
        o_custkey,
        ARRAY_AGG(o_orderkey) AS order_keys
    FROM 
        clickzetta_sample_data.tpch_100g.orders 
    GROUP BY 
        o_custkey
),
-- 使用CTE定义modified_items
modified_items AS (
    -- 使用TRANSFORM函数将每个订单ID加1，生成新的数组
    SELECT 
        o_custkey,
        TRANSFORM(order_keys, x -> x + 1) AS modified_order_keys
    FROM 
        orders_array
)
-- 主查询部分
SELECT 
    c.c_custkey, 
    mi.modified_order_keys
FROM 
    clickzetta_sample_data.tpch_100g.customer c 
-- 左连接modified_items，依据客户ID（c_custkey）
LEFT JOIN 
    modified_items mi
ON 
    c.c_custkey = mi.o_custkey;
```

:-: ![](.topwrite/assets/image_1736846123693.png =798)

使用嵌套数据类型（如STRUCT和ARRAY）来进行数据转换，可以简化数据模式、提高查询性能，并增强数据处理的灵活性和可读性，为复杂数据结构的管理提供了有效的解决方案。

^

## 数据模型

TPC-H 数据代表一个汽车零部件销售商的数据仓库，其中记录了订单、构成订单的项目（lineitem）、供应商、客户、销售的零部件（part）、地区、国家和零部件供应商（partsupp）。

云器Lakehouse内置了共享的TPC-H数据，每个用户可以通过加上数据上下文直接使用，比如：

```sql
SELECT * FROM 
clickzetta_sample_data.tpch_100g.customer
LIMIT 10;
```

## 通过云器Lakehouse嵌套数据类型进行数据转换

### 有效使用嵌套数据类型

#### 使用 STRUCT 处理一对一和层次关系

```sql
-- 未使用嵌套数据类型
SELECT l.*,
c.*,
s.*
FROM 
    clickzetta_sample_data.tpch_100g.lineitem l
LEFT JOIN 
    clickzetta_sample_data.tpch_100g.orders o ON l.l_orderkey = o.o_orderkey
LEFT JOIN 
    clickzetta_sample_data.tpch_100g.customer c ON o.o_custkey = c.c_custkey
LEFT JOIN 
    clickzetta_sample_data.tpch_100g.supplier s ON l.l_suppkey = s.s_suppkey
LIMIT 5;
```

:-: ![](.topwrite/assets/image_1736846295404.png =797)

^

```sql
-- 使用嵌套数据类型
SELECT 
    l.*, 
    struct(
        c.c_custkey,
        c.c_name,
        c.c_address,
        c.c_nationkey,
        c.c_phone,
        c.c_acctbal,
        c.c_mktsegment,
        c.c_comment
    ) AS customer,
    struct(
        s.s_suppkey,
        s.s_name,
        s.s_address,
        s.s_nationkey,
        s.s_phone,
        s.s_acctbal,
        s.s_comment
    ) AS supplier
FROM 
    clickzetta_sample_data.tpch_100g.lineitem l
LEFT JOIN 
    clickzetta_sample_data.tpch_100g.orders o ON l.l_orderkey = o.o_orderkey
LEFT JOIN 
    clickzetta_sample_data.tpch_100g.customer c ON o.o_custkey = c.c_custkey
LEFT JOIN 
    clickzetta_sample_data.tpch_100g.supplier s ON l.l_suppkey = s.s_suppkey
LIMIT 5;
```

![](.topwrite/assets/image_1736846565682.png)

```sql
-- 层级数据
SELECT 
    l.*, 
    struct(
        c.c_custkey,
        c.c_name,
        c.c_address,
        c.c_nationkey,
        c.c_phone,
        c.c_acctbal,
        c.c_mktsegment,
        c.c_comment,
        struct(
            n.n_nationkey,
            n.n_name,
            n.n_regionkey,
            n.n_comment
        ) 
    ) AS customer,
    struct(
        s.s_suppkey,
        s.s_name,
        s.s_address,
        s.s_nationkey,
        s.s_phone,
        s.s_acctbal,
        s.s_comment,
        struct(
            sn.n_nationkey,
            sn.n_name,
            sn.n_regionkey,
            sn.n_comment
        )
    ) AS supplier
FROM 
    clickzetta_sample_data.tpch_100g.lineitem l
LEFT JOIN 
    clickzetta_sample_data.tpch_100g.orders o ON l.l_orderkey = o.o_orderkey
LEFT JOIN 
    clickzetta_sample_data.tpch_100g.customer c ON o.o_custkey = c.c_custkey
LEFT JOIN
    clickzetta_sample_data.tpch_100g.nation n ON c.c_nationkey = n.n_nationkey
LEFT JOIN 
    clickzetta_sample_data.tpch_100g.supplier s ON l.l_suppkey = s.s_suppkey
LEFT JOIN
    clickzetta_sample_data.tpch_100g.nation sn ON s.s_nationkey = sn.n_nationkey
LIMIT 5;
```

:-: ![](.topwrite/assets/image_1736847057307.png =807)

```sql
--使用 ARRAY[STRUCT] 处理一对多关系
WITH line_items AS (
    SELECT 
        l_orderkey AS orderkey,
        array_agg(
            struct(
                l.l_linenumber,
                l.l_partkey,
                l.l_suppkey,
                l.l_quantity,
                l.l_extendedprice,
                l.l_discount,
                l.l_tax,
                l.l_returnflag,
                l.l_linestatus,
                l.l_shipdate,
                l.l_commitdate,
                l.l_receiptdate,
                l.l_shipinstruct,
                l.l_shipmode,
                l.l_comment
            )
        ) AS lineitems
    FROM 
        clickzetta_sample_data.tpch_100g.lineitem l 
    GROUP BY 
        l_orderkey
)
SELECT 
    o.*,
    size(l.lineitems) AS num_lineitems,
    l.lineitems
FROM 
    clickzetta_sample_data.tpch_100g.orders o
LEFT JOIN 
    line_items l ON o.o_orderkey = l.orderkey
LIMIT 5;
```

:-: ![](.topwrite/assets/image_1736847356858.png =701)

#### 在数据处理中使用嵌套数据类型

```sql
DROP TABLE IF EXISTS wide_orders;
```

```sql
CREATE TABLE IF NOT EXISTS wide_orders AS 
WITH line_items AS (
    SELECT 
        l_orderkey AS orderkey,
        array_agg(
            (
                l.l_linenumber AS lineitemkey,
                l.l_partkey AS partkey,
                l.l_suppkey AS suppkey,
                l.l_quantity AS quantity,
                l.l_extendedprice AS extendedprice,
                l.l_discount AS discount,
                l.l_tax AS tax,
                l.l_returnflag AS returnflag,
                l.l_linestatus AS linestatus,
                l.l_shipdate AS shipdate,
                l.l_commitdate AS commitdate,
                l.l_receiptdate AS receiptdate,
                l.l_shipinstruct AS shipinstruct,
                l.l_shipmode AS shipmode,
                l.l_comment AS comment
            )
        ) AS lineitems
    FROM 
        clickzetta_sample_data.tpch_100g.lineitem l 
    GROUP BY 
        l_orderkey
)
SELECT 
    o.*,
    l.lineitems,
    (
        c.c_custkey AS id,
        c.c_name AS name,
        c.c_address AS address,
        c.c_nationkey AS nationkey,
        c.c_phone AS phone,
        c.c_acctbal AS acctbal,
        c.c_mktsegment AS mktsegment,
        c.c_comment AS comment,
        (
            n.n_nationkey AS nationkey,
            n.n_name AS name,
            n.n_regionkey AS regionkey,
            n.n_comment AS comment
        ) AS nation
    ) AS customer
FROM 
    clickzetta_sample_data.tpch_100g.orders o
LEFT JOIN 
    line_items l ON o.o_orderkey = l.orderkey
LEFT JOIN 
    clickzetta_sample_data.tpch_100g.customer c ON o.o_custkey = c.c_custkey
LEFT JOIN
    clickzetta_sample_data.tpch_100g.nation n ON c.c_nationkey = n.n_nationkey;
```

STRUCT 使数据架构和数据访问更简单

```sql
SELECT    o_orderkey,
          customer.name,
          customer.address,
          lineitems[0] AS first_lineitem
FROM      wide_orders
LIMIT     2;
```

:-: ![](.topwrite/assets/image_1736848578892.png =728)

### 将 ARRAY 展开为行并重新组合为 ARRAY

```sql
-- 行转ARRAY
WITH lineitems AS (
    SELECT 
        o.o_orderkey,
        EXPLODE(o.lineitems) AS line_item
    FROM 
        wide_orders o
),
unnested_line_items AS (
    SELECT 
        o_orderkey,
        line_item.lineitemkey,
        line_item.partkey,
        line_item.quantity
    FROM 
        lineitems
)
SELECT 
    o_orderkey,
    array_agg(
        struct(
            lineitemkey,
            partkey,
            quantity
        )
    ) AS lineitems
FROM 
    unnested_line_items
GROUP BY 
    o_orderkey
LIMIT 
    5;
```

^

```sql
-- ARRAY 转行
WITH
  lineitems AS (
    SELECT
      o.o_orderkey,
      UNNEST (o.lineitems) 
    FROM
      wide_orders o
  )
SELECT
  o_orderkey,
  lineitemkey,
  partkey,
  quantity
FROM
  lineitems
LIMIT
  5;
```

:-: ![](.topwrite/assets/image_1736849377865.png =795)

```sql
-- 获取 lineitem 指标
WITH
  lineitems AS (
    SELECT
      o.o_orderkey,
      UNNEST (o.lineitems)
    FROM
      wide_orders o
  )
SELECT
  o_orderkey,
  COUNT(lineitemkey) AS num_line_items,
  SUM(quantity) AS total_line_item_quantity
FROM
  lineitems
GROUP BY
  1
ORDER BY
  1
LIMIT
  10;
```

:-: ![](.topwrite/assets/image_1736849575082.png =769)

### 确保性能符合预期

```sql
EXPLAIN
WITH
  lineitems AS (
    SELECT
      o.o_orderkey,
      UNNEST (o.lineitems)
    FROM
      wide_orders o
  )
SELECT
  o_orderkey,
  COUNT(lineitemkey) AS num_line_items,
  SUM(quantity) AS total_line_item_quantity
FROM
  lineitems
GROUP BY
  1
ORDER BY
  1
LIMIT
  10;
```

^

## 资料

使用嵌套结构时请关注查询执行性能，可以通过EXPLODE来查看执行计划是否符合预期。
[EXPLODE](sql_functions/table_functions/explode.md)

UNNEST

ARRAY\_AGG
