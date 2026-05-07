### MIN 函数

```
min([DISTINCT] expr) [FILTER (WHERE condition)]
```

#### 功能描述

`MIN` 函数用于从一组数据中找出最小值。该函数支持多种数据类型，包括数值类型（如 `TINYINT`、`SMALLINT`、`INT`、`BIGINT`、`FLOAT`、`DOUBLE` 和 `DECIMAL`）、时间类型（如 `DATE` 和 `TIMESTAMP`）、字符串类型（如 `CHAR`、`VARCHAR` 和 `STRING`）以及 `BINARY` 类型。

#### 参数说明

* `expr`：可比较的数据类型，包括数值类型、时间类型和字符串类型。

#### 返回结果

* 返回值类型与输入参数类型相同。
* 若设置 `DISTINCT` 关键字，则计算去重后的集合中的最小值，但对结果无影响。
* `NULL` 值不参与计算。

#### 使用示例

1. 从一组数值中找出最小值：

```sql
SELECT min(col) FROM VALUES (10), (50), (20), (NULL) AS tab(col);
+------------+
| `min`(col) |
+------------+
| 10         |
+------------+
```

2. 从一组时间类型数据中找出最小值：

```sql
SELECT min(col) FROM VALUES ('2023-01-01'), ('2022-12-31'), ('2023-02-01') AS tab(col);
+------------+
| `min`(col) |
+------------+
| 2022-12-31 |
+------------+
```

3. 从一组字符串类型数据中找出最小值：

```sql
SELECT min(col) FROM VALUES ('apple'), ('banana'), ('cherry') AS tab(col);
+------------+
| `min`(col) |
+------------+
| apple      |
+------------+
```

4. 使用 `DISTINCT` 关键字从一组数值中找出最小值（对结果无影响）：

```sql
SELECT min(DISTINCT col) FROM VALUES (10), (50), (20), (NULL), (10), (20) AS tab(col);
+---------------------+
| `min`(DISTINCT col) |
+---------------------+
| 10                  |
+---------------------+
```

5. 使用 FILTER 子句条件性地找出最小值：

```sql
SELECT min(col) FILTER (WHERE col > 15) FROM VALUES (10), (20), (50), (NULL) AS tab(col);
+---------------------------------------+
| `min`(col) FILTER (WHERE (col > 15))  |
+---------------------------------------+
| 20                                    |
+---------------------------------------+
```

6. 结合 FILTER 子句和 DISTINCT 找出条件最小值：

```sql
SELECT min(DISTINCT col) FILTER (WHERE col < 50) FROM VALUES (10), (10), (20), (50) AS tab(col);
+------------------------------------------------------+
| `min`(DISTINCT col) FILTER (WHERE (col < 50))        |
+------------------------------------------------------+
| 10                                                   |
+------------------------------------------------------+
```

通过以上示例，您可以看到 `MIN` 函数在不同数据类型中的应用。请注意，`NULL` 值不参与计算。
