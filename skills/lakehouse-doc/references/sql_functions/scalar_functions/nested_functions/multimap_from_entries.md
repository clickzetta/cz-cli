###  MULTIMAP_FROM_ENTRIES
``` sql
multimap_from_entries(array)
```

#### 功能
从 array 中创建 multimap（一个键可以对应多个值的 map）， array 格式参考 map_entries 函数。
与 map_from_entries 不同的是，当存在重复的键时，multimap_from_entries 会将所有对应的值聚合到一个数组中，而不是报错或覆盖。

#### 参数
* array: `array<struct<key:K, value:V>>`

#### 返回结果
`map<K, array<V>>`

#### 举例
```sql
-- 基本用法：将重复键的值聚合到数组中
> select multimap_from_entries(array(struct(1, 'a'), struct(2, 'b'), struct(1, 'c')));
{1:["a","c"],2:["b"]}

-- 所有键都唯一的情况
> select multimap_from_entries(array(struct(1, 'a'), struct(2, 'b'), struct(3, 'c')));
{1:["a"],2:["b"],3:["c"]}

-- 所有键都相同的情况
> select multimap_from_entries(array(struct(1, 'a'), struct(1, 'b'), struct(1, 'c')));
{1:["a","b","c"]}

-- 空数组
> select multimap_from_entries(array());
{}

-- 包含 null 值
> select multimap_from_entries(array(struct(1, 'a'), struct(2, null), struct(1, 'b')));
{1:["a","b"],2:[null]}

-- 使用字符串作为键
> select multimap_from_entries(array(struct('x', 1), struct('y', 2), struct('x', 3)));
{"x":[1,3],"y":[2]}
```

#### 注意事项
* 键不能为 null，否则会抛出异常
* 值可以为 null
* 保持键的第一次出现顺序

