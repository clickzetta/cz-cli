### 总体标准差（STDDEV_POP）

```sql
stddev_pop([DISTINCT] expr) [FILTER (WHERE condition)]
```

#### 功能描述

`STDDEV_POP` 函数用于计算一组数值数据的总体标准差（Population Standard Deviation）。标准差是衡量数据分布离散程度的统计指标，用于表示数据集中的数值相对于平均值的偏离程度。

#### 参数说明

* `expr`: 需要计算标准差的数值类型数据，可以是 `TINYINT`、`SMALLINT`、`INT`、`BIGINT`、`FLOAT`、`DOUBLE` 或 `DECIMAL` 类型。
* `DISTINCT`: 可选参数，表示是否计算去重后的数据。若设置 `DISTINCT`，则函数只计算不重复数据的标准差。

#### 返回结果

* 返回一个 `DOUBLE` 类型的值，表示计算结果。
* 如果所有输入值均为 `NULL`，则返回 `NULL`。

#### 使用示例

**示例 1**：计算一组数值数据的总体标准差

```sql
SELECT stddev_pop(col) FROM VALUES (1), (2), (3), (3), (NULL) AS tab(col);
+-------------------+
| `stddev_pop`(col) |
+-------------------+
| 0.82915619758885  |
+-------------------+
```

**示例 2**：计算去重后的数值数据的总体标准差

```sql
SELECT stddev_pop(DISTINCT col) FROM VALUES (1), (2), (3), (3), (NULL) AS tab(col);
+----------------------------+
| `stddev_pop`(DISTINCT col) |
+----------------------------+
| 0.816496580927726          |
+----------------------------+
```

**示例 3**：使用 FILTER 子句有条件地计算总体标准差

```sql
SELECT stddev_pop(col) FILTER (WHERE col > 1) FROM VALUES (1), (2), (3), (4) AS tab(col);
+----------------------------------------------+
| `stddev_pop`(col) FILTER (WHERE (col > 1))   |
+----------------------------------------------+
| 0.816496580927726                            |
+----------------------------------------------+
```

**示例 4**：结合 FILTER 子句和 DISTINCT 计算有条件总体标准差

```sql
SELECT stddev_pop(DISTINCT col) FILTER (WHERE col <= 3) FROM VALUES (1), (2), (3), (3), (4) AS tab(col);
+-----------------------------------------------------------+
| `stddev_pop`(DISTINCT col) FILTER (WHERE (col <= 3))      |
+-----------------------------------------------------------+
| 0.816496580927726                                         |
+-----------------------------------------------------------+
```

通过以上示例，您可以根据实际需求灵活使用 `STDDEV_POP` 函数来计算数据集的总体标准差。
