### BITMAP_MIN 函数

#### 概述
BITMAP_MIN 函数用于从输入的 bitmap 对象中找出最大的元素，并返回其值。该函数对于处理和分析 bitmap 类型数据非常有用。

#### 语法
```
bitmap_min(bitmap)
```

#### 参数
- bitmap：bitmap 类型，表示输入的 bitmap 对象。

#### 返回结果
- 返回一个 bigint 类型的值，表示输入 bitmap 中的最大元素。

#### 使用示例



1. 从包含多个元素的 bitmap 对象中查找最小元素：
```sql
SELECT bitmap_min(bitmap_build(array(1, 2, 3)));
```
结果：
```
1
```


#### 注意事项
- 如果输入的 bitmap 对象为空，BITMAP_MIN 函数将返回 0。
- BITMAP_MIN 函数仅适用于 bitmap 类型的数据。对于其他类型的数据，可能会导致错误或不正确的结果。
