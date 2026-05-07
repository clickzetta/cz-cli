### 函数名称：approx_count_distinct

```
approx_count_distinct(expr)
```

#### 功能描述
`approx_count_distinct` 函数采用 `hyperloglog` 算法来近似计算指定列中不同值的数量。当数据集较大时，该函数能够在保证较高性能的同时，得到一个近似的基数估计。需要注意的是，该函数在计算过程中会存在一定的误差。

#### 参数说明
* `expr`: 需要计算基数的列名，可以是数值类型、浮点类型、字符串类型、时间类型、布尔类型、`DECIMAL`、`BINARY` 等基本数据类型。`expr` 可以是单个列名，也可以是表达式或函数的组合。

#### 返回结果
* 返回值类型为 `BIGINT` 类型，表示近似计算出的基数。
* 如果 `expr` 中包含 `NULL` 值，这些值将不会被计算在内。

#### 使用示例

**示例 1：**
```sql
SELECT approx_count_distinct(col) FROM VALUES (1), (1), (2), (2), (3), (NULL) AS tab(col);
+-----------------------------+
| approx_count_distinct(col)  |
+-----------------------------+
| 3                           |
+-----------------------------+
```

**示例 2：**
假设我们有一个名为 `sales` 的表，其中包含以下列：`product_id`（产品ID）、`sale_date`（销售日期）和 `quantity`（数量）。我们想要计算在过去一个月内销售的不同产品的数量，可以使用以下查询：
```sql
SELECT approx_count_distinct(product_id)
FROM sales
WHERE sale_date >= NOW() - INTERVAL '1 MONTH';
```
这将返回过去一个月内销售的不同产品数量的近似值。

**示例 3：**
如果我们想要计算某个特定类别下销售的不同产品数量，可以结合使用 `approx_count_distinct` 函数和其他条件，如下所示：
```sql
SELECT approx_count_distinct(product_id)
FROM sales
WHERE category = 'Electronics' AND sale_date >= NOW() - INTERVAL '1 MONTH';
```
这将返回过去一个月内在电子产品类别下销售的不同产品数量的近似值。
