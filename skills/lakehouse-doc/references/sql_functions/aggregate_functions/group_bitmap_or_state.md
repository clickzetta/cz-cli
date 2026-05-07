# GROUP_BITMAP_OR_STATE 函数

## 简介

`GROUP_BITMAP_OR_STATE` 函数用于对一组 `Bitmap` 数据进行按位或（`OR`）操作，并返回中间状态的 `bitmap`。该函数在处理大规模数据集时非常高效，尤其适用于需要对多个 `Bitmap` 进行并集操作的场景。返回的中间状态可以用于后续的合并操作，从而实现更复杂的聚合逻辑。

## 语法

```sql
group_bitmap_or_state(bitmap)
```

## 参数

* `bitmap`：`BITMAP` 类型的表达式，表示需要进行按位或操作的 `Bitmap` 数据。

## 返回值

返回一个中间状态的 `BITMAP` 对象，表示按位或操作的中间结果。该中间状态可以用于后续的合并操作。

## 使用示例

示例 1：基本用法

```sql
SELECT bitmap_to_array(group_bitmap_or_state(bitmap_build(v))) AS res
FROM VALUES
  (ARRAY(1, 2, 3)),
  (ARRAY(1, 2)),
  (ARRAY(1))
AS t(v);
+---------+
|   res   |
+---------+
| [1,2,3] |
+---------+
```

**结果**：
返回一个中间状态的 `Bitmap` 对象，表示按位或操作的中间结果。

示例 2：与 `group_bitmap_merge` 结合使用

`group_bitmap_merge` 函数用于合并多个中间状态的 `Bitmap` 对象，最终生成一个完整的 `Bitmap`。

```sql
SELECT group_bitmap_merge(or_state) AS final_bitmap
FROM (
  SELECT group_bitmap_or_state(bitmap_build(v)) AS or_state
  FROM VALUES
    (ARRAY(1, 2, 3)),
    (ARRAY(1, 2)),
    (ARRAY(1))
  AS t(v)
);
+--------------+
| final_bitmap |
+--------------+
| 3            |
+--------------+
```

**结果**：
返回一个完整的 `Bitmap`，表示所有输入 `Bitmap` 的按位或操作的结果。
