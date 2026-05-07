### GROUP_BITMAP_MERGE_STATE 函数

#### 功能描述
`GROUP_BITMAP_MERGE_STATE` 函数用于对多个位图（`bitmap`）值进行合并操作，合并这些值并返回它们的并集。该函数特别适用于处理分类数据，能够高效地合并具有相同分类的位图表示，从而得到一个包含所有类别元素的位图。

#### 参数说明
- **`bitmap`**：输入参数，类型为位图（`BITMAP`）。指需要进行逻辑“或”操作的位图列的值。

#### 返回结果
函数返回一个位图类型的值，该值包含了输入参数中所有位图值的并集。

#### 使用示例
以下示例展示了如何使用 `GROUP_BITMAP_MERGE_STATE` 函数来计算位图的逻辑“或”运算结果，并进一步计算其基数（`cardinality`）：

```sql
SELECT c, bitmap_cardinality(GROUP_BITMAP_MERGE_STATE(bitmap_build(v))) AS b
FROM (
  VALUES ('a', ARRAY(1)), ('a', ARRAY(2)), ('a', ARRAY(2)), ('b', ARRAY(3)), ('b', NULL)
) AS t(c, v)
GROUP BY c;
+---+---+
| c | b |
+---+---+
| a | 2 |
| b | 1 |
+---+---+
```

在这个查询中，我们创建了一个包含分类 `c` 和与之对应的位图值 `v` 的表。然后，我们使用 `GROUP_BITMAP_MERGE_STATE` 函数对每个分类下的位图值进行合并。对于分类 `a`，合并后的位图包含了 `[1, 2]`；对于分类 `b`，合并后的位图包含了 `[3]`。最终，查询结果将显示每个分类的合并位图的基数。
