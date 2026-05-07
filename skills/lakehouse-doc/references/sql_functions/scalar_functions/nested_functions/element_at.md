###  ELEMENT_AT
``` sql
element_at(array, index)
element_at(map, key)
```

#### 功能
对于array类型，返回array的第index个元素，下标以1开头
对于map类型，返回map的key所对应的value，如果key不存在，则返回NULL

#### 参数
* array: `array<T>`
* index: bigint
* map: `map<K, V>`
* key: K

#### 返回结果
* array根据入参推导：`T <- array<T>`
* map根据入参推导：`V <- map<K, V>`

#### 举例
```sql
> SELECT element_at(array(1, 2, 3), 2);
2

> SELECT try_element_at(array(1, 2, 3), 5);
NULL

> SELECT element_at(map(1, 'a', 2, 'b'), 2);
b

> SELECT element_at(map(1, 'a', 2, 'b'), 3);
NULL
```
