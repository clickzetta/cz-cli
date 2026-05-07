### 百分位数函数：PERCENTILE

```sql
percentile([DISTINCT] col, percentage[, frequency]) [FILTER (WHERE condition)]
```

#### 功能描述

百分位数函数 `PERCENTILE` 用于计算指定列中数值数据的百分位数。当数据按照升序排列时，该函数返回位于指定百分比位置的数值。

#### 参数说明

* `col`：需要计算百分位数的列，数据类型为数值类型，包括 `TINYINT`、`SMALLINT`、`INT`、`BIGINT`、`FLOAT`、`DOUBLE` 和 `DECIMAL`。
* `percentage`：表示需要计算的百分位数，其数据类型为 `DOUBLE` 类型常量。取值范围应在 0.0 到 1.0 之间（包含）。
* `frequency`（可选）：表示每个数据行在计算中被计入的次数。数据类型为正整数。

#### 返回结果

该函数返回一个 `DOUBLE` 类型的数值，表示计算得到的百分位数。

若在函数中使用 `DISTINCT` 关键字，则表示计算去重后的数据集的百分位数。需要注意的是，`NULL` 值不参与计算。

#### 使用示例

以下为 `PERCENTILE` 函数的使用示例：

1. 计算非去重数据集的 30% 百分位数：

```sql
SELECT percentile(col, 0.3) FROM VALUES (0), (10), (10), (NULL) AS tab(col);
+------------------------+
| percentile(col, 0.3BD) |
+------------------------+
| 6.0                    |
+------------------------+
```

2. 计算去重数据集的 30% 百分位数：

```sql
SELECT percentile(DISTINCT col, 0.3) FROM VALUES (0), (10), (10), (NULL) AS tab(col);
+---------------------------------+
| percentile(DISTINCT col, 0.3BD) |
+---------------------------------+
| 3.0                             |
+---------------------------------+
```

3. 计算数据集中每个数据行被计入两次的 30% 百分位数：

```sql
SELECT percentile(col, 0.3, freq) FROM VALUES (0, 1), (10, 2) AS tab(col, freq);
+------------------------------+
| percentile(col, 0.3BD, freq) |
+------------------------------+
| 6.0                          |
+------------------------------+
```

4. 使用 FILTER 子句条件性地计算百分位数：

```sql
SELECT percentile(col, 0.5) FILTER (WHERE col > 5) FROM VALUES (0), (5), (10), (15), (20) AS tab(col);
+----------------------------------------------+
| percentile(col, 0.5BD) FILTER (WHERE (col > 5)) |
+----------------------------------------------+
| 12.5                                         |
+----------------------------------------------+
```
