### VARIANCE 函数

```
variance([DISTINCT] expr)
```

#### 功能描述

`VARIANCE` 函数是 `VAR_SAMP` 的别名，用于计算一组数值数据的样本方差。方差是衡量数据分布离散程度的统计量，它可以反映数据的波动性大小。

#### 参数说明

* `expr`：数值类型，可以是 `TINYINT`、`SMALLINT`、`INT`、`BIGINT`、`FLOAT`、`DOUBLE` 或 `DECIMAL` 类型。
* `DISTINCT`（可选）：表示计算去重后的集合方差。如果不设置该参数，则计算包含重复值的集合方差。

#### 返回类型

* 返回 `DOUBLE` 类型的数值，表示计算得到的样本方差。

#### 注意事项

* 如果传入的参数包含 `NULL` 值，则 `NULL` 值不参与计算。
* `VARIANCE` 函数与 `VAR_SAMP` 函数完全相同，可以互换使用。

#### 使用示例

1. 计算包含重复值的样本方差

```sql
SELECT variance(col) FROM VALUES (1), (2), (3), (3), (NULL) AS tab(col);
+--------------------+
| `variance`(col)    |
+--------------------+
| 0.9166666666666666 |
+--------------------+
```

2. 计算去重后的样本方差

```sql
SELECT variance(DISTINCT col) FROM VALUES (1), (2), (3), (3), (NULL) AS tab(col);
+--------------------------+
| `variance`(DISTINCT col) |
+--------------------------+
| 1.0                      |
+--------------------------+
```
