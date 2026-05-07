###  MAP_FROM_ARRAYS
``` sql
map_from_arrays(k, v)
```

#### 功能
使用两个array创建map，map的key和value于参数array中的顺序意义对应。两个array的长度需要严格一致

#### 参数
* k: `array<K>`
* v: `array<V>`

#### 返回结果
`map<K, V>`

#### 举例
```sql
> select map_from_arrays(k, v)
  from values
      (array(1, 2, 3), array('a', 'b', 'c')),
      (array(1, 2, 3), array('a', NULL, 'c')),
      (null, array('a', 'b', 'c')),
      (array(1, 2, 3), null) as t(k, v) ;
{1:"a",2:"b",3:"c"}
{1:"a",2:null,3:"c"}
NULL
NULL
```