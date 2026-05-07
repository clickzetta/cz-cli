### COUNT 函数

#### 简介

`COUNT` 函数用于返回一组数据的行数。它可以统计所有行的数量，也可以统计指定列中非 `NULL` 值的数量，或者统计指定列中不同值的数量。

#### 语法

```sql
COUNT(*) [FILTER (WHERE condition)]
COUNT([DISTINCT] expr1[, expr2, ...]) [FILTER (WHERE condition)]
```

#### 参数

* `exprN`: 任意类型的表达式。

#### 返回结果

* 返回值类型为 `BIGINT` 类型。
* 使用 `COUNT(*)` 形式时，所有行都会计入总数，包括包含 `NULL` 值的行。
* 使用 `COUNT(expr1[, expr2, ...])` 形式时，如果某一行的任意列为 `NULL`，该行将被忽略。
* 使用 `COUNT(DISTINCT expr1[, expr2, ...])` 形式时，首先对指定列进行去重，然后统计非 `NULL` 值的数量。

#### 示例

1. 统计所有行的数量（包括包含 `NULL` 值的行）：
```sql
SELECT COUNT(*) FROM VALUES (NULL), (1), (3), (4) AS tab(col);
+----------+
| count(1) |
+----------+
| 4        |
+----------+
```

2. 统计指定列中非 `NULL` 值的数量：
```sql
SELECT COUNT(a, b) FROM VALUES (NULL, NULL), (1, NULL), (NULL, 3), (4, 5) AS tab(a, b);
+------------+
| count(a,b) |
+------------+
| 1          |
+------------+
```

3. 统计指定列中不同值的数量（忽略 `NULL` 值）：
```sql
SELECT COUNT(DISTINCT a, b)
FROM VALUES (1, NULL), (1, NULL), (4, 5), (4, 5), (1, 2) AS tab(a, b);
+-----------------------+
| count(DISTINCT a, b)  |
+-----------------------+
| 2                     |
+-----------------------+
```

4. 统计某一列中特定值的数量：
```sql
SELECT COUNT(*) FROM customers WHERE status = 'active';
+----------+
| count(1) |
+----------+
| 150      |
+----------+
```

5. 统计销售记录中不同产品的销售数量（忽略 `NULL` 值）：
```sql
SELECT COUNT(DISTINCT product_id) FROM sales_records;
+------------------------------+
| count(DISTINCT `product_id`) |
+------------------------------+
| 50                           |
+------------------------------+
```

6. 使用 FILTER 子句条件性地统计行数：
```sql
SELECT COUNT(*) FILTER (WHERE col > 2) FROM VALUES (1), (2), (3), (4), (NULL) AS tab(col);
+--------------------------------------+
| count(1) FILTER (WHERE (col > 2))    |
+--------------------------------------+
| 2                                    |
+--------------------------------------+
```

7. 结合 FILTER 子句和 DISTINCT 统计不同值的数量：
```sql
SELECT COUNT(DISTINCT a) FILTER (WHERE b > 1) FROM VALUES (1, 1), (1, 2), (2, 2), (3, 1) AS tab(a, b);
+------------------------------------------------------+
| count(DISTINCT a) FILTER (WHERE (b > 1))             |
+------------------------------------------------------+
| 2                                                    |
+------------------------------------------------------+
```
