### 数组交集检查函数：arrays_overlap

#### 功能描述
`arrays_overlap` 函数用于检查两个数组是否存在至少一个共同的元素。具体来说，该函数有以下功能：
1. 如果两个数组 `array1` 和 `array2` 存在至少一个相同的元素，函数返回 `true`。
2. 如果两个数组都没有交集，但至少有一个数组包含 `null` 值，且两个数组都不为空，则函数返回 `null`。
3. 其他情况下，函数返回 `false`。

#### 参数说明
- `array1`, `array2`: 待比较的两个数组，类型为 `array<T>`，其中 `T` 可以是任意数据库支持的数据类型。

#### 返回类型
- 返回类型为 `boolean` 或 `null`。

#### 使用示例
1. 检查两个数组是否有交集：
```sql
SELECT arrays_overlap(array(1, 2, 3), array(3, 4, 5)); -- 返回 true
```
2. 当数组中包含 `null` 时的情况：
```sql
SELECT arrays_overlap(array(1, 2, 3), array(null, 4, 5)); -- 返回 null
```
3. 两个非空数组但没有交集的情况：
```sql
SELECT arrays_overlap(array(1, 2, 3), array(4, 5, 6)); -- 返回 false
```
4. 一个数组为空的情况：
```sql
SELECT arrays_overlap(array(), array(1, 2, 3)); -- 返回 false
```
5. 两个数组都为空的情况：
```sql
SELECT arrays_overlap(array(), array()); -- 返回 false
```


#### 注意事项
- 当使用 `arrays_overlap` 函数时，请注意数组元素的类型需要一致，否则可能会导致比较失败。
- 如果数组中包含 `null` 值，函数的行为会有所不同，这一点在使用时需要特别注意。

