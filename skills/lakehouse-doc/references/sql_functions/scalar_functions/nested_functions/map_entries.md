### MAP_ENTRIES 函数

#### 功能描述
`MAP_ENTRIES` 函数用于将输入的 Map 类型数据转换为一个数组，数组中的每个元素都是一个结构体（struct），该结构体包含两个字段，分别对应 Map 中的键（key）和值（value）。

#### 语法
```
MAP_ENTRIES(map<K, V>)
```

#### 参数
- `map`: 输入的 Map 类型数据，其中 `K` 表示键的类型，`V` 表示值的类型。

#### 返回结果
返回一个数组，数组中的每个元素都是一个结构体，结构体包含两个字段：`key` 和 `value`，分别对应 Map 中的键和值。

#### 使用示例
1. 基本使用：
   ```sql
   SELECT MAP_ENTRIES(map(1, 'a', 2, 'b'));
   ```
   返回结果：
   ```
   [{"key":1,"value":"a"},{"key":2,"value":"b"}]
   ```

2. 与其他函数结合使用：
   ```sql
   SELECT MAP_ENTRIES(map_filter(map(1, 'a', 2, 'b'), (key,v)->key > 1));
   ```
   返回结果：
   ```
   [{"key":2,"value":"b"}]
   ```

3. 嵌套 Map 转换：
   ```sql
   SELECT MAP_ENTRIES(map(map(1, 'a'), map(2, 'b')));
   ```
   返回结果：
   ```
   [{"key":{1:"a"},"value":{2:"b"}}] 
   ```

