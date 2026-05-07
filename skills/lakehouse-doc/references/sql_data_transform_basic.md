^

# SQL数据转换基础

SQL数据转换（Data Transformation in SQL）是将数据从一种格式或结构转换为另一种格式或结构的过程。目的是清洗、整合和整形数据，以便其能被有效地存储、分析和利用。

## 基本概念

1. **抽取（Extract**）：从各种数据源（如数据库、文件系统）中提取数据。常见的操作包括数据查询和数据导出。
2. **转换（Transform**）：对提取的数据进行各种操作以满足目标存储或分析的需求。常见的转换操作包括数据清洗、类型转换、数据聚合等。
3. **加载（Load**）：将转换后的数据加载到目标存储系统，如数据仓库或数据湖中。

## 常见的数据转换操作

1. **数据清洗**：删除或修正数据中的噪声、重复和错误信息。例如：
   * 删除空值：`DELETE FROM table_name WHERE column_name IS NULL;`
   * 修正错误数据：`UPDATE table_name SET column_name = 'Correct Value' WHERE column_name = 'Incorrect Value';`

2. **类型转换**：将数据从一种数据类型转换为另一种。例如：
   * 将字符串转换为日期：`CAST(column_name AS DATE);`
   * 将整数转换为字符串：`CAST(column_name AS STRING);`

3. **数据聚合**：对数据进行汇总和统计，例如求和、平均值、计数等。例如：
   * 计算总和：`SELECT SUM(column_name) FROM table_name;`
   * 计算平均值：`SELECT AVG(column_name) FROM table_name;`

4. **数据合并**：将来自不同表或数据源的数据进行合并。例如：
   * 使用连接操作合并数据：`SELECT a.*, b.* FROM table_a a JOIN table_b b ON a.id = b.id;`
   * 使用联合操作合并数据：`SELECT column_name FROM table_a UNION SELECT column_name FROM table_b;`

5. **数据过滤**：选择符合条件的数据。例如：
   * 获取特定条件的数据：`SELECT * FROM table_name WHERE column_name = 'value';`

## 数据模型

TPC-H 数据代表一个汽车零部件销售商的数据仓库，其中记录了订单、构成订单的项目（lineitem）、供应商、客户、销售的零部件（part）、地区、国家和零部件供应商（partsupp）。

云器Lakehouse内置了共享的TPC-H数据，每个用户可以通过加上数据上下文直接使用，比如：

```sql
SELECT * FROM 
clickzetta_sample_data.tpch_100g.customer
LIMIT 10;
```

## 使用场景

1. **数据仓库构建**：在构建数据仓库时，需将数据从不同数据源提取、转换并加载到数据仓库中，确保数据的一致性和高质量。
2. **商业智能和数据分析**：为了进行商业智能（BI）和数据分析，需对原始数据进行转换，以便分析工具能够高效地解析和展示数据。
3. **数据迁移**：在数据迁移过程中，需要对数据进行转换，以保证从旧系统到新系统的数据结构和质量一致。
4. **合规性和数据治理**：确保数据符合行业标准和法规要求，常常需要对数据进行清洗和转换。
5. **实时数据处理**：在实时数据处理和流数据处理中，对数据进行转换，以便实时分析和决策支持。

SQL数据转换是数据处理中的一个核心环节，能够帮助企业提升数据质量和利用效率，从而支持更好的决策和业务运营。

## 通过云器Lakehouse SQL 进行基本的数据转换

### 获取数据

使用 SELECT...FROM, LIMIT, WHERE, & ORDER BY 从表中读取所需数据。

查询的最常见用途是从表中读取数据。我们可以使用 `SELECT ... FROM` 语句，如下所示。

```sql
SELECT
  *
FROM
  clickzetta_sample_data.tpch_100g.customer
LIMIT
  1;
```

^

```sql
-- 使用 * 来指定所有列
SELECT
  *
FROM
  clickzetta_sample_data.tpch_100g.orders
LIMIT
  5;
```

然而，运行 `SELECT ... FROM` 语句可能会在数据集很大时会出现问题。

```sql
-- 只使用列名来读取这些列的数据
SELECT
  o_orderkey,
  o_totalprice
FROM
  clickzetta_sample_data.tpch_100g.orders
LIMIT
  5;
```

如果我们想获取符合特定条件的行，可以使用 `WHERE` 子句。我们可以在 `WHERE` 子句中指定一个或多个过滤条件。

`WHERE` 子句可以使用 `AND` 和 `OR` 条件组合多个过滤条件，如下所示。

