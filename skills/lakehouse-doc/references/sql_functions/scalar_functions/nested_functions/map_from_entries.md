### MAP\_FROM\_ENTRIES 函数

#### 功能描述
`MAP_FROM_ENTRIES` 函数用于从数组中创建一个 map 类型。输入的数组元素需要符合 `map_entries` 函数的格式，即每个元素都是一个包含 `key` 和 `value` 属性的结构体。

#### 参数说明
* `array`: 输入参数，类型为 `array<struct<key:K, value:V>>`，表示包含多个结构体的数组，每个结构体具有 `key` 和 `value` 两个属性。

#### 返回结果
返回一个 `map<K, V>` 类型的结果，其中 `K` 表示 key 的类型，`V` 表示 value 的类型。

#### 使用示例
1. 创建一个包含两个元素的数组，每个元素都是一个结构体，结构体中包含两个属性：`key` 和 `value`。
```sql
SELECT MAP_FROM_ENTRIES(ARRAY(
NAMED_STRUCT('key',1, 'value','a'),
NAMED_STRUCT('key',2, 'value','b')
));

```
返回结果：
```
{
  1:"a",
  2:"b"
}
```

2. 创建一个包含三个元素的数组，元素类型为结构体，结构体中包含不同类型的 key 和 value。
```sql
SELECT MAP_FROM_ENTRIES(ARRAY(
NAMED_STRUCT('key',1, 'value','apple' ),
NAMED_STRUCT('key',2, 'value','carrot'),
NAMED_STRUCT('key',3, 'value','dog')
));


```
返回结果：
```
{
  1:"apple",
  2:"carrot",
  3:"dog"
}
```

注意：在上述示例中，`extra` 属性不会包含在最终的 map 中，因为我们只关心 `key` 和 `value` 属性。

#### 注意事项
* 输入数组中的每个结构体必须具有 `key` 和 `value` 两个属性，否则会导致函数执行失败。
* key 的类型需要唯一，不能有重复的 key 值，否则后面的 key 值会覆盖前面的 key 值。