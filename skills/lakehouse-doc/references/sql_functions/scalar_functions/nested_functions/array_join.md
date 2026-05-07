### 数组连接函数：ARRAY_JOIN

#### 功能描述
`ARRAY_JOIN` 函数的主要作用是将一个字符串数组中的元素按照指定的分隔符连接成一个单一的字符串。如果数组中的元素存在 `NULL` 值，并且指定了 `nullReplacement` 参数，那么这些 `NULL` 值会被替换为该参数指定的字符串。如果没有提供 `nullReplacement` 参数，那么 `NULL` 值将不会被包含在最终的连接结果中。

#### 参数说明
* `array`: 输入的字符串数组，类型为 `array<string>`。
* `delimiter`: 用作数组元素之间的分隔符，类型为 `string`。
* `nullReplacement` (可选): 用于替换数组中 `NULL` 值的字符串，类型为 `string`。

#### 返回类型
返回一个字符串，包含了连接后的数组元素。

#### 示例
1.  不使用 `nullReplacement` 参数：
```sql
SELECT ARRAY_JOIN(ARRAY('apple', 'banana', 'cherry'), ', ');
```
结果：
```
apple, banana, cherry
```

2.  使用 `nullReplacement` 参数：
```sql
SELECT ARRAY_JOIN(ARRAY('apple', NULL, 'cherry'), ', ', 'missing');
```
结果：
```
apple, missing, cherry
```

3.  忽略 `NULL` 值：
```sql
SELECT ARRAY_JOIN(ARRAY('a', NULL, 'b', NULL), '-');
```
结果：
```
a-b
```

4.  处理包含所有 `NULL` 值的数组：
```sql
SELECT ARRAY_JOIN(ARRAY(NULL, NULL, NULL), ', ', 'N/A');
```
结果：
```
N/A, N/A, N/A 
```

通过以上示例，您可以看到 `ARRAY_JOIN` 函数在不同情况下的使用方式和结果。此函数在需要将多个字符串元素合并为一个字符串时非常有用，尤其是在处理包含 `NULL` 值的数组时，可以灵活地选择是否包含这些值或用其他字符串替换它们。