```sql
-- 所有 c_nationkey = 20 的客户行
SELECT
  *
FROM
  clickzetta_sample_data.tpch_100g.customer
WHERE
  c_nationkey = 20
LIMIT
  10;
```

^

```sql
-- 所有 c_nationkey = 20 且 c_acctbal > 1000 的客户行
SELECT
  *
FROM
  clickzetta_sample_data.tpch_100g.customer
WHERE
  c_nationkey = 20
  AND c_acctbal > 1000
LIMIT
  10;
```

```sql
-- 所有 c_nationkey = 20 或 c_acctbal > 1000 的客户行
SELECT
  *
FROM
  clickzetta_sample_data.tpch_100g.customer
WHERE
  c_nationkey = 20
  OR c_acctbal > 1000
LIMIT
  10;
```

```sql
-- 所有 (c_nationkey = 20 且 c_acctbal > 1000) 或 c_nationkey = 11 的客户行
SELECT
  *
FROM
  clickzetta_sample_data.tpch_100g.customer
WHERE
  (
    c_nationkey = 20
    AND c_acctbal > 1000
  )
  OR c_nationkey = 11
LIMIT
  10;
```

我们可以组合多个过滤条件，如上所示。我们已经看到了等于 (`=`) 和大于 (`>`) 条件运算符。共有 6 个 **条件运算符**，它们是：

1. < 小于
2. \> 大于
3. <= 小于或等于
4. \>= 大于或等于
5. \= 等于
6. <> 和 != 都表示不等于（某些数据库只支持其中一个）

此外，对于字符串类型，我们可以使用 `like` 条件进行 **模式匹配**。在 `like` 条件中，`_` 表示任意单个字符，`%` 表示零个或多个字符，例如。

```sql
-- 所有 c_name 包含 381 的客户行
SELECT
  *
FROM
  clickzetta_sample_data.tpch_100g.customer
WHERE
  c_name LIKE '%381%';
```

^

```sql
-- 所有 c_name 包含任意字符、9 和 1 的客户行
SELECT
  *
FROM
  clickzetta_sample_data.tpch_100g.customer
WHERE
  c_name LIKE '%_91%';
```

我们还可以使用 `IN` 和 `NOT IN` 来过滤多个值。

^

```sql
-- 所有 c_nationkey = 10 或 c_nationkey = 20 的客户行
SELECT
  *
FROM
  clickzetta_sample_data.tpch_100g.customer
WHERE
  c_nationkey IN (10, 20);
```

可以使用 `count(*)` 来获取表中的行数，如下所示。

^

```sql
SELECT
  COUNT(*)
FROM
  clickzetta_sample_data.tpch_100g.lineitem;
```

^

```sql
SELECT  COUNT(*)FROM  clickzetta_sample_data.tpch_100g.lineitem;
```

如果我们想按特定列的值对行进行排序，可以使用 `ORDER BY`，例如。

^

```sql
-- 显示 custkey 最小的前十个客户记录
-- 行默认按升序排序
SELECT
  *
FROM
  clickzetta_sample_data.tpch_100g.orders
ORDER BY
  o_custkey
LIMIT
  10;
```

### 连接Join

使用 JOINs 结合多个表的数据（有不同类型的 JOINs）。

我们可以使用连接来结合多个表的数据。编写连接查询时，格式如下所示。

^

```sql
-- 基于非真实表
SELECT
    a.*
FROM
    table_a a -- 左表 a
    JOIN table_b b -- 右表 b
    ON a.id = b.id
```

首先指定的表（table\_a）是左表，而第二个指定的表是右表。当有多个表连接时，我们将前两个表的连接数据集视为左表，第三个表视为右表（数据库会优化连接以提高性能）。

^

```sql
-- 基于非真实表
SELECT
    a.*
FROM
    table_a a -- 左表 a
    JOIN table_b b -- 右表 b
    ON a.id = b.id
    JOIN table_c c -- 左表是 table_a 和 table_b 的连接数据，右表是 table_c
    ON a.c_id = c.id
```

主要有五种连接类型，它们是：

#### 1. 内连接（默认）：仅获取两个表中都存在的行

^

```sql
SELECT
  o.o_orderkey,
  l.l_orderkey
FROM
  clickzetta_sample_data.tpch_100g.orders o
  JOIN clickzetta_sample_data.tpch_100g.lineitem l ON o.o_orderkey = l.l_orderkey
  AND o.o_orderdate BETWEEN l.l_shipdate - INTERVAL '5' DAY AND l.l_shipdate  + INTERVAL '5' DAY
LIMIT
  100;
```

^

