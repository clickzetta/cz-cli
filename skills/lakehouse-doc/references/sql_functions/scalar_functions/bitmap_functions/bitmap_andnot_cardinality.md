### BITMAP_ANDNOT_CARDINALITY 函数


#### 功能描述
BITMAP_ANDNOT_CARDINALITY 函数用于计算两个 bitmap 类型参数的集合差（即 ANDNOT 操作），并返回结果 bitmap 中元素的数量。该函数在处理大规模数据集时，能够高效地进行集合操作，尤其适用于需要快速计算集合之间关系的场景。

#### 函数语法
```
bitmap_andnot_cardinality(left, right)
```
* left: 第一个 bitmap 参数。
* right: 第二个 bitmap 参数。

#### 返回类型
返回一个 bigint 类型的值，表示结果 bitmap 中元素的数量。

#### 使用示例
以下示例展示了如何使用 BITMAP_ANDNOT_CARDINALITY 函数来计算两个 bitmap 的集合差，并获取结果中元素的数量。

**示例 1**：计算两个简单 bitmap 的集合差
```sql
SELECT bitmap_andnot_cardinality(
    bitmap_build(array(1, 2, 3)),
    bitmap_build(array(2, 3, 4))
);
```
结果：
```
1
```
在这个例子中，第一个 bitmap 包含元素 1、2 和 3，第二个 bitmap 包含元素 2、3 和 4。集合差操作后，结果 bitmap 只包含第一个 bitmap 中存在但第二个 bitmap 中不存在的元素，即只包含元素 1，因此结果为 1。

**示例 2**：在实际数据表中应用 BITMAP_ANDNOT_CARDINALITY 函数
假设我们有一个名为 `orders` 的数据表，其中包含以下列：`order_id`、`customer_id` 和 `order_date`。我们想要找出在特定日期范围内，某个特定客户没有下过的订单数量。

```sql
SELECT customer_id,
       bitmap_andnot_cardinality(
           bitmap_union(
               -- 构建特定日期范围内所有订单的 bitmap
               SELECT bitmap_or(
                   bitmap_build(
                       -- 提取每个订单的 customer_id
                       array_agg(DISTINCT order_id)
                   ) FROM orders
                   WHERE order_date BETWEEN '2022-01-01' AND '2022-01-31'
               )
           ),
           -- 构建特定客户所有订单的 bitmap
           bitmap_build(
               array_agg(DISTINCT order_id)
           ) FROM orders
           WHERE customer_id = 12345
       ) AS orders_count
FROM orders
WHERE order_date BETWEEN '2022-01-01' AND '2022-01-31'
GROUP BY customer_id;
```
在这个例子中，我们首先使用 `bitmap_union` 函数来构建特定日期范围内所有订单的 bitmap。然后，我们使用 `bitmap_build` 函数来构建特定客户所有订单的 bitmap。最后，我们使用 BITMAP_ANDNOT_CARDINALITY 函数来计算这两个 bitmap 的集合差，并返回结果中元素的数量，即该客户在特定日期范围内没有下过的订单数量。

