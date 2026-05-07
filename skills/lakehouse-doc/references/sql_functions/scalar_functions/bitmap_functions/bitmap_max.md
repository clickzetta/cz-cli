### BITMAP_MAX 函数
#### 简介
BITMAP_MAX 函数用于从给定的 bitmap 类型数据中提取最大值。该函数对于处理一组整数范围非常有用，可以快速找到其中的最大值。

#### 语法
```
bitmap_max(bitmap)
```
#### 参数
- **bitmap**: 输入的 bitmap 类型数据。

#### 返回值
- 返回一个 bigint 类型的值，表示输入 bitmap 中的最大元素。

#### 使用示例
1. 从数组构建 bitmap 并找到最大值：
```
SELECT bitmap_max(bitmap_build(array(1, 2, 3, 4, 5)));
-- 输出结果：5
```

#### 注意事项
- 确保输入的 bitmap 数据不为空，否则函数将返回 NULL。
- BITMAP_MAX 函数适用于处理整数范围，对于非整数类型的数据可能无法正确返回结果。

通过以上示例和说明，您可以更好地理解 BITMAP_MAX 函数的用途和使用方法。在实际应用中，可以根据需要灵活运用该函数来处理各种 bitmap 类型数据。