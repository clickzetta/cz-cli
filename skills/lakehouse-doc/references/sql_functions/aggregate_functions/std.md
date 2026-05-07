### STD 函数

```
std([DISTINCT] expr)
```

#### 功能描述

`STD` 函数是 `STDDEV_SAMP` 的别名，用于计算一组数值数据的样本标准差。标准差是衡量数据分散程度的统计指标，用于表示数据集中数值的离散程度。

#### 参数说明

* `expr`：数值类型的列或表达式，可以是 `TINYINT`、`SMALLINT`、`INT`、`BIGINT`、`FLOAT`、`DOUBLE` 或 `DECIMAL` 类型。
* `DISTINCT`：可选参数，当设置为 `DISTINCT` 时，函数将计算去重后的集合的标准差。如果未设置 `DISTINCT`，则计算包含重复值的集合的标准差。

#### 返回类型

* 返回 `DOUBLE` 类型的数值，表示数据集的样本标准差。

#### 注意事项

* 如果输入的数据集包含 `NULL` 值，`NULL` 值将不参与计算。
* `STD` 函数与 `STDDEV_SAMP` 函数完全相同，可以互换使用。

#### 使用示例

1. 基本使用

```sql
SELECT std(col) FROM VALUES (1), (2), (3), (3), (NULL) AS tab(col);
+--------------------+
| `std`(col)         |
+--------------------+
| 0.9574271077563381 |
+--------------------+
```

2. 使用 DISTINCT 关键字

```sql
SELECT std(DISTINCT col) FROM VALUES (1), (2), (3), (3), (NULL) AS tab(col);
+----------------------+
| `std`(DISTINCT col)  |
+----------------------+
| 1.0                  |
+----------------------+
```
