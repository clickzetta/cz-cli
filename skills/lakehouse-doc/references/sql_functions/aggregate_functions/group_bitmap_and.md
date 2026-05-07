# GROUP_BITMAP_AND 函数

## 简介

`GROUP_BITMAP_AND` 函数用于计算一组 `Bitmap` 数据的按位与（`AND`）操作，并返回最终结果。该函数在处理大规模数据集时非常高效，尤其适用于需要对多个 `Bitmap` 进行交集操作的场景。它可以直接返回最终的 `Bitmap` 结果，而无需中间状态。

## 语法

```sql
group_bitmap_and(bitmap)
```

## 参数

- **`bitmap`**：`BITMAP` 类型的表达式，表示需要进行按位与操作的 `Bitmap` 数据。

## 返回值

返回一个 `INT` 类型的结果，表示所有输入 `Bitmap` 的按位与操作的结果。

## 使用示例

示例 1：计算多个 `Bitmap` 的按位与操作

假设有一个数据表 `t`，其中包含列 `v`，存储了多个数组。现在需要计算这些数组的按位与操作的结果。

```sql
SELECT group_bitmap_and(bitmap_build(v)) AS res
FROM VALUES
  (ARRAY(1,2,3,4,5,6,7,8,9,10)),
  (ARRAY(6,7,8,9,10,11,12,13,14,15)),
  (ARRAY(2,4,6,8,10,12))
AS t(v);
+-----+
| res |
+-----+
| 3   |
+-----+
```

## 相关函数

- **`group_bitmap_and_state`**：返回按位与操作的中间状态，适用于需要分步计算的场景。
- **`group_bitmap_merge`**：合并多个中间状态的 `Bitmap` 对象。
- **`bitmap_and`**：对两个 `Bitmap` 进行按位与操作。
- **`bitmap_to_array`**：将 `Bitmap` 转换为数组形式，便于查看结果。
