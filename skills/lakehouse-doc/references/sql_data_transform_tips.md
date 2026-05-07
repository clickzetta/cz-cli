# 通过SQL进行数据转换的一些提示

## 数据模型

TPC-H 数据代表一个汽车零部件销售商的数据仓库，其中记录了订单、构成订单的项目（lineitem）、供应商、客户、销售的零部件（part）、地区、国家和零部件供应商（partsupp）。

云器Lakehouse内置了共享的TPC-H数据，每个用户可以通过加上数据上下文直接使用，比如：

```sql
SELECT * FROM 
clickzetta_sample_data.tpch_100g.customer
LIMIT 10;
```

## 前提条件

1. [基础](sql_data_transform_basic.md)
2. [公共表表达式 (CTE)](sql_data_transform_cte.md)
3. [窗口函数](sql_data_transform_windows.md)
4. [嵌套数据类型](sql_data_transfom_NestedDataTypes.md)

## 1. 常见数据处理场景的实用函数

### 1.1. 需要分区中的第一/最后一行时使用 ROW\_NUMBER

```sql
SELECT 
    o_custkey, 
    o_orderdate, 
    o_totalprice
FROM (
    SELECT 
        o_custkey, 
        o_orderdate, 
        o_totalprice,
        ROW_NUMBER() OVER (PARTITION BY o_custkey ORDER BY o_orderdate DESC) AS rn
    FROM clickzetta_sample_data.tpch_100g.orders
) t
WHERE rn = 1;
```

### 1.2. STRUCT 数据类型按其键从左到右排序

```sql
WITH order_struct AS (
    SELECT 
        o_orderkey,
        struct(o_orderdate, o_totalprice, o_orderkey) AS order_info
    FROM clickzetta_sample_data.tpch_100g.orders
)
SELECT 
    MIN(order_info) AS min_order_date,
    MAX(order_info) AS max_order_date_price
FROM order_struct;
```

### 1.3. 使用 BOOL\_OR 和 BOOL\_AND 分别检查至少一个或所有布尔值是否为真

```sql
SELECT 
    o_custkey, 
    BOOL_OR(o_shippriority > 0) AS has_atleast_one_priority_order,
    BOOL_AND(o_shippriority > 0) AS has_all_priority_order
FROM clickzetta_sample_data.tpch_100g.orders
GROUP BY o_custkey;
```

### 1.4. 想要选择除少数列之外的所有列时使用 EXCEPT

```sql
SELECT * EXCEPT(o_orderdate, o_totalprice)
FROM clickzetta_sample_data.tpch_100g.orders;
```

### 1.5. 厌倦了在 GROUP BY 中创建长长的列列表时使用 GROUP BY ALL

```sql
SELECT 
    o_orderkey, 
    o_custkey, 
    o_orderstatus, 
    SUM(o_totalprice) AS total_price
FROM clickzetta_sample_data.tpch_100g.orders
GROUP BY ALL;
```

### 1.6. ORDER、GROUP字段用SELECT字段的序号代替

```sql
SELECT 
    o_orderkey, 
    o_custkey, 
    o_orderstatus, 
    SUM(o_totalprice) AS total_price
FROM clickzetta_sample_data.tpch_100g.orders
GROUP BY 1,2,3
ORDER BY 3,2,1;
```

### 1.7. 需要仅在满足特定条件时计数行时使用 COUNT IF

```sql
SELECT 
    o_custkey, 
    COUNT_IF(o_totalprice > 100000) AS high_value_orders,
    COUNT(o_totalprice) as all_orders
FROM clickzetta_sample_data.tpch_100g.orders
GROUP BY o_custkey;
```

### 1.8. 使用 COALESCE 处理空列值与其他列或回退值

```sql
WITH fake_orders AS (
    SELECT 1 AS o_orderkey, 100 AS o_totalprice, NULL AS discount
    UNION ALL
    SELECT 2 AS o_orderkey, 200 AS o_totalprice, 20 AS discount
    UNION ALL
    SELECT 3 AS o_orderkey, 300 AS o_totalprice, NULL AS discount
)
SELECT 
    o_orderkey, 
    o_totalprice, 
    discount,
    COALESCE(discount, o_totalprice * 0.10) AS final_discount
FROM fake_orders;
```

### 1.9. 使用 sequence和explode 生成数字/日期行范围

```sql
SELECT explode(sequence(1, 10)) AS num;
```

^

```sql
SELECT    EXPLODE (
          sequence(
          to_date('2024-01-01'),
          to_date('2024-01-10'),
          interval 1 DAY
          )
          ) AS date;
```

### 1.10. 使用 UNNEST 将 ARRAY/LIST 元素转换为单独的行

