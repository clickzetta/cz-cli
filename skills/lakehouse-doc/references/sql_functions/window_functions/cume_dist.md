### CUME\_DIST 函数

```sql
cume_dist() OVER ([PARTITION BY column1, column2, ...] [ORDER BY column1 [ASC|DESC], column2 [ASC|DESC], ...])
```

#### 功能描述

CUME\_DIST 函数用于计算当前行在指定分区中的累计分布比例。具体来说，它返回一个 double 类型的值，表示在当前行及其之前的所有行（在分区内）占整个分区行数的比例。该函数通常用于数据分析，以便了解数据在不同分组中的分布情况。

#### 使用说明

* PARTITION BY 子句用于将数据分为不同的分区。如果未指定 PARTITION BY 子句，则整个数据集将被视为一个分区。
* ORDER BY 子句用于指定在每个分区内如何对数据进行排序。CUME\_DIST 函数的结果依赖于 ORDER BY 子句的排序顺序。
* 如果 ORDER BY 列中存在相同的值，CUME\_DIST 函数将为这些行返回相同的结果，即最后一行的 row\_number() 除以窗口行数。

#### 返回结果

* 返回值类型为 double 类型。
* 结果等于 `last_peer_row_number / partition_row_count`，其中 last\_peer\_row\_number 表示当前行及其之前的所有行（在分区内）的最大 row\_number() 值，partition\_row\_count 表示分区内的总行数。

#### 示例

```sql
SELECT a,
       b,
       ROW_NUMBER() OVER(PARTITION BY a ORDER BY b) AS row_num,
       CUME_DIST() OVER (PARTITION BY a ORDER BY b) AS cume_dist
FROM VALUES ('A', 2), ('A', 1), ('B', 3), ('A', 1) tab(a, b);
```

结果：

```
A	b	row_num	cume_dist
------------------------------------------------------------------------------------------
A	1	1	0.6666666666666666
A	1	2	0.6666666666666666
A	2	3	1.0
B	3	1	1.0
```

在这个示例中，我们可以看到：

* 当 a = 'A' 时，有两个行（b = 1 和 b = 2），它们的 cume\_dist 分别为 0.67（2/3）和 1（3/3）。
* 当 a = 'B' 时，只有一个行（b = 3），它的 cume\_dist 为 1（1/1）。

#### 更多示例

1. 计算每个部门内员工工资的累计分布：

```sql
SELECT dep_no,
       name,
       salary,
       CUME_DIST() OVER (PARTITION BY dep_no ORDER BY salary) AS cume_dist_salary
FROM VALUES
  ('Eric', 1, 28000),
  ('Alex', 1, 32000),
  ('Felix', 2, 21000),
  ('Frank', 1, 30000),
  ('Tom', 2, 23000),
  ('Jane', 3, 29000),
  ('Jeff', 3, 35000),
  ('Paul', 2, 29000),
  ('Charles', 2, 23000),
  ('null',4,null)
AS tab(name, dep_no, salary);
+--------+---------+--------+--------------------+
| dep_no |  name   | salary |  cume_dist_salary  |
+--------+---------+--------+--------------------+
| 3      | Jane    | 29000  | 0.5                |
| 3      | Jeff    | 35000  | 1.0                |
| 1      | Eric    | 28000  | 0.3333333333333333 |
| 1      | Frank   | 30000  | 0.6666666666666666 |
| 1      | Alex    | 32000  | 1.0                |
| 2      | Felix   | 21000  | 0.25               |
| 2      | Tom     | 23000  | 0.75               |
| 2      | Charles | 23000  | 0.75               |
| 2      | Paul    | 29000  | 1.0                |
| 4      | null    | null   | 1.0                |
+--------+---------+--------+--------------------+
```

2. 计算每个类别内商品销售额的累计分布：

```sql
SELECT category_id,
       product_id,
       sales_amount,
       CUME_DIST() OVER (PARTITION BY category_id ORDER BY sales_amount) AS cume_dist_sales
FROM sales_data;
```

3. 计算每个年龄段内用户数量的累计分布：

```sql
SELECT age_group,
       user_id,
       CUME_DIST() OVER (ORDER BY age_group) AS cume_dist_users
FROM users;
```

通过这些示例，您可以更好地了解 CUME\_DIST 函数在不同场景下的应用。
