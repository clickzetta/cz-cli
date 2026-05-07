### MAP_ZIP_WITH 函数

#### 功能描述
MAP_ZIP_WITH 函数能够根据给定的 lambda 表达式，将两个 map 类型数据中 key 值相同的元素进行配对计算。计算过程中，若某个 key 在其中一个 map 中不存在对应值，则会补入 NULL 值。最终，该函数会返回一个新的 map，其中包含原始 key 值以及根据 lambda 表达式计算得到的新值。

#### 参数说明
- map1, map2: 输入的两个 map 类型数据，类型为 `map<K, V>`。
- `(k, v1, v2) -> expr`: 一个三参数形式的 lambda 表达式，其中 `k` 为匹配的 key 值，`v1` 为 `map1` 中对应的 value，`v2` 为 `map2` 中对应的 value。lambda 表达式的返回值类型不限，但所有返回值必须为同一类型。

#### 返回类型
返回一个新的 map 类型数据，类型为 `map<K, R>`，其中 `R` 为 lambda 表达式计算得到的值类型。

#### 使用示例
1. 计算两个 map 中相同 key 对应 value 的和，并返回新的 map：
```sql
SELECT map_zip_with(map(1, 2, 3, 4), map(2, 3, 4, 5), (k, x, y) -> x + y);
```
结果：
```
{1:null,3:null,2:null,4:null} 
```

2. 将两个 map 中相同 key 对应的 value 转换为字符串并拼接，返回新的 map：
```sql
SELECT map_zip_with(map(1, "a", 2, "b"), map(1, "A", 2, "B"), (k, x, y) -> CONCAT(x, y));
```
结果：
```
{1:"aA", 2:"bB"}
```

3. 对两个 map 中相同 key 对应的 value 进行类型转换并相加，返回新的 map：
```sql
SELECT map_zip_with(map(1, 2), map(1, 100, 3, 300), (k, x, y) -> CAST((x + y) AS string));
```
结果：
```
{1:"102", 3:null}
```

#### 注意事项
- 当 key 在一个 map 中不存在对应值时，会补入 NULL 值参与计算。
- 请确保 lambda 表达式中的参数顺序与实际传入的参数顺序相符。
- 返回的新 map 中，key 值的顺序可能与原始 map 中的顺序不同。

通过以上描述和示例，您可以更好地理解和使用 MAP_ZIP_WITH 函数。在实际应用中，该函数能够帮助您灵活地对两个 map 类型数据进行操作和计算。