```sql
WITH nested_data AS (
    SELECT 1 AS id, array(10, 20, 30) AS values
    UNION ALL
    SELECT 2 AS id, array(40, 50) AS values
)
SELECT 
    id, 
    unnest(values) AS flattened_value
FROM nested_data;
```

## 2. 另一个表中的存在/不存在的数据获取

### 2.1. 根据另一个表中的数据存在性获取表中的数据时使用 EXISTS

```sql
SELECT 
    c_custkey, 
    c_name
FROM clickzetta_sample_data.tpch_100g.customer c
WHERE EXISTS (
    SELECT o_orderkey
    FROM clickzetta_sample_data.tpch_100g.orders o
    WHERE o.o_custkey = c.c_custkey AND o.o_totalprice > 1000
);
```

### 2.2. 获取两个表中都存在的数据时使用 INTERSECT

```sql
SELECT    c_custkey
FROM      clickzetta_sample_data.tpch_100g.customer
INTERSECT
SELECT    o_custkey
FROM      clickzetta_sample_data.tpch_100g.orders;
```

### 2.3. 获取表 1 中存在但表 2 中不存在的数据时使用 EXCEPT

```sql
SELECT c_custkey
FROM clickzetta_sample_data.tpch_100g.customer
EXCEPT
SELECT o_custkey
FROM clickzetta_sample_data.tpch_100g.orders;
```

### 2.4. 获取数据差异（即 delta），使用 (A - B) U (B - A)

```sql
SELECT c_custkey, 'DELETED' as ops FROM ( 
SELECT c_custkey
FROM clickzetta_sample_data.tpch_100g.customer
EXCEPT
SELECT c_custkey
FROM clickzetta_sample_data.tpch_100g.customer
)

UNION ALL

SELECT c_custkey, 'UPSERTED' as ops FROM ( 
SELECT c_custkey, c_name, c_address
FROM clickzetta_sample_data.tpch_100g.customer
EXCEPT
SELECT c_custkey, c_name, c_address
FROM clickzetta_sample_data.tpch_100g.customer
);
```

## 3. 在 SQL 中CASE 语句

### 3.1. 使用 CASE 语句

```sql
SELECT 
    o_orderkey, 
    o_totalprice,
    CASE
        WHEN o_totalprice > 100000 THEN 'Large Order'
        ELSE 'Regular Order'
    END AS order_type
FROM clickzetta_sample_data.tpch_100g.orders
LIMIT 5;
```

## 4. 访问关于数据的元数据

### 4.1. 访问在 information\_schema 中存储的元数据

```sql
-- 查看表的信息
DESCRIBE TABLE clickzetta_sample_data.tpch_100g.orders;
```

```sql
-- 查看所有表
SHOW TABLES IN clickzetta_sample_data.tpch_100g;
```

^

## 5. 使用 UPSERTS（即 MERGE INTO）避免数据重复

### 5.1. 使用 UPSERT/MERGE INTO 插入新数据，更新现有数据

```sql
MERGE INTO dim_customer_scd2 AS target
USING (
    VALUES
        (1, 'Customer#000000001', 'New Address 1', 15, '25-989-741-2988', 711.56, 'BUILDING', 'comment1', '2024-10-18', NULL, TRUE),
        (2, 'Customer#000000002', 'New Address 2', 18, '12-423-790-3665', 879.49, 'FURNITURE', 'comment2', '2024-10-18', NULL, TRUE),
        (1501, 'Customer#000001501', 'New Address 1501', 24, '11-345-678-9012', 500.50, 'MACHINERY', 'comment1501', '2024-10-18', NULL, TRUE),
        (1502, 'Customer#000001502', 'New Address 1502', 21, '22-456-789-0123', 600.75, 'AUTOMOBILE', 'comment1502', '2024-10-18', NULL, TRUE)
) AS source (c_custkey, c_name, c_address, c_nationkey, c_phone, c_acctbal, c_mktsegment, c_comment, valid_from, valid_to, is_current)
ON target.c_custkey = source.c_custkey
WHEN MATCHED AND target.is_current = TRUE THEN
    UPDATE SET valid_to = source.valid_from, is_current = FALSE
WHEN NOT MATCHED THEN
    INSERT (c_custkey, c_name, c_address, c_nationkey, c_phone, c_acctbal, c_mktsegment, c_comment, valid_from, valid_to, is_current)
    VALUES (source.c_custkey, source.c_name, source.c_address, source.c_nationkey, source.c_phone, source.c_acctbal, source.c_mktsegment, source.c_comment, source.valid_from, source.valid_to, source.is_current);
```

## 6. 高级 JOIN 类型

### 6.1. 使用JOIN和ROW\_NUMBER获取表 2 中与表 1 行时间最接近的值

