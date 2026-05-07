### BITMAP_XOR_CARDINALITY 函数

#### 概述
`BITMAP_XOR_CARDINALITY` 函数用于计算两个 bitmap 类型参数进行集合异或 (XOR) 操作后，结果集中的元素数量。该函数在数据去重和集合运算中具有很高的效率。

#### 语法
```
bitmap_xor_cardinality(left, right)
```
#### 参数
- `left` 和 `right`：均为 bitmap 类型参数，表示要进行 XOR 运算的两个集合。

#### 返回结果
- 返回一个 bigint 类型的值，表示 XOR 运算结果集中的元素数量。

#### 使用示例
1.  计算两个简单集合的 XOR 运算结果的元素数量：
```sql
SELECT bitmap_xor_cardinality(bitmap_build(array(1, 2, 3)), bitmap_build(array(2, 3, 4)));
```
结果：
```
2
```
在这个例子中，集合 {1, 2, 3} 和集合 {2, 3, 4} 进行 XOR 运算后，结果集合为 {1, 4}，元素数量为 2。


#### 注意事项
- 确保输入参数为 bitmap 类型，否则会导致函数执行错误。
- 当处理大量数据时，请注意内存和性能的影响。