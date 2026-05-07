### ANY_VALUE 函数
```
any_value(expr) [FILTER (WHERE condition)]
```
#### 功能描述
`ANY_VALUE` 函数用于从一组数据中随机选择并返回一个值。当处理多个数据行时，此函数可以简化查询并提高效率。

#### 参数说明
* `expr`：任何数值类型（如 `TINYINT`、`SMALLINT`、`INT`、`BIGINT`、`FLOAT`、`DOUBLE`、`DECIMAL`）或字符串类型（如 `STRING`、`CHAR`、`VARCHAR`）或复杂类型的表达式。

#### 返回结果
* 返回与输入参数 `expr` 类型相同的值。
* 如果输入参数中包含 `NULL` 值，`NULL` 值也会被计算在内。

#### 使用示例
1. 从一组整数中随机选择一个值：
```sql
SELECT any_value(col) FROM VALUES (1), (2), (3), (4), (NULL) AS tab(col);
+------------------+
| any_value(`col`) |
+------------------+
| 1                |
+------------------+
```

2. 从一组字符串中随机选择一个值：
```sql
SELECT any_value(col) FROM VALUES ('apple'), ('banana'), ('cherry') AS tab(col);
+------------------+
| any_value(`col`) |
+------------------+
| apple            |
+------------------+
```

3. 在复杂的查询中使用 `ANY_VALUE` 函数：
```sql
SELECT any_value(city) FROM customers WHERE country = 'China';
+--------------------+
| any_value(`city`)  |
+--------------------+
| Beijing            |
+--------------------+
```

4. 从包含 `NULL` 值的数据中随机选择一个值：
```sql
SELECT any_value(col) FROM VALUES (CAST(NULL AS INT)), (5), (6) AS tab(col);
+------------------+
| any_value(`col`) |
+------------------+
| 5                |
+------------------+
```

5. 使用 FILTER 子句条件性地选择值：
```sql
SELECT any_value(col) FILTER (WHERE col > 2) FROM VALUES (1), (2), (3), (4) AS tab(col);
+-------------------------------------------+
| any_value(`col`) FILTER (WHERE (col > 2)) |
+-------------------------------------------+
| 3                                         |
+-------------------------------------------+
```
