### transform_values 函数

#### 功能描述
`transform_values` 函数用于根据指定的 lambda 表达式对输入的 map 类型数据进行值转换操作。该函数接受两个参数：第一个参数为 map 类型数据，第二个参数为一个双参数的 lambda 表达式，其两个参数分别对应 map 中的键（key）和值（value）。lambda 表达式的返回值将作为新 map 中的值（value）。

#### 参数说明
1. `map`: 输入的 map 类型数据，格式为 `map<K, V>`，其中 K 表示键的类型，V 表示值的类型。
2. `(k, v) -> expr`: 一个双参数的 lambda 表达式，用于定义值转换的逻辑。`k` 对应 map 中的键，`v` 对应 map 中的值。`expr` 为 lambda 表达式，其返回值类型将作为新 map 中值的类型。

#### 返回类型
返回一个新的 map 类型数据，格式为 `map<R, V>`，其中 R 为 lambda 表达式的返回值类型。

#### 使用示例
1. 示例 1：计算字符串长度
```sql
SELECT transform_values(map(1, 'hello', 2, NULL, 3, 'world'), (k, v) -> LENGTH(v));
```
返回结果：`{1:5, 2:null, 3:5}`

2. 示例 2：将字符串转换为大写
```sql
SELECT transform_values(map(1, 'hello', 2, 'sql', 3, 'world'), (k, v) -> UPPER(v));
```
返回结果：`{1:'HELLO', 2:'SQL', 3:'WORLD'}`

3. 示例 3：为每个键值对添加后缀
```sql
SELECT transform_values(map(1, 'hello', 2, 'world'), (k, v) -> CONCAT(v, '_suffix'));
```
返回结果：`{1:'hello_suffix', 2:'world_suffix'}`

#### 注意事项
1. 当输入的 map 数据中的值为 NULL 时，lambda 表达式需要能够处理 NULL 值，否则可能会导致函数执行失败。
2. 请确保 lambda 表达式返回值的类型与预期的新 map 中值的类型一致。

通过使用 `transform_values` 函数，您可以灵活地对 map 类型数据进行各种转换操作，从而满足不同的业务需求。