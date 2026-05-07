# 窗口函数（Window Function）

## 概述

窗口函数（Window Function）是云器Lakehouse SQL中一种强大的分析功能，它允许在一组相关行上执行计算，而不仅仅是针对单个行。通过使用WINDOW子句，可以定义一个或多个命名的窗口，然后在窗口函数中引用这些窗口，避免重复编写相同的窗口规范，使查询更加简洁和易维护。

## 语法

```sql
WINDOW <window_name> AS (<window_specification>, ...)
```

### 参数说明

* **window\_name**: 窗口的名称，必须是有效的标识符，不能与表名或列名冲突
* **window\_specification**: 窗口规范，定义窗口的范围和顺序，包含以下部分：
  * `PARTITION BY`: 指定数据分组方式，每个组是一个分区
  * `ORDER BY`: 指定每个分区内的数据排序方式
  * `frame_clause`: 指定窗口框架，限制窗口函数的计算范围

### 窗口框架类型

1. **ROWS Frame**: 基于行数的窗口框架
2. **RANGE Frame**: 基于值范围的窗口框架

## 环境准备

### 创建测试表

```sql
CREATE TABLE IF NOT EXISTS sales(
    month INT,
    sales INT,
    profit DOUBLE
);
```

### 插入测试数据

```sql
INSERT INTO sales (month, sales, profit) VALUES
(1, 100, 0.1),
(2, 120, 0.15),
(3, 80, 0.05),
(4, 150, 0.2),
(5, 90, 0.1),
(6, 110, 0.12);
```

## 使用示例

### 示例1：移动窗口聚合 - 计算移动和与移动平均

**业务场景**: 计算当前月及前两个月的销售总和与平均值

```sql
SELECT month, sales, 
       SUM(sales) OVER w AS sum_sales, 
       AVG(sales) OVER w AS avg_sales
FROM sales
WINDOW w AS (ORDER BY month ROWS BETWEEN 2 PRECEDING AND CURRENT ROW);
```

**执行结果**:

```
+-------+-------+-----------+--------------------+
| month | sales | sum_sales | avg_sales          |
+-------+-------+-----------+--------------------+
| 1     | 100   | 100       | 100.0              |
| 2     | 120   | 220       | 110.0              |
| 3     | 80    | 300       | 100.0              |
| 4     | 150   | 350       | 116.67             |
| 5     | 90    | 320       | 106.67             |
| 6     | 110   | 350       | 116.67             |
+-------+-------+-----------+--------------------+
```

**说明**: 窗口w定义了一个滑动窗口，包含当前行和前2行，因此每行都会计算最近3个月的销售总和与平均值。

***

### 示例2：多窗口排名 - 季度排名与年度排名

**业务场景**: 同时计算销售额在季度内和全年的排名

```sql
SELECT month, sales, 
       RANK() OVER w1 AS rank_quarter, 
       ROW_NUMBER() OVER w2 AS rank_year
FROM sales
WINDOW w1 AS (PARTITION BY CEIL(month / 3) ORDER BY sales DESC),
       w2 AS (ORDER BY sales DESC);
```

**执行结果**:

```
+-------+-------+--------------+-----------+
| month | sales | rank_quarter | rank_year |
+-------+-------+--------------+-----------+
| 4     | 150   | 1            | 1         |
| 2     | 120   | 1            | 2         |
| 6     | 110   | 2            | 3         |
| 1     | 100   | 2            | 4         |
| 5     | 90    | 3            | 5         |
| 3     | 80    | 3            | 6         |
+-------+-------+--------------+-----------+
```

**说明**:

* w1窗口按季度（每3个月）分区，计算各季度内的销售排名
* w2窗口不分区，计算全年的销售排名
* 使用CEIL(month/3)将月份分为Q1(1-3月)、Q2(4-6月)等

***

### 示例3：累积聚合 - 从年初至今的统计

