### BITMAP_TO_STRING 函数

```
bitmap_to_string(bitmap)
```

#### 功能描述

`BITMAP_TO_STRING` 函数用于将 bitmap 转换为逗号分隔的字符串。

#### 参数说明

* `bitmap`：`BITMAP` 类型。

#### 返回类型

* 返回 `STRING` 类型，bitmap 中的元素以逗号分隔的字符串表示。

#### 使用示例

1. 将 bitmap 转换为字符串

```sql
SELECT bitmap_to_string(bitmap_build(array(1, 2)));
+-----------------------------------------------+
| bitmap_to_string(bitmap_build(array(1, 2)))   |
+-----------------------------------------------+
| 1,2                                           |
+-----------------------------------------------+
```

2. 转换包含多个元素的 bitmap

```sql
SELECT bitmap_to_string(bitmap_build(array(1, 3, 5)));
+--------------------------------------------------+
| bitmap_to_string(bitmap_build(array(1, 3, 5)))   |
+--------------------------------------------------+
| 1,3,5                                            |
+--------------------------------------------------+
```
