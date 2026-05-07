# GROUP_BITMAP_AND_STATE 函数

## 简介

`GROUP_BITMAP_AND_STATE` 函数用于计算一组 `Bitmap` 数据的按位与（`AND`）操作，并返回中间状态。该函数在处理大规模数据集时非常高效，尤其适用于需要对多个 `Bitmap` 进行交集操作的场景。返回的中间状态可以用于后续的合并操作，从而实现更复杂的聚合逻辑。

## 语法

```sql
group_bitmap_and_state(bitmap)
```

## 参数

- **`bitmap`**：`BITMAP` 类型的表达式，表示需要进行按位与操作的 `Bitmap` 数据。

## 返回值

返回一个中间状态的 `BITMAP` 对象，表示按位与操作的中间结果。该中间状态可以用于后续的合并操作。

## 使用示例

示例 1：使用 `bitmap_to_array` 查看结果

假设有一个数据表 `t`，其中包含列 `v`，存储了多个数组。现在需要计算这些数组的按位与操作的结果，并将其转换为数组形式以便查看。

```sql
SELECT bitmap_to_array(group_bitmap_and_state(bitmap_build(v))) AS res
FROM VALUES (ARRAY(1, 2)), (ARRAY(1, 2)), (ARRAY(1)) AS t(v);
+-----+
| res |
+-----+
| [1] |
+-----+
```

## 注意事项

1. **输入类型**：请确保输入的 `bitmap` 是 `BITMAP` 类型，否则会导致函数执行失败。
2. **中间状态的使用**：返回的中间状态可以用于后续的合并操作，从而实现更复杂的聚合逻辑。
3. **性能优化**：在处理大规模数据集时，`group_bitmap_and_state` 函数非常高效。但如果数据量过大，仍需注意性能影响。在可能的情况下，可尝试优化输入数据以提高函数执行效率。
## 相关函数

- **`group_bitmap_and`**：直接计算按位与操作的最终结果。
- **`group_bitmap_merge`**：合并多个中间状态的 `Bitmap` 对象。
- **`bitmap_and`**：对两个 `Bitmap` 进行按位与操作。
- **`bitmap_to_array`**：将 `Bitmap` 转换为数组形式，便于查看结果。
