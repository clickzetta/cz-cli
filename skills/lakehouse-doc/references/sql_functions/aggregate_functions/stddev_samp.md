### 函数名称：STDDEV_SAMP（样本标准差）

```sql
stddev_samp([DISTINCT] expr) [FILTER (WHERE condition)]
```

#### 功能描述

`STDDEV_SAMP` 函数用于计算一组数值数据的样本标准差。标准差是衡量数据分散程度的统计指标，用于表示数据集中数值的离散程度。该函数可以处理包括 `TINYINT`、`SMALLINT`、`INT`、`BIGINT`、`FLOAT`、`DOUBLE` 和 `DECIMAL` 在内的多种数值类型。

#### 参数说明

* `expr`：数值类型的列或表达式，`TINYINT`、`SMALLINT`、`INT`、`BIGINT`、`FLOAT`、`DOUBLE` 或 `DECIMAL` 类型。
* `DISTINCT`：可选参数，当设置为 `DISTINCT` 时，函数将计算去重后的集合的标准差。如果未设置 `DISTINCT`，则计算包含重复值的集合的标准差。

#### 返回结果

* 返回 `DOUBLE` 类型的数值，表示数据集的样本标准差。
* 如果输入的数据集包含 `NULL` 值，`NULL` 值将不参与计算。

#### 使用示例

**示例 1：基本使用**

```sql
SELECT stddev_samp(col) FROM VALUES (1), (2), (3), (3), (NULL) AS tab(col);
+--------------------+
| `stddev_samp`(col) |
+--------------------+
| 0.9574271077563381 |
+--------------------+
```

**示例 2：使用 DISTINCT 关键字**

```sql
SELECT stddev_samp(DISTINCT col) FROM VALUES (1), (2), (3), (3), (NULL) AS tab(col);
+-----------------------------+
| `stddev_samp`(DISTINCT col) |
+-----------------------------+
| 1.0                         |
+-----------------------------+
```

**示例 3：使用 FILTER 子句条件性地计算样本标准差**

```sql
SELECT stddev_samp(col) FILTER (WHERE col > 1) FROM VALUES (1), (2), (3), (4) AS tab(col);
+-----------------------------------------------+
| `stddev_samp`(col) FILTER (WHERE (col > 1))   |
+-----------------------------------------------+
| 1.0                                           |
+-----------------------------------------------+
```

**示例 4：结合 FILTER 子句和 DISTINCT 计算条件样本标准差**

```sql
SELECT stddev_samp(DISTINCT col) FILTER (WHERE col <= 3) FROM VALUES (1), (2), (3), (3), (4) AS tab(col);
+------------------------------------------------------------+
| `stddev_samp`(DISTINCT col) FILTER (WHERE (col <= 3))      |
+------------------------------------------------------------+
| 1.0                                                        |
+------------------------------------------------------------+
```

通过以上示例，您可以更好地理解 `STDDEV_SAMP` 函数的使用方法和应用场景。在实际数据分析中，该函数可以帮助您快速评估数据的离散程度，从而为决策提供依据。
