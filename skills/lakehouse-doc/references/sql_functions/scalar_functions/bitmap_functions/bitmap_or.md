### BITMAP_OR 函数

---

#### 功能描述

BITMAP_OR 函数用于计算两个 bitmap 类型数据的集合并集（OR 运算）。该函数将两个 bitmap 输入作为参数，并返回一个新的 bitmap 结果，其中包含了两个输入 bitmap 中所有的非零值。

#### 语法格式

```
bitmap_or(left, right)
```

#### 参数说明

* **left**, **right**: 这两个参数都是 bitmap 类型，代表需要进行 OR 运算的两个集合。

#### 返回类型

函数返回一个 bitmap 类型的结果。

#### 使用示例

以下示例展示了如何使用 BITMAP_OR 函数：

1. **基础使用**  
   计算两个简单 bitmap 的 OR 集合：
   ```sql
   SELECT bitmap_or(bitmap_build(array(1, 2, 3)), bitmap_build(array(2, 3, 4)));
   ```
   预期结果：`[1, 2, 3, 4]` （结果以 array 形式展示，实际客户端可能不支持 bitmap 类型打印）

2. **结合数组函数使用**  
   使用 bitmap_or 函数处理数组，并转换结果为数组形式：
   ```sql
   SELECT bitmap_to_array(bitmap_or(bitmap_build(array(1, 2, 3)), bitmap_build(array(2, 3, 4))));
   ```
   预期结果：`[1, 2, 3, 4]`

3. **多集合运算**  
   对多个 bitmap 进行连续的 OR 运算：
   ```sql
   SELECT bitmap_to_array(bitmap_or(bitmap_or(bitmap_build(array(1, 2, 3)), bitmap_build(array(2, 3, 4))), bitmap_build(array(3, 4, 5))));
   ```
   预期结果：`[1, 2, 3, 4, 5]`

4. **处理空值**  
   当输入的 bitmap 之一为空时，结果将反映非空的 bitmap：
   ```sql
   SELECT bitmap_to_array(bitmap_or(bitmap_build(array(1, 2, 3)), NULL));
   ```
   预期结果：`[1, 2, 3]`

#### 注意事项
- 客户端不支持直接打印 bitmap 类型的结果，如果直接查看bitmap结果会报错，因此在实际使用中如果要屏显需要使用bitmap_to_array转化成array。
* BITMAP_OR 函数要求两个输入参数都是 bitmap 类型，否则将返回错误。
* 当处理大型数据集时，请注意内存使用情况，因为 bitmap 可能会占用较大的内存空间。


通过以上示例和说明，您可以更好地理解 BITMAP_OR 函数的用途和使用方法。在实际应用中，BITMAP_OR 函数可以有效地处理和分析 bitmap 类型数据，帮助您完成复杂的数据集合运算任务。