```sql
WITH stock_prices_data AS (
    SELECT 'APPL' AS ticker, to_timestamp('2001-01-01 00:00:00') AS ts, 1 AS price
    UNION ALL
    SELECT 'APPL', to_timestamp('2001-01-01 00:01:00'), 2
    UNION ALL
    SELECT 'APPL', to_timestamp('2001-01-01 00:02:00'), 3
    UNION ALL
    SELECT 'MSFT', to_timestamp('2001-01-01 00:00:00'), 1
    UNION ALL
    SELECT 'MSFT', to_timestamp('2001-01-01 00:01:00'), 2
    UNION ALL
    SELECT 'MSFT', to_timestamp('2001-01-01 00:02:00'), 3
    UNION ALL
    SELECT 'GOOG', to_timestamp('2001-01-01 00:00:00'), 1
    UNION ALL
    SELECT 'GOOG', to_timestamp('2001-01-01 00:01:00'), 2
    UNION ALL
    SELECT 'GOOG', to_timestamp('2001-01-01 00:02:00'), 3
),
portfolio_holdings_data AS (
    SELECT 'APPL' AS ticker, to_timestamp('2000-12-31 23:59:30') AS ts, 5.16 AS shares
    UNION ALL
    SELECT 'APPL', to_timestamp('2001-01-01 00:00:30'), 2.94
    UNION ALL
    SELECT 'APPL', to_timestamp('2001-01-01 00:01:30'), 24.13
    UNION ALL
    SELECT 'GOOG', to_timestamp('2000-12-31 23:59:30'), 9.33
    UNION ALL
    SELECT 'GOOG', to_timestamp('2001-01-01 00:00:30'), 23.45
    UNION ALL
    SELECT 'GOOG', to_timestamp('2001-01-01 00:01:30'), 10.58
    UNION ALL
    SELECT 'DATA', to_timestamp('2000-12-31 23:59:30'), 6.65
    UNION ALL
    SELECT 'DATA', to_timestamp('2001-01-01 00:00:30'), 17.95
    UNION ALL
    SELECT 'DATA', to_timestamp('2001-01-01 00:01:30'), 18.37
)
SELECT h.ticker,
    h.ts AS holdings_ts,
    p.ts AS stock_price_ts,
    p.price,
    h.shares,
    p.price * h.shares AS value
FROM portfolio_holdings_data h
JOIN (
    SELECT 
        ticker, 
        ts, 
        price,
        ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY ts DESC) AS rn
    FROM stock_prices_data
) p
ON h.ticker = p.ticker AND h.ts >= p.ts
WHERE p.rn = 1
ORDER BY h.ticker, h.ts;
```

### 6.2. 使用 ANTI JOIN 获取表 1 中存在但表 2 中不存在的行

```sql
SELECT    c.c_custkey
FROM      clickzetta_sample_data.tpch_100g.customer c
LEFT      ANTI JOIN clickzetta_sample_data.tpch_100g.orders o ON c.c_custkey = o.o_custkey
ORDER BY  c.c_custkey
LIMIT     5;
```

### 6.3. 使用 LATERAL JOIN 对表 1 中的每一行连接表 2 中的所有“匹配”行

```sql
SELECT    o.o_orderkey,
          o.o_totalprice,
          l.l_linenumber,
          l.l_extendedprice
FROM      clickzetta_sample_data.tpch_100g.orders o
CROSS     JOIN clickzetta_sample_data.tpch_100g.lineitem l
WHERE     l.l_orderkey = o.o_orderkey AND      
          l.l_linenumber <= 2 AND      
          l.l_extendedprice < (o.o_totalprice / 2)
ORDER BY  o.o_orderkey,
          l.l_linenumber;
```

## 7 业务用例

### 7.1. 使用 CASE和 `GROUP BY `将维度值转换为单独的列

```sql
SELECT    o_custkey,
          SUM(
          CASE
                    WHEN o_orderstatus = 'F' THEN o_totalprice
                    ELSE 0
          END
          ) AS fulfilled_total,
          SUM(
          CASE
                    WHEN o_orderstatus = 'O' THEN o_totalprice
                    ELSE 0
          END
          ) AS open_total,
          SUM(
          CASE
                    WHEN o_orderstatus = 'P' THEN o_totalprice
                    ELSE 0
          END
          ) AS pending_total
FROM      clickzetta_sample_data.tpch_100g.orders
GROUP BY  o_custkey
ORDER BY  o_custkey;
```

### 7.2. 使用 CUBE 生成每个可能维度组合的指标

```sql
SELECT    o_orderpriority,
          o_orderstatus,
          EXTRACT(
          YEAR
          FROM      o_orderdate
          ) AS order_year,
          SUM(o_totalprice) AS total_sales
FROM      clickzetta_sample_data.tpch_100g.orders
GROUP BY  CUBE (o_orderpriority, o_orderstatus, order_year)
ORDER BY  1,
          2,
          3;
```

^
