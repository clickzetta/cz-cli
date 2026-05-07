### LAST_VALUE 函数

```
last_value(expr [, ignoreNulls]) [FILTER (WHERE condition)]
last(expr [, ignoreNulls]) [FILTER (WHERE condition)]
```

#### 功能描述

`LAST_VALUE` 函数用于返回聚合组或窗口中的最后一个值。可以选择是否忽略 `NULL` 值。`last` 是 `last_value` 的别名。

#### 参数说明

* `expr`：任意类型的表达式，要获取其最后一个值。
* `ignoreNulls`：可选的布尔值参数，默认为 `false`。
  * `false`（默认）：返回最后一个值，即使是 `NULL`。
  * `true`：忽略 `NULL` 值，返回最后一个非 `NULL` 值。

#### 返回类型

* 返回与输入表达式相同的数据类型。
* 返回聚合组或窗口中的最后一个值。

#### 注意事项

* 如果所有值都是 `NULL`（且 `ignoreNulls` 为 `true`），则返回 `NULL`。
* 如果输入为空集，返回 `NULL`。
* 在 `GROUP BY` 查询中，返回每个分组的最后一个值。使用 `WITHIN GROUP (ORDER BY ...)` 可以指定确定性的顺序。

#### 使用示例

1. 基本用法：返回最后一个值

```sql
SELECT last_value(col), last(col)
FROM VALUES (10), (5), (20) AS tab(col);
+-----------------+-----------+
| last_value(col) | last(col) |
+-----------------+-----------+
| 20              | 20        |
+-----------------+-----------+
```

2. 处理 NULL 值（默认返回最后一个值，即使是 NULL）

```sql
SELECT last_value(col), last(col)
FROM VALUES (NULL), (5), (NULL) AS tab(col);
+-----------------+-----------+
| last_value(col) | last(col) |
+-----------------+-----------+
| NULL            | NULL      |
+-----------------+-----------+
```

3. 忽略 NULL 值，返回最后一个非 NULL 值

```sql
SELECT last_value(col, true), last(col, true)
FROM VALUES (NULL), (5), (NULL) AS tab(col);
+-----------------------+------------------+
| last_value(col, true) | last(col, true)  |
+-----------------------+------------------+
| 5                     | 5                |
+-----------------------+------------------+
```

4. 使用 WITHIN GROUP (ORDER BY ...) 指定顺序

```sql
SELECT a,
       last_value(b) WITHIN GROUP(ORDER BY c) as last_b,
       last_value(b, true) WITHIN GROUP(ORDER BY c) as last_non_null_b
FROM VALUES
  ('apple', 11, 22),
  ('apple', 1, 2),
  ('orange', NULL, 1),
  ('orange', 111, 2),
  ('orange', NULL, 3)
AS t(a, b, c)
GROUP BY a;
+--------+--------+-----------------+
| a      | last_b | last_non_null_b |
+--------+--------+-----------------+
| apple  | 11     | 11              |
| orange | NULL   | 111             |
+--------+--------+-----------------+
```

5. 使用 FILTER 子句条件性地获取最后一个值

```sql
SELECT last_value(col) FILTER (WHERE col < 15)
FROM VALUES (3), (10), (7), (12) AS tab(col);
+-------------------------------------------+
| last_value(col) FILTER (WHERE (col < 15)) |
+-------------------------------------------+
| 12                                        |
+-------------------------------------------+
```
