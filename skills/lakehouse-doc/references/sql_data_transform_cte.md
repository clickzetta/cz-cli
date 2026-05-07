# 通过CTE进行数据转换

让我们先了解一下使用Lakehouse SQL的[公用表表达式（Common Table Expression, CTE）](WITH.md)进行数据转换的基本概念、优势以及常见的使用场景。

## 基本概念

公用表表达式（CTE）是一种可以在SQL查询中定义临时结果集的表达式。该结果集在查询的执行过程中存在，通常用于简化复杂查询、递归查询或分解查询步骤。CTE通常由[WITH关键字](WITH.md)引入，并可以在随后的`SELECT`、`INSERT`、`UPDATE`和`DELETE`语句中使用。

基本语法：

```sql
WITH cte_name AS (
    SELECT column1, column2, ...
    FROM table_name
    WHERE condition
)
SELECT * FROM cte_name;
```

## 优势

1. **可读性高**：CTE可以使复杂查询更具可读性和可维护性。通过将复杂的查询逻辑拆解为多个可理解的部分，CTE增强了查询的结构化和清晰度。CTE 使测试复杂查询更简单

   * CTE 是一个可以在单个查询中重用的 `SELECT` 语句。
   * 复杂的 SQL 查询通常涉及多个子查询。多个子查询会使代码难以阅读。
   * 使用公共表表达式（CTE）可以使你的查询更易读。

2. **复用性强**：CTE可以在同一查询中多次引用，从而避免重复代码，提高查询的复用性。

3. **步骤化数据转换**：CTE可以将数据转换过程分步骤实现，每个步骤都可以定义为一个独立的CTE，这样便于调试和测试。

## 使用场景

以下是一些利用CTE进行数据转换的常见场景：

### 1. 数据清洗和转换

通过CTE可以分步骤清洗和转换数据，例如去除重复值、修正数据格式：

```sql
WITH cleaned_data AS (
    SELECT DISTINCT column1, column2
    FROM raw_table
    WHERE column1 IS NOT NULL
),
transformed_data AS (
    SELECT column1, UPPER(column2) AS transformed_column2
    FROM cleaned_data
)
SELECT * FROM transformed_data;
```

### 2. 分组和聚合

CTE可以用于进行复杂的分组和聚合操作，并在后续查询中引用聚合结果：

```sql
WITH total_sales AS (
    SELECT customer_id, SUM(order_amount) AS total_spent
    FROM orders
    GROUP BY customer_id
)
SELECT customer_id, total_spent
FROM total_sales
WHERE total_spent > 1000;
```

### 3. 数据合并和连接

使用CTE，可以简化多表连接和数据合并操作：

```sql
WITH customer_orders AS (
    SELECT c.customer_id, c.customer_name, o.order_id, o.order_date
    FROM customers c
    JOIN orders o ON c.customer_id = o.customer_id
)
SELECT *
FROM customer_orders
WHERE order_date > '2024-01-01';
```

## 数据模型

TPC-H 数据代表一个汽车零部件销售商的数据仓库，其中记录了订单、构成订单的项目（lineitem）、供应商、客户、销售的零部件（part）、地区、国家和零部件供应商（partsupp）。

云器Lakehouse内置了共享的TPC-H数据，每个用户可以通过加上数据上下文直接使用，比如：

```sql
SELECT * FROM 
clickzetta_sample_data.tpch_100g.customer
LIMIT 10;
```

## 通过云器Lakehouse SQL CTE进行数据转换

### 如何定义 CTE

```sql
-- CTE 定义
WITH
  supplier_nation_metrics AS ( -- 使用 WITH 关键字定义 CTE 1
    SELECT
      n.n_nationkey,
      SUM(l.l_QUANTITY) AS num_supplied_parts
    FROM
      clickzetta_sample_data.tpch_100g.lineitem l
      JOIN clickzetta_sample_data.tpch_100g.supplier s ON l.l_suppkey = s.s_suppkey
      JOIN clickzetta_sample_data.tpch_100g.nation n ON s.s_nationkey = n.n_nationkey
    GROUP BY
      n.n_nationkey
  ),
  buyer_nation_metrics AS ( -- 定义 CTE 2
    SELECT
      n.n_nationkey,
      SUM(l.l_QUANTITY) AS num_purchased_parts
    FROM
      clickzetta_sample_data.tpch_100g.lineitem l
      JOIN clickzetta_sample_data.tpch_100g.orders o ON l.l_orderkey = o.o_orderkey
      JOIN clickzetta_sample_data.tpch_100g.customer c ON o.o_custkey = c.c_custkey
      JOIN clickzetta_sample_data.tpch_100g.nation n ON c.c_nationkey = n.n_nationkey
    GROUP BY
      n.n_nationkey
  )
SELECT -- 最终的 SELECT 语句前不需要逗号
  n.n_name AS nation_name,
  s.num_supplied_parts,
  b.num_purchased_parts
FROM
  clickzetta_sample_data.tpch_100g.nation n
  LEFT JOIN supplier_nation_metrics s ON n.n_nationkey = s.n_nationkey
  LEFT JOIN buyer_nation_metrics b ON n.n_nationkey = b.n_nationkey
LIMIT 10;
```

### 计算因折扣而损失的金额

使用 `lineitem` 表获取订单中项目的价格（不含折扣），并与订单进行比较。先确定比较需要进行的粒度。分步骤思考，即先获取订单中所有项目的不含折扣的价格，然后将其与已计算折扣的 `totalprice` 的订单数据进行比较。

```sql
WITH lineitem_agg AS (
    SELECT 
        l_orderkey,
        SUM(l_extendedprice) AS total_price_without_discount
    FROM 
        clickzetta_sample_data.tpch_100g.lineitem
    GROUP BY 
        l_orderkey
)
SELECT 
    o.o_orderkey,
    o.o_totalprice, 
    l.total_price_without_discount - o.o_totalprice AS amount_lost_to_discount
FROM 
    clickzetta_sample_data.tpch_100g.orders o
JOIN 
    lineitem_agg l ON o.o_orderkey = l.l_orderkey
ORDER BY 
    o.o_orderkey;
```

### 不要过度使用 CTE。注意代码的可读性。

1. CTE 可以帮助提高查询的可读性和可重用性。

2. 不要过度使用 CTE；注意查询的大小。

   * 多个临时表的 SQL 查询比带有众多 CTE 的 1000 行 SQL 查询更好。
   * 保持每个查询中的 CTE 数量较小（取决于查询的大小，但通常 < 5）。

3. 如果对CTE 的性有疑问，请检查你的查询计划。

## 资料

[公用表表达式（Common Table Expression, CTE）](WITH.md)

^
