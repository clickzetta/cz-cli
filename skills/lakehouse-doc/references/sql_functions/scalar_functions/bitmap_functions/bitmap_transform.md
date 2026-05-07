### BITMAP_TRANSFORM 函数

#### 概述
`BITMAP_TRANSFORM` 函数用于将一个 bitmap 类型数据中的指定元素（from_array）转换为另一组元素（to_array）。该函数要求输入的 from_array 和 to_array 参数长度相同，且仅支持 int 类型的区间数值。

#### 功能
通过该函数，您可以轻松地将一个 bitmap 中的元素进行替换或转换。例如，您可以将一个包含特定数字的 bitmap 转换为包含另一组数字的 bitmap，从而实现数据的快速转换和处理。

#### 参数说明
* `bitmap`: 输入的 bitmap 类型数据。
* `from_array`: 一个包含要被替换的元素的数组，元素类型为 bigint。
* `to_array`: 一个包含用于替换 from_array 中元素的目标元素的数组，元素类型为 bigint。

#### 返回结果
返回一个新的 bitmap 类型数据，其中 from_array 中的元素已被替换为 to_array 中的元素。

#### 使用示例
1. 将 bitmap 中的元素 1 替换为 100，元素 2 替换为 200，元素 3 替换为 300。
   ```sql
   SELECT bitmap_transform(bitmap_build(array(1, 2, 3)), array(1, 2, 3), array(100, 200, 300));
   ```
   返回结果：`[100, 200, 300]`

2. 将 bitmap 中的元素 5 替换为 10，元素 10 替换为 20。
   ```sql
   SELECT bitmap_transform(bitmap_build(array(5, 10, 15, 20)), array(5, 10), array(10, 20));
   ```
   返回结果：`[ 15, 20]`

3. 将 bitmap 中的元素 3 替换为 5，元素 7 替换为 9。
   ```sql
   SELECT bitmap_transform(bitmap_build(array(1, 3, 7, 8, 9)), array(3, 7), array(5, 9));
   ```
   返回结果：`[1, 5, 9, 8, 9]`

#### 注意事项
- 客户端不支持直接打印 bitmap 类型的结果，如果直接查看bitmap结果会报错，因此在实际使用中如果要屏显需要使用bitmap_to_array转化成array。
* 确保输入的 from_array 和 to_array 参数长度相同，否则函数将无法执行。
* 目前该函数仅支持 int 类型的区间数值，其他数据类型的替换转换需使用其他方法。
* 在执行替换操作时，请确保目标数组中的元素不会导致 bitmap 的重复或冲突。

通过以上示例和说明，您可以更好地理解和使用 `BITMAP_TRANSFORM` 函数，从而实现 bitmap 数据的快速转换和处理。