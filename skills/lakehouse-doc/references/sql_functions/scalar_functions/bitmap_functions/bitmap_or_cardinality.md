# BITMAP_OR_CARDINALITY 函数

## 功能描述
`BITMAP_OR_CARDINALITY` 函数计算两个位图（bitmap）的逻辑"或"（disjunction）操作的基数（cardinality），即返回两个位图合并后唯一元素的数量。此函数对于确定两个集合合并后的总不同元素数非常有用，尤其是在处理大型数据集时，位图提供了一种高效的数据处理方式。

## 语法
```
BITMAP_OR_CARDINALITY(bitmap1, bitmap2)
```

## 参数说明
- **bitmap1**：第一个位图对象。
- **bitmap2**：第二个位图对象。

## 返回值
返回两个位图进行逻辑"或"操作后的基数，即合并后的唯一元素数量。

## 示例
以下示例展示了如何使用 `BITMAP_OR_CARDINALITY` 函数来计算两个位图合并后的基数：

```sql
SELECT bitmap_or_cardinality(bitmapBuild([1,2,3]), bitmapBuild([2,3,4])) AS result;
```

假设第一个位图包含元素 `[1, 2, 3]`，第二个位图包含元素 `[2, 3, 4]`。这两个位图的逻辑"或"操作将合并这些元素，去除重复项，结果为 `[1, 2, 3, 4]`。`BITMAP_OR_CARDINALITY` 函数计算这个结果位图中的唯一元素数量，返回结果为 `4`。


