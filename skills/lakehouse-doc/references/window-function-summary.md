## 窗口函数（Window Functions）

窗口函数（Window Functions）是一种强大的SQL函数，它允许用户在一个查询中对数据集进行分组计算。与传统的聚合函数不同，窗口函数可以对每一行数据进行计算，同时保留原始数据的详细信息。窗口函数在数据分析、报表生成等场景中具有广泛的应用，例如计算排名、累计和、移动平均等。

## 窗口函数的基本语法

窗口函数的基本语法如下：

```SQL
<window_function> OVER (
    [PARTITION BY <partition_expression>]
    [ORDER BY <order_expression>]
)
```

* `<window_function>`：指定要使用的窗口函数，如`ROW_NUMBER()`、`RANK()`、`SUM()`等。
* `PARTITION BY`：将数据集划分为不同的分区，每个分区是一个独立的计算范围。
* `ORDER BY`：在每个分区内对数据进行排序，影响部分窗口函数的计算结果。

## 窗口函数的分类

根据功能和返回值类型，窗口函数可分为以下几类：

1.  **排名函数（Ranking Functions）**：对数据进行排名，返回表示相对位置的整数值。常用排名函数包括`ROW_NUMBER()`、`RANK()`、`DENSE_RANK()`、`PERCENT_RANK()`、`CUME_DIST()`、`NTILE()`等。
2.  **聚合函数（Aggregate Functions）**：对数据进行聚合计算，返回表示整体特征的值。Lakehouse支持所有标准的聚合函数。
3.  **分析函数（Analytic Functions）**：对数据进行分析计算，返回表示数据特征的值。常用分析函数包括`FIRST_VALUE()`、`LAST_VALUE()`、`LAG()`、`LEAD()`、`NTH_VALUE()`、`CUME_DIST()`等。

## 窗口函数的使用示例

以下是一些使用窗口函数的SQL查询示例及其输出结果。假设我们有一个名为 `sales` 的表，它包含了每个月的销售额和利润率数据，如下所示：

```SQL
CREATE    TABLE sales (MONTH int, sales int, profit double);
INSERT    INTO sales (MONTH, sales, profit)
VALUES    (1, 100, 0.1),
          (2, 120, 0.15),
          (3, 80, 0.05),
          (4, 150, 0.2),
          (5, 90, 0.1),
          (6, 110, 0.12);
```

### Ranking Functions

* 查询：使用`ROW_NUMBER()`函数对销售额进行降序排名。

```SQL
SELECT month, sales, ROW_NUMBER() OVER (ORDER BY sales DESC) AS rank
FROM sales;
+-------+-------+------+
| month | sales | rank |
+-------+-------+------+
| 4     | 150   | 1    |
| 2     | 120   | 2    |
| 6     | 110   | 3    |
| 1     | 100   | 4    |
| 5     | 90    | 5    |
| 3     | 80    | 6    |
+-------+-------+------+
```

* 查询：使用`RANK()`函数对利润率进行升序排名，并按照季度进行分组。

```SQL
SELECT month, profit, RANK() OVER (PARTITION BY CEIL(month / 3) ORDER BY profit ASC) AS rank
FROM sales;
+-------+--------+------+
| month | profit | rank |
+-------+--------+------+
| 3     | 0.05   | 1    |
| 1     | 0.1    | 2    |
| 2     | 0.15   | 3    |
| 5     | 0.1    | 1    |
| 6     | 0.12   | 2    |
| 4     | 0.2    | 3    |
+-------+--------+------+
```

### Aggregate Functions

* 查询：使用`AVG()`函数计算每个月的销售额与全年平均销售额的差值。

```SQL
SELECT month, sales, sales - AVG(sales) OVER () AS diff
FROM sales;
+-------+-------+--------------------+
| month | sales |        diff        |
+-------+-------+--------------------+
| 1     | 100   | -8.333333333333329 |
| 2     | 120   | 11.666666666666671 |
| 3     | 80    | -28.33333333333333 |
| 4     | 150   | 41.66666666666667  |
| 5     | 90    | -18.33333333333333 |
| 6     | 110   | 1.6666666666666714 |
+-------+-------+--------------------+
```

### Analytic Functions

* 查询：使用`LAG()`函数和`LEAD()`函数计算每个月的销售额与上个月和下个月的销售额的差值。

```SQL
SELECT month, sales, sales - LAG(sales) OVER (ORDER BY month) AS prev_diff, sales - LEAD(sales) OVER (ORDER BY month) AS next_diff
FROM sales;
+-------+-------+-----------+-----------+
| month | sales | prev_diff | next_diff |
+-------+-------+-----------+-----------+
| 1     | 100   | null      | -20       |
| 2     | 120   | 20        | 40        |
| 3     | 80    | -40       | -70       |
| 4     | 150   | 70        | 60        |
| 5     | 90    | -60       | -20       |
| 6     | 110   | 20        | null      |
+-------+-------+-----------+-----------+
```

* 查询：使用`CUME_DIST()`函数计算每个月的销售额在全年销售额中的累积分布。

```SQL
SELECT month, sales, CUME_DIST() OVER (ORDER BY sales) AS cume_dist
FROM sales;
+-------+-------+---------------------+
| month | sales |      cume_dist      |
+-------+-------+---------------------+
| 3     | 80    | 0.16666666666666666 |
| 5     | 90    | 0.3333333333333333  |
| 1     | 100   | 0.5                 |
| 6     | 110   | 0.6666666666666666  |
| 2     | 120   | 0.8333333333333334  |
| 4     | 150   | 1.0                 |
+-------+-------+---------------------+
```