**业务场景**: 计算从年初到当前月的累积销售额、平均利润率等

```sql
SELECT month, sales, profit,
       SUM(sales) OVER w AS cumulative_sales,
       AVG(profit) OVER w AS avg_profit,
       MAX(sales) OVER w AS max_sales,
       MIN(sales) OVER w AS min_sales
FROM sales
WINDOW w AS (ORDER BY month ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW);
```

**执行结果**:

```
+-------+-------+--------+------------------+------------+-----------+-----------+
| month | sales | profit | cumulative_sales | avg_profit | max_sales | min_sales |
+-------+-------+--------+------------------+------------+-----------+-----------+
| 1     | 100   | 0.1    | 100              | 0.1        | 100       | 100       |
| 2     | 120   | 0.15   | 220              | 0.125      | 120       | 100       |
| 3     | 80    | 0.05   | 300              | 0.1        | 120       | 80        |
| 4     | 150   | 0.2    | 450              | 0.125      | 150       | 80        |
| 5     | 90    | 0.1    | 540              | 0.12       | 150       | 80        |
| 6     | 110   | 0.12   | 650              | 0.12       | 150       | 80        |
+-------+-------+--------+------------------+------------+-----------+-----------+
```

**说明**: `UNBOUNDED PRECEDING`表示从分区的第一行开始，`CURRENT ROW`表示到当前行结束，实现累积计算。

***

### 示例4：时间序列分析 - 环比数据对比

**业务场景**: 查看每月销售额与上月、下月的对比及环比变化

```sql
SELECT month, sales,
       LAG(sales, 1) OVER w AS prev_sales,
       LEAD(sales, 1) OVER w AS next_sales,
       sales - LAG(sales, 1) OVER w AS sales_change
FROM sales
WINDOW w AS (ORDER BY month);
```

**执行结果**:

```
+-------+-------+------------+------------+--------------+
| month | sales | prev_sales | next_sales | sales_change |
+-------+-------+------------+------------+--------------+
| 1     | 100   | NULL       | 120        | NULL         |
| 2     | 120   | 100        | 80         | 20           |
| 3     | 80    | 120        | 150        | -40          |
| 4     | 150   | 80         | 90         | 70           |
| 5     | 90    | 150        | 110        | -60          |
| 6     | 110   | 90         | NULL       | 20           |
+-------+-------+------------+------------+--------------+
```

**说明**:

* `LAG(sales, 1)`: 获取上一行的销售额
* `LEAD(sales, 1)`: 获取下一行的销售额
* 第一行和最后一行的prev\_sales和next\_sales为NULL

***

### 示例5：多种排名函数对比

**业务场景**: 理解不同排名函数的差异

```sql
SELECT month, sales,
       DENSE_RANK() OVER w AS dense_rank,
       RANK() OVER w AS rank,
       ROW_NUMBER() OVER w AS row_num,
       PERCENT_RANK() OVER w AS percent_rank
FROM sales
WINDOW w AS (ORDER BY sales DESC);
```

**执行结果**:

```
+-------+-------+------------+------+---------+--------------+
| month | sales | dense_rank | rank | row_num | percent_rank |
+-------+-------+------------+------+---------+--------------+
| 4     | 150   | 1          | 1    | 1       | 0.0          |
| 2     | 120   | 2          | 2    | 2       | 0.2          |
| 6     | 110   | 3          | 3    | 3       | 0.4          |
| 1     | 100   | 4          | 4    | 4       | 0.6          |
| 5     | 90    | 5          | 5    | 5       | 0.8          |
| 3     | 80    | 6          | 6    | 6       | 1.0          |
+-------+-------+------------+------+---------+--------------+
```

**排名函数说明**:

* `ROW_NUMBER()`: 连续唯一的行号，即使值相同也不会并列
* `RANK()`: 相同值得到相同排名，下一个排名会跳过
* `DENSE_RANK()`: 相同值得到相同排名，下一个排名连续
* `PERCENT_RANK()`: 返回0到1之间的百分比排名

