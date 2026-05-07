### BITMAP_XOR 函数


`bitmap_xor` 函数用于对两个 bitmap 类型的数据进行集合异或（XOR）运算。该函数在处理集合数据时非常有用，特别是在需要从两个集合中找出不同元素的场景。

### 语法
```
bitmap_xor(left, right)
```

### 参数
* `left` 和 `right`：输入的 bitmap 类型数据。

### 返回结果
返回一个 bitmap 类型的结果，其中包含两个输入 bitmap 进行异或运算后的结果。

### 使用示例
以下示例展示了如何使用 `bitmap_xor` 函数来处理不同的 bitmap 数据。

**示例 1**：对两个简单的 bitmap 数据进行异或运算。
```sql
SELECT bitmap_xor(bitmap_build(array(1, 2, 3)), bitmap_build(array(2, 3, 4)));
```
结果：
```
[1, 4] -- 结果以 array 形式展示，实际客户端可能不支持 bitmap 类型打印
```

**示例 2**：使用 `bitmap_to_array` 函数将结果转换为数组形式以便查看。
```sql
SELECT bitmap_to_array(bitmap_xor(bitmap_build(array(1, 2, 3)), bitmap_build(array(2, 3, 4))));
```
结果：
```
[1, 4]
```

**示例 3**：对包含重复元素的两个 bitmap 进行异或运算。
```sql

```
结果：
```
[1, 4]
```

**示例 4**：对包含负数的两个 bitmap 进行异或运算。
```sql
SELECT bitmap_xor(bitmap_build(array(-1, -2, -3)), bitmap_build(array(-2, -4, -3)));
```
结果：
```
[-1, -4]
```

### 注意事项
* 请确保输入的两个参数都是 bitmap 类型，否则会导致函数执行失败。
* 客户端不支持直接打印 bitmap 类型的结果，如果直接查看 bitmap 结果会报错，因此在实际使用中如果要屏显需要使用 `bitmap_to_array` 转化成 array。
* 当处理大型数据集时，请注意性能影响。在可能的情况下，尝试优化输入数据以提高函数执行效率。