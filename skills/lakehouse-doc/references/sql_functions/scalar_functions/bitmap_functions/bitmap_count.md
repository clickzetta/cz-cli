### BITMAP_COUNT 函数

```
bitmap_count(bitmap)
```

#### 功能描述

`BITMAP_COUNT` 函数用于求 bitmap 中元素个数，等价于 `BITMAP_CARDINALITY`。

#### 参数说明

* `bitmap`：`BITMAP` 类型。

#### 返回类型

* 返回 `BIGINT` 类型。

#### 注意事项

* 此函数是 `BITMAP_CARDINALITY` 的别名，两者功能完全相同。

#### 使用示例

1. 计算 bitmap 中元素个数

```sql
SELECT bitmap_count(bitmap_build(array(1, 2, 3)));
+----------------------------------------------+
| bitmap_count(bitmap_build(array(1, 2, 3)))   |
+----------------------------------------------+
| 3                                            |
+----------------------------------------------+
```

2. 计算更多元素的 bitmap

```sql
SELECT bitmap_count(bitmap_build(array(1, 2, 3, 4, 5)));
+----------------------------------------------------+
| bitmap_count(bitmap_build(array(1, 2, 3, 4, 5)))   |
+----------------------------------------------------+
| 5                                                  |
+----------------------------------------------------+
```
