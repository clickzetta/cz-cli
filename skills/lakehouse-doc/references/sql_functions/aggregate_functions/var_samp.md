### 函数名称：VAR_SAMP

```sql
var_samp([DISTINCT] expr) [FILTER (WHERE condition)]
```

#### 功能描述

`VAR_SAMP` 函数用于计算一组数值数据的样本方差。方差是衡量数据分布离散程度的统计量，它可以反映数据的波动性大小。通过计算方差，我们可以了解数据的波动范围和变化趋势。

#### 参数说明

* `expr`：数值类型,可以是 `TINYINT`、`SMALLINT`、`INT`、`BIGINT`、`FLOAT`、`DOUBLE` 或 `DECIMAL` 类型。
* `DISTINCT`（可选）：表示计算去重后的集合方差。如果不设置该参数,则计算包含重复值的集合方差。

#### 返回结果

* 返回 `DOUBLE` 类型的数值,表示计算得到的样本方差。
* 如果传入的参数包含 `NULL` 值,则 `NULL` 值不参与计算。

#### 使用示例

1. 计算包含重复值的样本方差：

```sql
SELECT var_samp(col) FROM VALUES (1), (2), (3), (3), (NULL) AS tab(col);
+--------------------+
|  `var_samp`(col)   |
+--------------------+
| 0.9166666666666666 |
+--------------------+
```

2. 计算去重后的样本方差：

```sql
SELECT var_samp(DISTINCT col) FROM VALUES (1), (2), (3), (3), (NULL) AS tab(col);
+--------------------------+
| `var_samp`(DISTINCT col) |
+--------------------------+
| 1.0                      |
+--------------------------+
```

3. 使用 FILTER 子句条件性地计算样本方差：

```sql
SELECT var_samp(col) FILTER (WHERE col > 1) FROM VALUES (1), (2), (3), (4) AS tab(col);
+--------------------------------------------+
| `var_samp`(col) FILTER (WHERE (col > 1))   |
+--------------------------------------------+
| 1.0                                        |
+--------------------------------------------+
```

4. 结合 FILTER 子句和 DISTINCT 计算条件样本方差：

```sql
SELECT var_samp(DISTINCT col) FILTER (WHERE col <= 3) FROM VALUES (1), (2), (3), (3), (4) AS tab(col);
+-------------------------------------------------------+
| `var_samp`(DISTINCT col) FILTER (WHERE (col <= 3))    |
+-------------------------------------------------------+
| 1.0                                                   |
+-------------------------------------------------------+
```
