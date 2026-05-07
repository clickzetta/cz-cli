### BOOL_OR 函数

```sql
bool_or([DISTINCT] expr) [FILTER (WHERE condition)]
```

#### 功能描述

`BOOL_OR` 函数用于判断一组布尔值中是否存在 `TRUE`。当输入的数据集中至少有一个 `TRUE` 时，函数返回 `TRUE`；如果所有值都是 `FALSE` 或 `NULL`，则返回 `FALSE`。若不设置 `DISTINCT` 参数，函数将计算所有值；设置 `DISTINCT` 后，将计算去重后的值。

#### 参数说明

* `expr` (`BOOLEAN` 类型): 需要进行逻辑或运算的布尔表达式。

#### 返回类型

* 返回值类型为 `BOOLEAN`。当存在至少一个 `TRUE` 值时，返回 `TRUE`；否则返回 `FALSE`。
* 如果输入数据全部为 `NULL`，则返回 `NULL`。

#### 使用示例

1. 存在至少一个 `TRUE` 值时返回 `TRUE`：

```sql
SELECT bool_or(col) FROM VALUES (TRUE), (TRUE), (NULL) AS tab(col);
+--------------+
| bool_or(col) |
+--------------+
| true         |
+--------------+
```

2. 所有值都为 `FALSE` 或 `NULL` 时返回 `FALSE`：

```sql
SELECT bool_or(col) FROM VALUES (FALSE), (FALSE), (NULL) AS tab(col);
+--------------+
| bool_or(col) |
+--------------+
| false        |
+--------------+
```

3. 使用 `DISTINCT` 参数进行去重后计算：

```sql
SELECT bool_or(DISTINCT col) FROM VALUES (TRUE), (TRUE), (NULL) AS tab(col);
+-----------------------+
| bool_or(DISTINCT col) |
+-----------------------+
| true                  |
+-----------------------+
```

4. 多个 `FALSE` 值和 `NULL` 值的情况：

```sql
SELECT bool_or(col) FROM VALUES (FALSE), (NULL), (NULL) AS tab(col);
+--------------+
| bool_or(col) |
+--------------+
| false        |
+--------------+
```

5. 混合值的情况：

```sql
SELECT bool_or(col) FROM VALUES (TRUE), (FALSE), (NULL), (TRUE) AS tab(col);
+--------------+
| bool_or(col) |
+--------------+
| true         |
+--------------+
```

6. 使用 FILTER 子句条件性地计算布尔或：

```sql
SELECT bool_or(col1) FILTER (WHERE col2 > 1) FROM VALUES (FALSE, 2), (TRUE, 3), (FALSE, 1) AS tab(col1, col2);
+---------------------------------------------+
| bool_or(col1) FILTER (WHERE (col2 > 1))     |
+---------------------------------------------+
| true                                        |
+---------------------------------------------+
```