```sql
SELECT
  COUNT(o.o_orderkey) AS order_rows_count,
  COUNT(l.l_orderkey) AS lineitem_rows_count
FROM
  clickzetta_sample_data.tpch_100g.orders o
  JOIN clickzetta_sample_data.tpch_100g.lineitem l ON o.o_orderkey = l.l_orderkey
  AND o.o_orderdate BETWEEN l.l_shipdate - INTERVAL '5' DAY AND l.l_shipdate  + INTERVAL '5' DAY;
```

**注意**：连接默认为内连接。

输出将包含订单和行项目中至少找到一个匹配行的记录（相同的 o\_orderkey 且订单日期在发货日期前后 5 天内）。

我们还可以看到订单和行项目表中有24792743行匹配。

#### 2. 左外连接（又称左连接）：获取左表的所有行和右表的匹配行

```sql
SELECT
  o.o_orderkey,
  l.l_orderkey
FROM
  clickzetta_sample_data.tpch_100g.orders o
  LEFT JOIN clickzetta_sample_data.tpch_100g.lineitem l ON o.o_orderkey = l.l_orderkey
  AND o.o_orderdate BETWEEN l.l_shipdate - INTERVAL '5' DAY AND l.l_shipdate  + INTERVAL '5' DAY
LIMIT
  100;
```

^

```sql
SELECT
  COUNT(o.o_orderkey) AS order_rows_count,
  COUNT(l.l_orderkey) AS lineitem_rows_count
FROM
  clickzetta_sample_data.tpch_100g.orders o
  LEFT JOIN clickzetta_sample_data.tpch_100g.lineitem l ON o.o_orderkey = l.l_orderkey
  AND o.o_orderdate BETWEEN l.l_shipdate - INTERVAL '5' DAY AND l.l_shipdate  + INTERVAL '5' DAY;
```

输出将包含订单表的所有行和行项目表中至少找到一个匹配行的记录（相同的 o\_orderkey 且订单日期在发货日期前后 5 天内）。

我们还可以看到订单表有 151947677 行，行项目表有24792743 行。订单表的行数为 1,500,000，但由于连接条件，产生了 151947677 行，因为一些订单与多个行项目匹配。

#### 3. 右外连接（又称右连接）：获取左表的匹配行和右表的所有行

```sql
SELECT
  o.o_orderkey,
  l.l_orderkey
FROM
  clickzetta_sample_data.tpch_100g.orders o
  RIGHT JOIN clickzetta_sample_data.tpch_100g.lineitem l ON o.o_orderkey = l.l_orderkey
  AND o.o_orderdate BETWEEN l.l_shipdate - INTERVAL '5' DAY AND l.l_shipdate  + INTERVAL '5' DAY
LIMIT
  100;
```

^

```sql
SELECT
  COUNT(o.o_orderkey) AS order_rows_count,
  COUNT(l.l_orderkey) AS lineitem_rows_count
FROM
  clickzetta_sample_data.tpch_100g.orders o
  RIGHT JOIN clickzetta_sample_data.tpch_100g.lineitem l ON o.o_orderkey = l.l_orderkey
  AND o.o_orderdate BETWEEN l.l_shipdate - INTERVAL '5' DAY AND l.l_shipdate  + INTERVAL '5' DAY;
```

输出将包含订单表中至少找到一个匹配行的记录（相同的 o\_orderkey 且订单日期在发货日期前后 5 天内）和行项目表的所有行。

我们还可以看到订单表有 24792743 行，行项目表有 600037902 行。

#### 4. 全外连接：获取左表和右表的所有行

```sql
SELECT
  o.o_orderkey,
  l.l_orderkey
FROM
  clickzetta_sample_data.tpch_100g.orders o
  FULL OUTER JOIN clickzetta_sample_data.tpch_100g.lineitem l ON o.o_orderkey = l.l_orderkey
  AND o.o_orderdate BETWEEN l.l_shipdate - INTERVAL '5' DAY AND l.l_shipdate  + INTERVAL '5' DAY
LIMIT
  100;
```

^

```sql
SELECT
  COUNT(o.o_orderkey) AS order_rows_count,
  COUNT(l.l_orderkey) AS lineitem_rows_count
FROM
  clickzetta_sample_data.tpch_100g.orders o
  FULL OUTER JOIN clickzetta_sample_data.tpch_100g.lineitem l ON o.o_orderkey = l.l_orderkey
  AND o.o_orderdate BETWEEN l.l_shipdate - INTERVAL '5' DAY AND l.l_shipdate  + INTERVAL '5' DAY;
```

