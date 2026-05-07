### 数组降序排序函数：ARRAY_SORT_REVERSE

#### 功能描述
`ARRAY_SORT_REVERSE` 函数用于对输入的数组进行降序排序。该函数接受一个数组作为参数，并返回一个新的、按照元素值从大到小排列的数组。

#### 参数说明
- `array`: 输入参数，类型为 `array<T>`，表示需要进行排序的数组。

#### 返回结果
返回一个类型为 `array<T>` 的新数组，其元素按照降序排列。

#### 使用示例
1. 对整数数组进行降序排序：
   ```sql
   SELECT array_sort_reverse(array(2, 1, 3));
   -- 结果：[3, 2, 1]
   ```
2. 对浮点数数组进行降序排序：
   ```sql
   SELECT array_sort_reverse(array(1.5, 3.2, 2.8));
   -- 结果：[3.2, 2.8, 1.5]
   ```
3. 对字符串数组按照字符串的字典顺序进行降序排序：
   ```sql
   SELECT array_sort_reverse(array('banana', 'apple', 'cherry'));
   -- 结果：['cherry', 'banana', 'apple']
   ```

#### 注意事项
- 输入数组中的元素类型必须一致。
- 该函数对数组中的 `NULL` 值敏感，`NULL` 值会被放置在返回数组的末尾。
