### FIRST_VALUE 函数

```
first_value(expr [, ignoreNulls]) [FILTER (WHERE condition)]
first(expr [, ignoreNulls]) [FILTER (WHERE condition)]
```

#### 功能描述

`FIRST_VALUE` 函数用于返回聚合组或窗口中的第一个值。可以选择是否忽略 `NULL` 值。`first` 是 `first_value` 的别名。

#### 参数说明

* `expr`：任意类型的表达式，要获取其第一个值。
* `ignoreNulls`：可选的布尔值参数，默认为 `false`。
  * `false`（默认）：返回第一个值，即使是 `NULL`
  * `true`：忽略 `NULL` 值，返回第一个非 `NULL` 值

#### 返回类型

* 返回与输入表达式相同的数据类型。
* 返回聚合组或窗口中的第一个值。

#### 注意事项

* 如果所有值都是 `NULL`（且 `ignoreNulls` 为 `true`），返回 `NULL`。
* 如果输入为空集，返回 `NULL`。
* 值的顺序取决于数据的输入顺序（不确定）。使用 `WITHIN GROUP (ORDER BY ...)` 可以指定确定性的顺序。

#### 使用示例

1. 基本用法：返回第一个值

```sql
SELECT first_value(col), first(col)
FROM VALUES (10), (5), (20) AS tab(col);
+------------------+------------+
| first_value(col) | first(col) |
+------------------+------------+
| 10               | 10         |
+------------------+------------+
```

2. 处理 NULL 值（默认返回第一个值，即使是 NULL）

```sql
SELECT first_value(col), first(col)
FROM VALUES (NULL), (5), (NULL) AS tab(col);
+------------------+------------+
| first_value(col) | first(col) |
+------------------+------------+
| NULL             | NULL       |
+------------------+------------+
```

3. 忽略 NULL 值，返回第一个非 NULL 值

```sql
SELECT first_value(col, true), first(col, true)
FROM VALUES (NULL), (5), (NULL) AS tab(col);
+------------------------+-------------------+
| first_value(col, true) | first(col, true)  |
+------------------------+-------------------+
| 5                      | 5                 |
+------------------------+-------------------+
```

4. 使用 WITHIN GROUP (ORDER BY ...) 指定顺序

```sql
SELECT a,
       first_value(b) WITHIN GROUP(ORDER BY c) as first_b,
       first_value(b, true) WITHIN GROUP(ORDER BY c) as first_non_null_b
FROM VALUES
  ('apple', 11, 22),
  ('apple', 1, 2),
  ('orange', NULL, 1),
  ('orange', 111, 2),
  ('orange', NULL, 3)
AS t(a, b, c)
GROUP BY a;
+--------+---------+------------------+
| a      | first_b | first_non_null_b |
+--------+---------+------------------+
| apple  | 1       | 1                |
| orange | NULL    | 111              |
+--------+---------+------------------+
```

5. 获取每个分组的第一个和最后一个值

```sql
SELECT
  category,
  first_value(value) as first_val,
  last_value(value) as last_val
FROM VALUES
  ('A', 10),
  ('A', 20),
  ('B', 30),
  ('B', 40)
AS t(category, value)
GROUP BY category;
+----------+-----------+----------+
| category | first_val | last_val |
+----------+-----------+----------+
| A        | 10        | 20       |
| B        | 30        | 40       |
+----------+-----------+----------+
```

6. 使用 FILTER 子句条件性地获取第一个值

```sql
SELECT first_value(col) FILTER (WHERE col > 5)
FROM VALUES (3), (10), (7), (12) AS tab(col);
+-------------------------------------------+
| first_value(col) FILTER (WHERE (col > 5)) |
+-------------------------------------------+
| 10                                        |
+-------------------------------------------+
```
