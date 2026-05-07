### BIT_OR 函数

```sql
bit_or([DISTINCT] expr) [FILTER (WHERE condition)]
```

#### 功能描述

`BIT_OR` 函数用于计算一组整数表达式的按位或（`bitwise OR`）结果。该函数可以处理包括 `TINYINT`、`SMALLINT`、`INT` 和 `BIGINT` 在内的整数数据类型。通过使用该函数，用户可以对一组整数进行按位操作，从而得到一个新的整数值。

#### 参数说明

* `expr`：表示要进行按位或操作的整数表达式。要求参数类型为整数类型，包括 `TINYINT`、`SMALLINT`、`INT` 和 `BIGINT`。
* `DISTINCT`（可选）：当设置为 `DISTINCT` 时，函数会计算去重后的集合的按位或结果。如果未设置 `DISTINCT`，则对所有表达式进行按位或操作，包括重复值。

#### 返回结果

* 返回值类型与参数类型一致，即整数类型（`TINYINT`、`SMALLINT`、`INT` 或 `BIGINT`）。
* 如果所有输入参数都为 `NULL`，则返回 `NULL`。
* 对于未设置 `DISTINCT` 的情况，`NULL` 值不参与计算。
* 对于设置 `DISTINCT` 的情况，`NULL` 值也不参与计算。

#### 使用示例

1. 计算一组数值的按位或结果（未设置 `DISTINCT`）：

```sql
SELECT bit_or(col) FROM VALUES (3), (5), (7) AS tab(col);
+-------------+
| bit_or(col) |
+-------------+
| 7           |
+-------------+
```

2. 计算一组数值的去重后的按位或结果（设置 `DISTINCT`）：

```sql
SELECT bit_or(DISTINCT col) FROM VALUES (3), (3), (5), (7), (NULL) AS tab(col);
+----------------------+
| bit_or(DISTINCT col) |
+----------------------+
| 7                    |
+----------------------+
```

3. 计算含有 `NULL` 值的数值的按位或结果（未设置 `DISTINCT`）：

```sql
SELECT bit_or(col) FROM VALUES (3), (NULL), (7) AS tab(col);
+-------------+
| bit_or(col) |
+-------------+
| 7           |
+-------------+
```

4. 计算含有 `NULL` 值的数值的去重后的按位或结果（设置 `DISTINCT`）：

```sql
SELECT bit_or(DISTINCT col) FROM VALUES (3), (NULL), (7), (NULL) AS tab(col);
+----------------------+
| bit_or(DISTINCT col) |
+----------------------+
| 7                    |
+----------------------+
```

5. 使用 FILTER 子句条件性地计算按位或：

```sql
SELECT bit_or(col) FILTER (WHERE col < 6) FROM VALUES (3), (5), (7) AS tab(col);
+--------------------------------------+
| bit_or(col) FILTER (WHERE (col < 6)) |
+--------------------------------------+
| 7                                    |
+--------------------------------------+
```
