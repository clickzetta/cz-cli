### BITMAP_EMPTY 函数

```
bitmap_empty()
```

#### 功能描述

`BITMAP_EMPTY` 函数用于返回一个空的 bitmap。

#### 参数说明

* 无参数。

#### 返回类型

* 返回 `BITMAP` 类型，即一个不包含任何元素的空 bitmap。

#### 使用示例

1.  创建空 bitmap

    ```sql
SELECT bitmap_empty();
+----------------+
| bitmap_empty() |
+----------------+
| []             |
+----------------+
```

2.  计算空 bitmap 的元素个数

    ```sql
SELECT bitmap_cardinality(bitmap_empty());
+-----------------------------------+
| bitmap_cardinality(bitmap_empty())|
+-----------------------------------+
| 0                                 |
+-----------------------------------+
```

3.  将空 bitmap 转换为数组

    ```sql
SELECT bitmap_to_array(bitmap_empty());
+--------------------------------+
| bitmap_to_array(bitmap_empty())|
+--------------------------------+
| []                             |
+--------------------------------+
```
