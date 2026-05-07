### MAP_KEYS 函数

#### 概述
`MAP_KEYS` 函数用于从输入的 map 类型数据中提取所有的 key 值，并以数组形式返回。

#### 语法
```
MAP_KEYS(map)
```

#### 参数
- **map**: 输入的 map 数据类型，其中 K 为 key 类型，V 为 value 类型。

#### 返回值
返回一个包含所有 key 值的数组，类型为 `array<K>`。

#### 使用示例
1. 从简单的键值对 map 中提取 key：
   ```sql
   SELECT MAP_KEYS(map("苹果", 2, "香蕉", 3, "橙子", 4));
   -- 返回结果：["苹果", "香蕉", "橙子"]
   ```
2. 从嵌套的 map 中提取 key：
   ```sql
   SELECT MAP_KEYS(map(map("a", 1, "b", 2), map("c", 3, "d", 4)));
   -- 返回结果：[{"a":1,"b":2}]
   ```
3. 从空 map 中提取 key：
   ```sql
   SELECT MAP_KEYS(map());
   -- 返回结果：[]
   ```

#### 注意事项
- 如果输入的 map 为空，`MAP_KEYS` 函数将返回一个空数组。
- `MAP_KEYS` 函数不会改变原始 map 中 key 的顺序。

