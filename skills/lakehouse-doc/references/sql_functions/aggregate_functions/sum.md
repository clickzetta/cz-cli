### SUM 函数

```sql
sum([DISTINCT] expr) [FILTER (WHERE condition)]
```

#### 功能描述

`SUM` 函数用于计算并返回一组数值数据的总和。如果指定了 `DISTINCT` 关键字，则会计算去重后的数值集合的总和。

#### 参数说明

* `expr`：需要求和的数值类型字段，可以是 `TINYINT`、`SMALLINT`、`INT`、`BIGINT`、`FLOAT`、`DOUBLE` 或 `DECIMAL` 类型。

#### 返回类型

* 对于 `DECIMAL` 类型的数据，返回 `DECIMAL` 类型的结果。其他情况返回 `DOUBLE` 类型的结果。
* 当指定 `DISTINCT` 关键字时，会返回去重后的数值集合的总和。
* 如果表达式中包含 `NULL` 值，`NULL` 值将不参与计算。

#### 使用示例

1. 计算所有数值的总和：

```sql
SELECT sum(col) FROM VALUES (5), (10), (10), (15), (NULL) AS tab(col);
+------------+
| `sum`(col) |
+------------+
| 40         |
+------------+
```

2. 计算去重后的数值集合的总和：

```sql
SELECT sum(DISTINCT col) FROM VALUES (5), (10), (10), (15), (NULL) AS tab(col);
+---------------------+
| `sum`(DISTINCT col) |
+---------------------+
| 30                  |
+---------------------+
```

3. 使用 FILTER 子句条件性地计算总和：

```sql
SELECT sum(col) FILTER (WHERE col > 10) FROM VALUES (5), (10), (15), (20) AS tab(col);
+---------------------------------------+
| `sum`(col) FILTER (WHERE (col > 10))  |
+---------------------------------------+
| 35                                    |
+---------------------------------------+
```

4. 结合 FILTER 子句和 DISTINCT 计算去重后的条件总和：

```sql
SELECT sum(DISTINCT col) FILTER (WHERE col >= 10) FROM VALUES (5), (10), (10), (15), (20) AS tab(col);
+------------------------------------------------------+
| `sum`(DISTINCT col) FILTER (WHERE (col >= 10))       |
+------------------------------------------------------+
| 45                                                   |
+------------------------------------------------------+
```

通过以上示例，您可以更好地理解 `SUM` 函数的用法和应用场景。请根据您的实际需求调整参数和表达式。
