### MAP_CONCAT 函数

#### 功能描述
`MAP_CONCAT` 函数用于将多个 `map` 类型参数中的键值对合并到一起，形成一个全新的 `map`。这个函数在处理多个数据源并需要将它们的数据整合到一个单一的数据结构时非常有用。

#### 语法格式
```
MAP_CONCAT(map1, map2, ..., mapN)
```

#### 参数说明
- `map1` ~ `mapN`: 输入的 `map` 类型参数，可以是两个或更多，每个参数都是一个 `map<K, V>` 类型，其中 `K` 表示键的类型，`V` 表示值的类型。

#### 返回类型
返回一个新的 `map<K, V>` 类型，其中包含了所有输入 `map` 参数中的键值对。

#### 使用示例
1. 基础使用：
   ```sql
   SELECT MAP_CONCAT(map('key1', 'value1'), map('key2', 'value2'));
   // 返回结果：{"key1":"value1","key2":"value2"}
   ```
   在这个例子中，两个 `map` 被合并成一个，包含了两个键值对。

2. 多个参数合并：
   ```sql
   SELECT MAP_CONCAT(map('a', 1), map('b', 2), map('c', 3));
   // 返回结果：{"a":1,"b":2,"c":3}
   ```
   三个 `map` 被合并成一个，形成了一个包含三个键值对的新 `map`。

3. 重复键的处理：
   ```sql
   SELECT MAP_CONCAT(map('key', 'original'), map('key', 'override'));
   // 返回结果：{"key":"override"}
   ```
   当多个 `map` 包含相同的键时，后面的 `map` 中的值会覆盖前面的值。

