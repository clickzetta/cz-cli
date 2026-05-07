### TRANSFORM_KEYS 函数

#### 功能描述
TRANSFORM_KEYS 函数用于根据提供的 lambda 表达式对 map 类型的输入进行键（key）转换。该函数将遍历输入的 map，并使用 lambda 表达式计算新的键，从而生成一个新的 map。

#### 参数说明
- map: 输入的 map 类型数据，格式为 `map<K, V>`，其中 K 表示原始键类型，V 表示原始值类型。
- (k, v) -> expr: 二参形式的 lambda 表达式，k 对应原始 map 中的键（key），v 对应原始 map 中的值（value）。expr 为 lambda 表达式的返回值，表示新的键。注意，expr 的返回类型应该与原始键类型 K 兼容。

#### 返回类型
函数返回一个新的 map 类型数据，格式为 `map<K', V>`，其中 K' 为经过 lambda 表达式转换后的新键类型，V 为原始值类型。

#### 使用示例

**示例 1：增加键的整数值**

```sql
SELECT transform_keys(map(1, 'hello', 2, NULL, 3, 'world'), (k, v) -> CAST(k + 1 AS string));
```
结果：
```
{"2":"hello","3":NULL,"4":"world"}
```

**示例 2：将键转换为字符串类型**

```sql
SELECT transform_keys(map(1, 'hello', 2, NULL, 3, 'world'), (k, v) -> CAST(k AS string));
```
结果：
```
{"1":"hello","2":NULL,"3":"world"}
```

**示例 3：根据键值对中的值来转换键**

```sql
SELECT transform_keys(map(1, 'hello', 2, 'hi', 3, 'world'), (k, v) -> IF(v = 'hello', 'greeting', 'other'));
```
结果：
```
{"greeting":"hello","other":"hi","other":"world"}
```

#### 注意事项
- 请确保 lambda 表达式返回的新键类型与原始键类型 K 兼容，否则会导致函数执行失败。
- 当输入的 map 为空时，函数将返回一个空的 map。
- 请确保 lambda 表达式中使用的功能和操作符在当前环境中可用，以免出现错误。