# Window Frame

Window Frame 是在使用窗口函数时定义的一个子集，用于限制窗口函数的计算范围，只对窗口框架中的数据进行计算。通过窗口框架，可以更加精确地控制窗口函数的计算方式和结果。以下是窗口框架的详细说明和使用示例。

## Window Frame语法

在使用窗口函数时，可以通过 `OVER` 子句定义窗口框架，语法如下：

```SQL
<window_function> OVER (
    [PARTITION BY <partition_expression>]
    [ORDER BY <order_expression>]
    [frame_clause>]
)
```

其中，`<window_function>` 表示要使用的窗口函数名称，例如 `ROW_NUMBER()`、`RANK()`、`SUM()` 等。`PARTITION BY` 子句用于将数据分组，每个分组称为一个分区（partition）。`ORDER BY` 子句用于在每个分区中对数据进行排序，这将影响某些窗口函数的结果，如 `ROW_NUMBER()`、`RANK()` 等。`frame_clause` 用于定义窗口框架的范围，有两种形式：`ROWS frame` 和 `RANGE frame`。

### ROWS frame

`ROWS frame` 是基于行的窗口框架，用于指定窗口框架中包含的行数或位置。其语法如下：

```SQL
ROWS BETWEEN <start_boundary> AND <end_boundary>
```

`<start_boundary>` 和 `<end_boundary>` 用于定义窗口框架的起始和结束边界，可以是以下值之一：

- `UNBOUNDED PRECEDING`：从分区的第一行开始。
- `UNBOUNDED FOLLOWING`：到分区的最后一行结束。
- `CURRENT ROW`：当前行。
- `<offset> PRECEDING`：当前行之前的第`<offset>`行，`<offset>`为非负整数。
- `<offset> FOLLOWING`：当前行之后的第`<offset>`行，`<offset>`为非负整数。

### RANGE frame

`RANGE frame` 是基于值的窗口框架，用于指定窗口框架中包含的行的值的范围。其语法如下：

```SQL
RANGE BETWEEN <start_boundary> AND <end_boundary>
```

`<start_boundary>` 和 `<end_boundary>` 用于定义窗口框架的起始和结束边界，可以是以下值之一：

- `UNBOUNDED PRECEDING`：从分区中最小值开始。
- `UNBOUNDED FOLLOWING`：到分区中最大值结束。
- `CURRENT ROW`：当前行的值。
- `<value> PRECEDING`：当前行的值减去`<value>`，`<value>`为非负数。
- `<value> FOLLOWING`：当前行的值加上`<value>`，`<value>`为非负数。

## Window Frame的使用示例

以下是一些使用 Window Frame 的 SQL 查询示例，以及它们的输出结果。假设我们有一个名为 sales 的表，它包含了每个月的销售额和利润率的数据，如下所示：



| month | sales | profit |
| ----- | ----- | ------ |
| 1     | 100   | 0.1    |
| 2     | 120   | 0.15   |
| 3     | 80    | 0.05   |
| 4     | 150   | 0.2    |
| 5     | 90    | 0.1    |
| 6     | 110   | 0.12   |



### ROWS frame

* 查询：使用 `SUM()` 函数和 `ROWS frame` 计算每个月的销售额与前两个月和后两个月的销售额的总和。

```SQL
SELECT month, sales, SUM(sales) OVER (ORDER BY month ROWS BETWEEN 2 PRECEDING AND 2 FOLLOWING) AS sum_sales
FROM sales;

+-------+-------+-----------+
| month | sales | sum_sales |
+-------+-------+-----------+
| 1     | 100   | 300       |
| 2     | 120   | 450       |
| 3     | 80    | 540       |
| 4     | 150   | 550       |
| 5     | 90    | 430       |
| 6     | 110   | 350       |
+-------+-------+-----------+
```

* 查询：使用 `AVG()` 函数和 `ROWS frame` 计算每个月的利润率与前一个月和后一个月的利润率的平均值。

```SQL
SELECT month, profit, AVG(profit) OVER (ORDER BY month ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING) AS avg_profit
FROM sales;
+-------+--------+---------------------+
| month | profit |     avg_profit      |
+-------+--------+---------------------+
| 1     | 0.1    | 0.125               |
| 2     | 0.15   | 0.09999999999999999 |
| 3     | 0.05   | 0.13333333333333333 |
| 4     | 0.2    | 0.11666666666666665 |
| 5     | 0.1    | 0.14                |
| 6     | 0.12   | 0.11                |
+-------+--------+---------------------+
```

### RANGE frame

* 查询：使用 `COUNT()` 函数和 `RANGE frame` 计算每个月的销售额在全年销售额中的分布，即有多少个月的销售额与当前月的销售额相差不超过 10。

```SQL
SELECT month, sales, COUNT(*) OVER (ORDER BY sales RANGE BETWEEN 10 PRECEDING AND 10 FOLLOWING) AS count_sales
FROM sales;
+-------+-------+-------------+
| month | sales | count_sales |
+-------+-------+-------------+
| 3     | 80    | 2           |
| 5     | 90    | 3           |
| 1     | 100   | 3           |
| 6     | 110   | 3           |
| 2     | 120   | 2           |
| 4     | 150   | 1           |
+-------+-------+-------------+
```

* 查询：使用 `MAX()` 函数和 `RANGE frame` 计算每个月的利润率与前一个月和后一个月的利润率的最大值。

```SQL
SELECT month, profit, MAX(profit) OVER (ORDER BY month RANGE BETWEEN 1 PRECEDING AND 1 FOLLOWING) AS max_profit
FROM sales;
+-------+--------+------------+
| month | profit | max_profit |
+-------+--------+------------+
| 1     | 0.1    | 0.15       |
| 2     | 0.15   | 0.15       |
| 3     | 0.05   | 0.2        |
| 4     | 0.2    | 0.2        |
| 5     | 0.1    | 0.2        |
| 6     | 0.12   | 0.12       |
+-------+--------+------------+
```
