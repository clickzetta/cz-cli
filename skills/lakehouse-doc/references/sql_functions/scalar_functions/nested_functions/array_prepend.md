### ARRAY_PREPEND
```sql
array_prepend(array, element)
```

#### 功能
在数组开头插入一个元素，返回新的数组

#### 参数
* array: `array<T>` - 输入的数组
* element: `T` - 要插入的元素

#### 返回结果
* `array<T>` - 在开头插入元素后的新数组

#### 举例
```sql
> SELECT array_prepend(array(1, 2, 3), 3);
[3,1,2,3]

> SELECT array_prepend(array(1, 2, 3), cast(null as int));
[null,1,2,3]

> SELECT array_prepend(cast(array() as array<int>), 1);
[1]
```