***

### 示例6：位置函数 - 访问特定位置的值

**业务场景**: 获取窗口内第一个、最后一个和指定位置的值

```sql
SELECT month, sales, profit,
       FIRST_VALUE(sales) OVER w AS first_sales,
       LAST_VALUE(sales) OVER w AS last_sales,
       NTH_VALUE(sales, 2) OVER w AS second_sales
FROM sales
WINDOW w AS (ORDER BY month ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING);
```

**执行结果**:

```
+-------+-------+--------+-------------+------------+--------------+
| month | sales | profit | first_sales | last_sales | second_sales |
+-------+-------+--------+-------------+------------+--------------+
| 1     | 100   | 0.1    | 100         | 110        | 120          |
| 2     | 120   | 0.15   | 100         | 110        | 120          |
| 3     | 80    | 0.05   | 100         | 110        | 120          |
| 4     | 150   | 0.2    | 100         | 110        | 120          |
| 5     | 90    | 0.1    | 100         | 110        | 120          |
| 6     | 110   | 0.12   | 100         | 110        | 120          |
+-------+-------+--------+-------------+------------+--------------+
```

**说明**:

* `FIRST_VALUE()`: 返回窗口中第一行的值
* `LAST_VALUE()`: 返回窗口中最后一行的值（需要UNBOUNDED FOLLOWING才能看到真正的最后一行）
* `NTH_VALUE(expr, n)`: 返回窗口中第n行的值

***

### 示例7：RANGE窗口框架 - 基于值范围的窗口

**业务场景**: 找出销售额在±10范围内的所有记录并统计

```sql
SELECT month, sales,
       SUM(sales) OVER w AS range_sum,
       COUNT(*) OVER w AS range_count
FROM sales
WINDOW w AS (ORDER BY sales RANGE BETWEEN 10 PRECEDING AND 10 FOLLOWING);
```

**执行结果**:

```
+-------+-------+-----------+-------------+
| month | sales | range_sum | range_count |
+-------+-------+-----------+-------------+
| 3     | 80    | 170       | 2           |
| 5     | 90    | 270       | 3           |
| 1     | 100   | 300       | 3           |
| 6     | 110   | 330       | 3           |
| 2     | 120   | 230       | 2           |
| 4     | 150   | 150       | 1           |
+-------+-------+-----------+-------------+
```

**说明**:

* RANGE窗口基于值的范围而非行数
* 对于sales=100的行，窗口包含销售额在\[90, 110]范围内的所有行
* 对于sales=150的行，只有它自己在\[140, 160]范围内

***

### 示例8：综合分析 - 多维度业务报表（高级）

**业务场景**: 生成包含排名、累积、环比和占比的综合分析报表

```sql
SELECT 
    month,
    sales,
    -- 排名相关
    ROW_NUMBER() OVER w1 AS row_num,
    RANK() OVER w1 AS sales_rank,
    -- 累积统计
    SUM(sales) OVER w2 AS ytd_sales,
    AVG(sales) OVER w2 AS ytd_avg,
    -- 环比对比
    LAG(sales) OVER w1 AS prev_month_sales,
    sales - LAG(sales) OVER w1 AS mom_change,
    -- 占比分析
    ROUND(sales * 100.0 / SUM(sales) OVER w3, 2) AS pct_of_total
FROM sales
WINDOW 
    w1 AS (ORDER BY month),
    w2 AS (ORDER BY month ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW),
    w3 AS (ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING);
```

**执行结果**:

