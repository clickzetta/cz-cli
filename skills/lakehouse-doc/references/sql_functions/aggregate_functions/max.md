### MAX 函数

```
max([DISTINCT] expr) [FILTER (WHERE condition)]
```

#### 功能描述

`MAX` 函数用于从一组数据中找出最大值。该函数适用于多种数据类型，包括数值型、时间型和字符串型等。

#### 参数说明

* `expr`: 可比较的数据类型，支持的类型包括：
  * 数值类型：`TINYINT`、`SMALLINT`、`INT`、`BIGINT`、`FLOAT`、`DOUBLE` 和 `DECIMAL`；
  * 时间类型：`DATE` 和 `TIMESTAMP`；
  * 字符串类型：`CHAR`、`VARCHAR`、`STRING` 和 `BINARY`。
* `DISTINCT`: 可选参数，用于指定是否去除重复值。若设置 `DISTINCT`，则返回去重后的集合中的最大值。注意，对于数值型数据，`DISTINCT` 并不会对结果产生影响。

#### 返回值

* 返回值的类型与输入参数 `expr` 的类型相同。
* 如果输入参数中包含 `NULL` 值，则这些值不会参与计算。
* 设置 `DISTINCT` 参数不会影响数值型数据的结果。

#### 使用示例

1. 求数值型数据的最大值：

```sql
SELECT max(col) FROM VALUES (10), (50), (20), (NULL) AS tab(col);
+------------+
| `max`(col) |
+------------+
| 50         |
+------------+
```

2. 求时间型数据的最大值：

```sql
SELECT max(col) FROM VALUES ('2023-01-01'), ('2022-12-31'), ('2023-02-01') AS tab(col);
+------------+
| `max`(col) |
+------------+
| 2023-02-01 |
+------------+
```

3. 求字符串型数据的最大值：

```sql
SELECT max(col) FROM VALUES ('apple'), ('banana'), ('cherry') AS tab(col);
+------------+
| `max`(col) |
+------------+
| cherry     |
+------------+
```

4. 使用 `DISTINCT` 参数求数值型数据的最大值（对结果无影响）：

```sql
SELECT max(DISTINCT col) FROM VALUES (10), (50), (20), (NULL), (10) AS tab(col);
+---------------------+
| `max`(DISTINCT col) |
+---------------------+
| 50                  |
+---------------------+
```

5. 使用 `DISTINCT` 参数求字符串型数据的最大值：

```sql
SELECT max(DISTINCT col) FROM VALUES ('apple'), ('banana'), ('cherry'), ('apple') AS tab(col);
+---------------------+
| `max`(DISTINCT col) |
+---------------------+
| cherry              |
+---------------------+
```

6. 使用 FILTER 子句条件性地找出最大值：

```sql
SELECT max(col) FILTER (WHERE col < 40) FROM VALUES (10), (20), (50), (NULL) AS tab(col);
+---------------------------------------+
| `max`(col) FILTER (WHERE (col < 40))  |
+---------------------------------------+
| 20                                    |
+---------------------------------------+
```

7. 结合 FILTER 子句和 DISTINCT 找出条件最大值：

```sql
SELECT max(DISTINCT col) FILTER (WHERE col != 'cherry') FROM VALUES ('apple'), ('banana'), ('cherry'), ('apple') AS tab(col);
+--------------------------------------------------------------+
| `max`(DISTINCT col) FILTER (WHERE (NOT (col = 'cherry')))    |
+--------------------------------------------------------------+
| banana                                                       |
+--------------------------------------------------------------+
```
