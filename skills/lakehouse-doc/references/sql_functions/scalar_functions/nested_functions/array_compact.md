### ARRAY_COMPACT
```sql
array_compact(array)
```

#### 功能
移除数组中的所有 null 值，返回不包含 null 的新数组

#### 参数
* array: `array<T>` - 输入的数组

#### 返回结果
* `array<T>` - 移除所有 null 元素后的新数组
* 如果数组中所有元素都是 null 或数组为空，则返回空数组 `[]`

#### 举例
```sql
> SELECT array_compact(array(null));
[]

> SELECT array_compact(array());
[]

> SELECT array_compact(array(1, 3, null, 4));
[1,3,4]

> SELECT array_compact(array(null, 3, null));
[3]
```
