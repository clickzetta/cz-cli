### BOOL_AND 函数

```sql
bool_and([DISTINCT] expr) [FILTER (WHERE condition)]
```

#### 功能描述

`BOOL_AND` 函数用于判断一组布尔值（`expr`）是否全部为 `TRUE`。当所有给定的布尔值都为 `TRUE` 时，函数返回 `TRUE`；否则，返回 `FALSE`。如果设置了 `DISTINCT` 关键字，函数将仅计算不重复的布尔值。

#### 参数说明

* `expr`：需要进行逻辑与操作的布尔表达式。

#### 返回类型

布尔值（`BOOLEAN`）。

#### 使用示例

1. 判断所有布尔值为 `TRUE`：

```sql
SELECT bool_and(col) FROM VALUES (TRUE), (TRUE), (TRUE) AS tab(col);
+---------------+
| bool_and(col) |
+---------------+
| TRUE          |
+---------------+
```

2. 包含 `NULL` 值的情况：

```sql
SELECT bool_and(col) FROM VALUES (TRUE), (TRUE), (NULL) AS tab(col);
+---------------+
| bool_and(col) |
+---------------+
| TRUE          |
+---------------+
```

3. 使用 `DISTINCT` 关键字，去重后判断所有布尔值为 `TRUE`：

```sql
SELECT bool_and(DISTINCT col) FROM VALUES (TRUE), (TRUE), (TRUE) AS tab(col);
+------------------------+
| bool_and(DISTINCT col) |
+------------------------+
| TRUE                   |
+------------------------+
```

4. 包含 `FALSE` 值的情况：

```sql
SELECT bool_and(col) FROM VALUES (FALSE), (TRUE), (NULL) AS tab(col);
+---------------+
| bool_and(col) |
+---------------+
| FALSE         |
+---------------+
```

5. 仅包含一个 `TRUE` 值和一个 `FALSE` 值：

```sql
SELECT bool_and(col) FROM VALUES (TRUE), (FALSE) AS tab(col);
+---------------+
| bool_and(col) |
+---------------+
| FALSE         |
+---------------+
```

6. 使用 FILTER 子句条件性地计算布尔与：

```sql
SELECT bool_and(col1) FILTER (WHERE col2 > 1) FROM VALUES (TRUE, 2), (TRUE, 3), (FALSE, 1) AS tab(col1, col2);
+----------------------------------------------+
| bool_and(col1) FILTER (WHERE (col2 > 1))     |
+----------------------------------------------+
| TRUE                                         |
+----------------------------------------------+
```
