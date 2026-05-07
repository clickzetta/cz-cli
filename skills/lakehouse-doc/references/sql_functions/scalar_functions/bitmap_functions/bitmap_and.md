### BITMAP_AND 函数

#### 功能描述
BITMAP_AND 函数用于计算两个 bitmap 类型数据的交集。该函数接受两个 bitmap 类型的参数，并返回一个新的 bitmap 类型结果，其中包含两个输入 bitmap 的共同元素。

#### 参数说明
* `left`：第一个 bitmap 类型参数。
* `right`：第二个 bitmap 类型参数。

#### 返回类型
返回一个 bitmap 类型的结果。

#### 使用示例
以下示例展示了如何使用 BITMAP_AND 函数计算两个 bitmap 类型数据的交集。

示例 1：
```sql
SELECT bitmap_and(bitmap_build(array(1, 2, 3)), bitmap_build(array(2, 3, 4)));
```
结果：
```plaintext
[2, 3] -- 结果按 array 形式演示，客户端支持 bitmap 类型打印,可以使用bitmap_to_array函数展示
```

示例 2：
```sql
SELECT bitmap_to_array(bitmap_and(bitmap_build(array(1, 2, 3, 5, 6)), bitmap_build(array(2, 3, 4, 6, 7))));
```
结果：
```plaintext
[2, 3, 6]
```



#### 注意事项
* BITMAP_AND 函数要求两个输入参数都是 bitmap 类型，否则会导致函数执行失败。
* 结果按 array 形式展示，但实际返回的是一个 bitmap 类型数据。客户端可能不支持直接打印 bitmap 类型数据，需要使用相应的转换函数（如 `bitmap_to_array`）将其转换为可打印的格式。
* 当输入的 bitmap 类型数据中的元素数量较大时，BITMAP_AND 函数的计算效率可能受到影响。在这种情况下，可以考虑使用其他数据类型或方法进行计算。