输出将包含订单表中至少找到一个匹配行的记录（相同的 o\_orderkey 且订单日期在发货日期前后 5 天内）和行项目表的所有行。

我们还可以看到订单表有 151947677 行，行项目表有 600037902 行。

#### 5. 交叉连接：获取所有行的笛卡尔积

```sql
SELECT
  n.n_name AS nation_c_name,
  r.r_name AS region_c_name
FROM
  clickzetta_sample_data.tpch_100g.nation n
  CROSS JOIN clickzetta_sample_data.tpch_100g.region r;
```

输出将包含国家表的每一行与地区表的每一行的连接。共有 25 个国家和 5 个地区，因此交叉连接的结果有 125 行。

^

有时我们需要将表与自身连接，称为自连接。

**示例**：

1. 对于每个客户订单，获取同一周（周日 - 周六，不是前七天）内较早放置的订单。仅显示至少有一个此类订单的客户订单。

```sql
SELECT
  o1.o_custkey
FROM
  clickzetta_sample_data.tpch_100g.orders o1
  JOIN clickzetta_sample_data.tpch_100g.orders o2 ON o1.o_custkey = o2.o_custkey
  AND YEAR (o1.o_orderdate) = YEAR (o2.o_orderdate)
  AND week (o1.o_orderdate) = week (o2.o_orderdate)
WHERE
  o1.o_orderkey != o2.o_orderkey;
```

大多数分析查询需要计算涉及多个行的数据指标。`GROUP BY` 允许我们对基于指定列值分组的行集进行聚合计算。

**示例**：

1. 创建一个报告，显示每个订单优先级段的订单数量。

```sql
SELECT
  o_orderpriority,
  COUNT(*) AS num_orders
FROM
  clickzetta_sample_data.tpch_100g.orders
GROUP BY
  o_orderpriority;
```

在上述查询中，我们按 `orderpriority` 分组，`count(*)` 计算将应用于具有特定 `orderpriority` 值的行。输出将包含每个唯一 `orderpriority` 值的一行和 `count(*)` 计算。

^

允许的计算通常是 SUM/MIN/MAX/AVG/COUNT。然而，某些数据库有更复杂的聚合函数；请查阅您的数据库文档。

### 子查询

使用子查询在查询中使用查询结果。

当我们想将一个查询的结果作为另一个查询的表时，我们使用子查询。**示例**：

1. 创建一个报告，显示国家、该国供应的项目数量（由该国的供应商供应）以及该国购买的项目数量（由该国的客户购买）。

```sql
SELECT
  n.n_name AS nation_c_name,
  s.quantity AS supplied_items_quantity,
  c.quantity AS purchased_items_quantity
FROM
  clickzetta_sample_data.tpch_100g.nation n
  LEFT JOIN (
    SELECT
      n.n_nationkey,
      SUM(l.l_quantity) AS quantity
    FROM
      clickzetta_sample_data.tpch_100g.lineitem l
      JOIN clickzetta_sample_data.tpch_100g.supplier s ON l.l_suppkey = s.s_suppkey
      JOIN clickzetta_sample_data.tpch_100g.nation n ON s.s_nationkey = n.n_nationkey
    GROUP BY
      n.n_nationkey
  ) s ON n.n_nationkey = s.n_nationkey
  LEFT JOIN (
    SELECT
      n.n_nationkey,
      SUM(l.l_quantity) AS quantity
    FROM
      clickzetta_sample_data.tpch_100g.lineitem l
      JOIN clickzetta_sample_data.tpch_100g.orders o ON l.l_orderkey = o.o_orderkey
      JOIN clickzetta_sample_data.tpch_100g.customer c ON o.o_custkey = c.c_custkey
      JOIN clickzetta_sample_data.tpch_100g.nation n ON c.c_nationkey = n.n_nationkey
    GROUP BY
      n.n_nationkey
  ) c ON n.n_nationkey = c.n_nationkey;
```

在上述查询中，我们可以看到有两个子查询，一个用于计算一个国家供应的项目数量，另一个用于计算该国客户购买的项目数量。

### CASE WHEN&#x20;

使用 CASE 语句复制 IF.ELSE 逻辑。

我们可以在查询的 `SELECT ... FROM` 部分进行条件逻辑，如下所示。

```sql
SELECT
    o_orderkey,
    o_totalprice,
    CASE
        WHEN o_totalprice > 100000 THEN 'high'
        WHEN o_totalprice BETWEEN 25000
        AND 100000 THEN 'medium'
        ELSE 'low'
    END AS order_price_bucket
FROM
    clickzetta_sample_data.tpch_100g.orders;
```

