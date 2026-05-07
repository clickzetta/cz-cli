# GROUP_BITMAP_OR函数

## 简介

`GROUP_BITMAP_OR` 函数用于对一组 `Bitmap` 数据进行按位或（`OR`）操作，并返回最终结果。该函数在处理大规模数据集时非常高效，尤其适用于需要对多个 `Bitmap` 进行并集操作的场景。它可以直接返回最终的 `Bitmap` 结果，而无需中间状态。

## 语法

```sql
group_bitmap_or(bitmap)
```

## 参数

* `bitmap`：`BITMAP` 类型的表达式，表示需要进行按位或操作的 `Bitmap` 数据。

## 返回值

返回一个 `INT` 类型的结果，表示所有输入 `Bitmap` 的按位或操作的结果。

## 使用示例

### 示例 1：计算多个 `Bitmap` 的按位或操作

假设有一个数据表 `t`，其中包含列 `v`，存储了多个数组。现在需要计算这些数组的按位或操作的结果。

```sql
SELECT group_bitmap_or(bitmap_build(v)) AS res
FROM VALUES
  (ARRAY(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)),
  (ARRAY(6, 7, 8, 9, 10, 11, 12, 13, 14, 15)),
  (ARRAY(2, 4, 6, 8, 10, 12))
AS t(v);
+-----+
| res |
+-----+
| 15  |
+-----+
```

## 注意事项

1. **输入类型**：请确保输入的 `bitmap` 是 `BITMAP` 类型，否则会导致函数执行失败。
2. **客户端支持**：客户端可能不支持直接打印 `BITMAP` 类型的结果。如果需要查看结果，可以使用 `bitmap_to_array` 函数将 `Bitmap` 转换为数组形式。
