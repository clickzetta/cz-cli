### FROM\_JSON 函数

```sql
from_json(json_string, schema)
```

#### 功能描述

`FROM_JSON` 函数用于解析 JSON 格式的字符串（`json_string`），并根据提供的模式定义（`schema`）提取相应的数据。在解析过程中，未在模式中描述的 JSON 字段将被忽略，而模式中定义的字段若在 JSON 中不存在，则相应的字段值将被设置为 `NULL`。若 `json_string` 不是合法的 JSON 格式，函数将返回 `NULL`。

模式定义的语法与建表时的语法相同，支持以下类型：

1.  数组类型：`array<T>`，其中 `T` 为数组元素的类型。
2.  键值对类型：`map<K, V>`，其中 `K` 为键的类型，`V` 为值的类型。
3.  结构体类型：`struct<f1:T1, f2:T2, ... fn:Tn>`，其中 `f1, f2, ... fn` 为字段名，`T1, T2, ... Tn` 为字段类型。

类型对应关系（JSON 类型转 LakeHouse 类型）：

* JSON 对象（object）可转换为 LakeHouse 的结构体（struct）、映射（map）或字符串（string）。
* JSON 数组（array）可转换为 LakeHouse 的数组（array）或字符串（string）。
* 数值类型（numeric）可转换为 LakeHouse 的微秒整数（tinyint）、小整数（smallint）、整数（int）、大整数（bigint）、浮点数（float）、双精度浮点数（double）、十进制数（decimal）或字符串（string）。
* 布尔类型（boolean）可转换为 LakeHouse 的布尔值（boolean）或字符串（string）。
* 字符串类型（string）可转换为 LakeHouse 的字符串（string）、字符（char）、可变长字符串（varchar）、二进制（binary）、日期（date）或时间戳（timestamp）。
* JSON 的 `null` 值可转换为任意类型。

对于浮点数（float、double）类型，`FROM_JSON` 函数会尽量保证解析的精度；对于十进制数（decimal）类型，能保证在定义范围内的精度。

#### 参数说明

* `json_string`：类型为 `string`，表示包含 JSON 字符串的文本。
* `schema`：类型为 `string`，定义了期望提取的数据结构，可以参考建表时的语法。

#### 返回类型

返回值的类型与模式定义（`schema`）中描述的类型一致。

#### 使用示例

```sql
-- 解析 JSON 字符串为包含整数、浮点数和日期的结构体
SELECT from_json('{"a": 1, "b": 1.0, "c": "2020-10-10"}', 'struct<a:int, b:float, c:date>');
-- 返回结果：{"a":1,"b":1.0,"c":"2020-10-10"}

-- 解析 JSON 数组为整数数组
SELECT from_json('[1, 2, 3]', 'array<int>');
-- 返回结果：[1,2,3]

-- 解析 JSON 对象为映射
SELECT from_json('{"name": "Alice", "age": 25}', 'map<string, string>');
-- 返回结果：{"name":"Alice","age":"25"}

-- 解析 JSON 字符串，其中包含嵌套结构体
SELECT from_json('{"user": {"name": "Bob", "age": 30}, "active": true}', 'struct<`user`:map<string, string>, active:boolean>');
-- 返回结果：{"user":{"name":"Bob","age":"30"},"active":true}

-- 解析 JSON 数组，其中包含嵌套数组
SELECT from_json('[{"id": 1, "name": "Product A"}, {"id": 2, "name": "Product B"}]', 'array<struct<id:int, name:string>>');
-- 返回结果：[{"id":1,"name":"Product A"},{"id":2,"name":"Product B"}]
```

#### 注意事项

* 确保提供的 JSON 字符串是合法的，否则函数将返回 `NULL`。
* 模式定义应与 JSON 字符串中的数据结构相匹配，否则可能导致某些字段无法正确解析。
* 在处理浮点数和十进制数时，应注意精度可能会受到影响。
*   在使用 `from_json` 函数从 JSON 字符串中提取指定 schema 的数据时，如果 JSON 字符串中存在大小写敏感的键，可能会导致解析错误或结果不符合预期。例如：
    ```SQL
     select from_json('{"A":1,"a":2}','struct<A:bigint,a:bigint>');
    java.lang.IllegalArgumentException: not all nodes and buffers were consumed. nodes: 
    ```
    为了避免这种错误，推荐使用 `parse_json` 函数。`parse_json` 函数能够正确处理大小写敏感的 JSON 键，并且提供了更灵活的数据访问方式。
    ```SQL
    select parse_json('{"A":1,"a":2}')['A'] as res;
    +-----+
    | res |
    +-----+
    | 1   |
    +-----+
    select parse_json('{"A":1,"a":2}')['a'] as res;
    +-----+
    | res |
    +-----+
    | 2   |
    +-----+
    
    ```