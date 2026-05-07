# GROUP_BITMAP_MERGE 函数

## 简介

`GROUP_BITMAP_MERGE` 函数用于合并多个中间状态的 `Bitmap` 对象，最终返回合并后的基数。该函数在处理大规模数据集时非常高效，尤其适用于需要对多个 `Bitmap` 中间状态进行合并的场景。

## 语法

```sql
group_bitmap_merge(bitmap)
```

## 参数

* `bitmap`：`BITMAP` 类型的中间状态，表示需要合并的 `Bitmap` 状态。

## 返回值

返回一个 `INT` 类型的结果，表示合并后的 `Bitmap` 基数。

## 使用示例

假设需要合并由多个数组构建的 `Bitmap` 数据并返回基数：

```sql
SELECT group_bitmap_merge(bitmap_build(v)) AS res
FROM VALUES
  (ARRAY(1,2,3,4,5,6,7,8,9,10)),
  (ARRAY(6,7,8,9,10,11,12,13,14,15)),
  (ARRAY(2,4,6,8,10,12))
AS t(v);
+-----+
| res |
+-----+
| 15  |
+-----+
```