```
+-------+-------+---------+------------+-----------+---------+------------------+------------+---------------+
| month | sales | row_num | sales_rank | ytd_sales | ytd_avg | prev_month_sales | mom_change | pct_of_total  |
+-------+-------+---------+------------+-----------+---------+------------------+------------+---------------+
| 1     | 100   | 1       | 1          | 100       | 100.0   | NULL             | NULL       | 15.38         |
| 2     | 120   | 2       | 2          | 220       | 110.0   | 100              | 20         | 18.46         |
| 3     | 80    | 3       | 3          | 300       | 100.0   | 120              | -40        | 12.31         |
| 4     | 150   | 4       | 4          | 450       | 112.5   | 80               | 70         | 23.08         |
| 5     | 90    | 5       | 5          | 540       | 108.0   | 150              | -60        | 13.85         |
| 6     | 110   | 6       | 6          | 650       | 108.33  | 90               | 20         | 16.92         |
+-------+-------+---------+------------+-----------+---------+------------------+------------+---------------+
```

**说明**:

* 此示例同时使用了3个不同的窗口定义
* w1: 按月份排序，用于排名和环比
* w2: 累积窗口，用于YTD（Year-To-Date）计算
* w3: 完整窗口，用于计算总和并计算占比
* 展示了如何在一个查询中实现复杂的多维度分析

***

### 示例9：数据分桶 - NTILE函数应用

**业务场景**: 将销售数据按业绩分为高中低三档

```sql
SELECT 
    month,
    sales,
    NTILE(3) OVER w AS sales_tier,
    CASE 
        WHEN NTILE(3) OVER w = 1 THEN 'High'
        WHEN NTILE(3) OVER w = 2 THEN 'Medium'  
        ELSE 'Low'
    END AS tier_label
FROM sales
WINDOW w AS (ORDER BY sales DESC);
```

**执行结果**:

```
+-------+-------+------------+------------+
| month | sales | sales_tier | tier_label |
+-------+-------+------------+------------+
| 4     | 150   | 1          | High       |
| 2     | 120   | 1          | High       |
| 6     | 110   | 2          | Medium     |
| 1     | 100   | 2          | Medium     |
| 5     | 90    | 3          | Low        |
| 3     | 80    | 3          | Low        |
+-------+-------+------------+------------+
```

**说明**: `NTILE(n)`将排序后的数据尽可能平均地分成n个桶，常用于分层分析、ABC分类等场景。

***

### 示例10：累积分布 - CUME\_DIST函数应用

**业务场景**: 计算每个销售额在整体中的累积分布百分位

```sql
SELECT 
    month,
    sales,
    CUME_DIST() OVER w AS cumulative_dist,
    ROUND(CUME_DIST() OVER w * 100, 2) AS percentile
FROM sales
WINDOW w AS (ORDER BY sales);
```

**执行结果**:

```
+-------+-------+------------------+------------+
| month | sales | cumulative_dist  | percentile |
+-------+-------+------------------+------------+
| 3     | 80    | 0.167            | 16.67      |
| 5     | 90    | 0.333            | 33.33      |
| 1     | 100   | 0.500            | 50.00      |
| 6     | 110   | 0.667            | 66.67      |
| 2     | 120   | 0.833            | 83.33      |
| 4     | 150   | 1.000            | 100.00     |
+-------+-------+------------------+------------+
```

**说明**: `CUME_DIST()`返回小于或等于当前值的行数占总行数的比例，表示当前值在数据集中的累积分布位置。

***

## 窗口框架详解

### ROWS vs RANGE

| 框架类型  | 说明       | 示例                                            |
| ----- | -------- | --------------------------------------------- |
| ROWS  | 基于物理行数   | `ROWS BETWEEN 2 PRECEDING AND CURRENT ROW`    |
| RANGE | 基于值的逻辑范围 | `RANGE BETWEEN 10 PRECEDING AND 10 FOLLOWING` |

### 边界关键字

* `UNBOUNDED PRECEDING`: 分区的第一行
* `UNBOUNDED FOLLOWING`: 分区的最后一行
* `CURRENT ROW`: 当前行
* `n PRECEDING`: 当前行之前的第n行（ROWS）或值-n的行（RANGE）
* `n FOLLOWING`: 当前行之后的第n行（ROWS）或值+n的行（RANGE）