我们可以看到如何根据 `totalprice` 列显示不同的值。我们还可以使用多个条件作为我们的条件标准（例如，totalprice > 100000 AND orderpriority = '2-HIGH'）。

### 标准函数

使用标准内置数据库函数进行常见的字符串、时间和数字数据操作。

在处理数据时，我们通常需要更改列中的值；以下是一些需要了解的标准函数：

1. **字符串函数**

   1. **LENGTH** 用于计算字符串的长度。例如，`SELECT LENGTH('hi');` 将输出 2。
   2. **CONCAT** 将多个字符串列合并为一个。例如，`SELECT CONCAT(o_orderstatus, '-', o_orderpriority) FROM clickzetta_sample_data.tpch_100g.orders LIMIT 5;` 将连接 o\_orderstatus 和 o\_orderpriority 列，中间用短横线分隔。
   3. **SPLIT** 用于根据给定的分隔符将值拆分为数组。例如，`SELECT STRING_SPLIT(o_orderpriority, '-') FROM clickzetta_sample_data.tpch_100g.orders LIMIT 5;` 将输出一个列，其中的数组是通过在 `-` 处拆分 o\_orderpriority 值形成的。
   4. **SUBSTRING** 用于从值中获取子字符串，给定起始和结束字符索引。例如，`SELECT o_orderpriority, SUBSTRING(o_orderpriority, 1, 5) FROM clickzetta_sample_data.tpch_100g.orders LIMIT 5;` 将获取 o\_orderpriority 列的前五个（1 - 5）字符。
   5. **TRIM** 用于删除值左右两侧的空格。例如，`SELECT TRIM(' hi ');` 将输出 `hi`，周围没有空格。LTRIM 和 RTRIM 类似，但分别只删除字符串前后的空格。

2. **日期和时间函数**

   1. **添加和减去日期**：用于添加和减去时间段；格式在很大程度上取决于数据库。在 Lakehouse 中，`datediff` 接受 3 个参数，输出单位（天、月、年），日期/时间值 a 和 b，使得输出为 a - b。`+ INTERVAL n UNIT(DAY/MONTH/YEAR)` 将指定单位的值添加到时间戳值中。

      ```sql
        -- 日期和时间函数
        SELECT
            datediff(day, DATE '2022-10-01', DATE '2023-11-05') AS diff_in_days,
            datediff(month, DATE '2022-10-01', DATE '2023-11-05') AS diff_in_months,
            datediff(year, DATE '2022-10-01', DATE '2023-11-05') AS diff_in_years,
            DATE '2022-10-01' + INTERVAL 400 DAY AS new_date;
      ```

   它将显示两个日期之间指定时间段的差异。我们还可以从日期/时间列中添加/减去任意时间段。例如，`SELECT DATE '2022-11-05' + INTERVAL '10' DAY;` 将显示输出 `2022-11-15`（尝试日期减法）。

   ^

3. **字符串 <=> 日期/时间转换**

当我们想将字符串的数据类型更改为日期/时间时，我们可以使用 `DATE 'YYYY-MM-DD'` 或 `TIMESTAMP 'YYYY-MM-DD HH:mm:SS'` 函数。但如果数据是非标准日期/时间格式，如 `MM/DD/YYYY`，我们需要指定输入结构；我们使用 `date\_format` 来实现这一点，例如：

```sql
SELECT date_format('2023-05-11', 'M-d-y');
```

我们可以使用 `date_format` 将时间戳/日期转换为所需格式的字符串。例如：

```sql
SELECT date_format(o_orderdate, 'yyyy-MM-01') AS first_month_date FROM clickzetta_sample_data.tpch_100g.orders LIMIT 5;
```

请参阅 [此页面](sql_functions/scalar_functions/datetime_functions/date_format.md) 了解如何设置正确的日期时间格式。

4. **时间框架函数（YEAR/MONTH/DAY**）：当我们想从日期/时间列中提取特定时间段时，我们可以使用这些函数。例如，`SELECT year(DATE '2023-11-05');` 将返回 2023。类似地，我们还有 month、day、hour、min 等。

请参阅 [此页面](time-function.md) 了解更多的时间函数。

5. **数字**

   1. **ROUND** 用于指定小数点后允许的位数。例如，`SELECT ROUND(100.102345, 2);`
   2. **ABS** 用于获取给定数字的绝对值。例如，`SELECT ABS(-100), ABS(100);`
   3. **数学运算** 例如， +,-,\*,/。
   4. **Ceil/Floor** 用于获取给定小数的下一个更高和最近的较低整数。例如，`SELECT CEIL(100.1), FLOOR(100.1);`

^
