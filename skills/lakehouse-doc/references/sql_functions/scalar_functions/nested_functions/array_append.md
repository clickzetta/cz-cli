### ARRAY_APPEND
```sql
array_append(array, element)
```

#### 功能
在数组末尾追加一个元素，返回新的数组。

#### 参数
* `array`: `array<T>` - 输入的数组
* `element`: `T` - 要追加的元素

#### 返回结果
* `array<T>` - 追加元素后的新数组。

#### 举例
```sql
> SELECT array_append(array(1, 2, 3), 3);
[1,2,3,3]

> SELECT array_append(array(1, 2, 3), cast(null as int));
[1,2,3,null]

> SELECT array_append(cast(array() as array<int>), 1);
[1]
```
