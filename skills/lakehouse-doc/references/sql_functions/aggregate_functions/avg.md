### AVG 函数

```
avg([DISTINCT] expr) [FILTER (WHERE condition)]
```

#### 功能描述

`AVG` 函数用于计算指定表达式在一组数据中的算术平均值。当指定 `DISTINCT` 关键字时，将计算去重后的平均值。

#### 参数说明

* `expr`：数值类型表达式，可以是 `TINYINT`、`SMALLINT`、`INT`、`BIGINT`、`FLOAT`、`DOUBLE` 或 `DECIMAL` 类型。

#### 返回类型

* 对于 `DECIMAL` 类型表达式，`AVG` 函数返回 `DECIMAL` 类型的结果。返回值的精度（`precision`）和标度（`scale`）可能会增加以适应计算结果。
* 对于其他数值类型表达式，`AVG` 函数返回 `DOUBLE` 类型的结果。

#### 注意事项

* 函数计算过程中，`NULL` 值将被忽略，不参与平均值的计算。

#### 使用示例

1. 计算数值列的平均值（不包含 `NULL` 值）：

```sql
SELECT avg(col) FROM VALUES (1), (2), (3), (4), (NULL) AS tab(col);
+------------+
| `avg`(col) |
+------------+
| 2.5        |
+------------+
```

2. 计算去重后数值列的平均值：

```sql
SELECT avg(DISTINCT col) FROM VALUES (1), (1), (2), (3), (4), (NULL) AS tab(col);
+---------------------+
| `avg`(DISTINCT col) |
+---------------------+
| 2.5                 |
+---------------------+
```

3. 使用 FILTER 子句条件性地计算平均值：

```sql
SELECT avg(col) FILTER (WHERE col > 2) FROM VALUES (1), (2), (3), (4), (NULL) AS tab(col);
+---------------------------------------+
| `avg`(col) FILTER (WHERE (col > 2))   |
+---------------------------------------+
| 3.5                                   |
+---------------------------------------+
```

4. 结合 FILTER 子句和 DISTINCT 计算去重后的条件平均值：

```sql
SELECT avg(DISTINCT col) FILTER (WHERE col <= 3) FROM VALUES (1), (1), (2), (3), (4) AS tab(col);
+------------------------------------------------------+
| `avg`(DISTINCT col) FILTER (WHERE (col <= 3))        |
+------------------------------------------------------+
| 2.0                                                  |
+------------------------------------------------------+
```