***

## 常用窗口函数分类

### 聚合函数

* `SUM()`, `AVG()`, `COUNT()`, `MAX()`, `MIN()`

### 排名函数

* `ROW_NUMBER()`: 连续唯一行号
* `RANK()`: 相同值同排名，有间隔
* `DENSE_RANK()`: 相同值同排名，无间隔
* `PERCENT_RANK()`: 百分比排名
* `NTILE(n)`: 将数据分成n个桶
* `CUME_DIST()`: 累积分布值

### 取值函数

* `LAG()`: 访问前面的行
* `LEAD()`: 访问后面的行
* `FIRST_VALUE()`: 窗口第一个值
* `LAST_VALUE()`: 窗口最后一个值
* `NTH_VALUE()`: 窗口第n个值

***

## 最佳实践

### 1. 使用WINDOW子句提高可读性

❌ **不推荐**（重复定义窗口）:

```sql
SELECT month,
       SUM(sales) OVER (ORDER BY month ROWS BETWEEN 2 PRECEDING AND CURRENT ROW),
       AVG(sales) OVER (ORDER BY month ROWS BETWEEN 2 PRECEDING AND CURRENT ROW)
FROM sales;
```

✅ **推荐**（使用WINDOW子句）:

```sql
SELECT month,
       SUM(sales) OVER w,
       AVG(sales) OVER w
FROM sales
WINDOW w AS (ORDER BY month ROWS BETWEEN 2 PRECEDING AND CURRENT ROW);
```

### 2. 合理使用PARTITION BY

对于分组分析，使用PARTITION BY可以在不破坏数据结构的情况下进行组内计算：

```sql
-- 示例：按类别分别计算排名
SELECT category, month, sales,
       RANK() OVER w AS rank_in_category
FROM sales_by_category
WINDOW w AS (PARTITION BY category ORDER BY sales DESC);
```

**执行结果**:

```
+-------------+-------+-------+------------------+
| category    | month | sales | rank_in_category |
+-------------+-------+-------+------------------+
| Clothing    | 2     | 600   | 1                |
| Clothing    | 3     | 550   | 2                |
| Clothing    | 1     | 500   | 3                |
| Electronics | 2     | 1200  | 1                |
| Electronics | 1     | 1000  | 2                |
| Electronics | 3     | 900   | 3                |
+-------------+-------+-------+------------------+
```

说明：每个类别内独立计算排名，互不影响。

### 3. 注意LAST\_VALUE的窗口范围

如果要获取真正的最后一个值，必须使用`UNBOUNDED FOLLOWING`：

```sql
WINDOW w AS (ORDER BY month ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
```

### 4. 特定注意事项

在Lakehouse中，建议在查询末尾添加LIMIT子句以提高性能：

```sql
SELECT ... FROM ... WINDOW ... LIMIT 50;
```

***

## 性能优化建议

1. **索引优化**: 在ORDER BY和PARTITION BY使用的列上创建适当的索引
2. **窗口范围**: 尽量使用较小的窗口范围以减少计算量
3. **复用窗口定义**: 使用WINDOW子句避免重复定义相同窗口
4. **分区策略**: 合理使用PARTITION BY减少每个窗口的数据量

***

## 常见问题

### Q1: WINDOW子句必须放在哪里？

A: WINDOW子句必须放在FROM和WHERE子句之后，ORDER BY子句之前。

### Q2: 能否在同一个查询中定义多个窗口？

A: 可以，使用逗号分隔多个窗口定义。

### Q3: ROWS和RANGE的主要区别是什么？

A: ROWS基于物理行数，RANGE基于值的逻辑范围。当有重复值时，RANGE会包含所有具有相同值的行。

### Q4: 为什么LAST\_VALUE没有返回预期的最后一个值？

A: 需要显式指定`ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING`来包含整个分区。

***

^
