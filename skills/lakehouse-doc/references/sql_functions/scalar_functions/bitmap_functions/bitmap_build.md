### BITMAP_BUILD 函数

#### 概述
`bitmap_build` 函数用于从整数类型的数组表达式（expr）构建 bitmap 类型。该函数接受一个数组作为输入，并返回一个 bitmap 类型的结果。

#### 语法
```
bitmap_build(expr)
```

#### 参数
- `expr`: `array<T>` 类型，其中 T 是整数类型。

#### 返回值
- 返回一个 bitmap 类型的结果。

#### 使用示例
1. 从包含整数 1、2、3 的数组构建 bitmap 类型：
   ```sql
   SELECT bitmap_build(array(1, 2, 3));
   ```
   结果将以数组形式展示，但实际上是一个 bitmap 类型：
   ```
   [1,2,3]
   ```
   
2. 将上述结果转换回数组形式以验证其内容：
   ```sql
   SELECT bitmap_to_array(bitmap_build(array(1, 2, 3)));
   ```
   结果将显示为数组形式：
   ```
   [1,2,3]
   ```

3. 构建一个包含多个连续整数的 bitmap 类型：
   ```sql
   SELECT bitmap_build(array(1, 2, 3, 4, 5));
   ```
   结果将展示为：
   ```
   [1,2,3,4,5]
   ```

4. 从包含负整数和零值的数组构建 bitmap 类型：
   ```sql
   SELECT bitmap_build(array(-1, 0, 2, -3));
   ```
   结果将展示为：
   ```
   [-1, 0, 2, -3]
   ```

#### 注意事项
- 客户端不支持直接打印 bitmap 类型的结果，如果直接查看 bitmap 结果会报错，因此在实际使用中如需显示，需要使用 bitmap_to_array 函数将其转化为 array。
- 当处理大型数据集时，bitmap 类型可以提高查询性能，因为它占用的内存空间相对较小。

通过以上示例和说明，您可以更好地理解如何使用 `bitmap_build` 函数从整数数组构建 bitmap 类型，并在实际应用中发挥其优势。