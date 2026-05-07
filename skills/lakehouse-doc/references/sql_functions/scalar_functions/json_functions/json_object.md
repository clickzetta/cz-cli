### JSON_OBJECT
```sql
json_object([key1, val1, key2, val2, ...])
```
#### 功能
构造一个 JSON 对象。接受偶数个参数，成对地将它们转换为键值对。

#### 参数
* key1, val1, key2, val2, ... : 可选参数，成对出现。key 为字符串类型，val 可以是任意类型。

#### 返回结果
* JSON 类型，表示 JSON 对象

#### 举例
```sql
> SELECT json_object();
{}

> SELECT json_object("a-null", NULL);
{"a-null":null}

> SELECT json_object('hello', 123, "world", timestamp '2020-10-10 00:00:00');
{"hello":123,"world":"2020-10-10 00:00:00"}

> SELECT json_object('hello', 123, "world", array(1, 2, 3));
{"hello":123,"world":[1,2,3]}

> SELECT json_object('hello', json_array(1, "a"), "world", array(1, 2, 3));
{"hello":[1,"a"],"world":[1,2,3]}

> SELECT json_object('hello', json_object("nested", "b"), "world", struct(1, 2, 3));
{"hello":{"nested":"b"},"world":{"col1":1,"col2":2,"col3":3}}
```
#### 说明
* 必须提供偶数个参数，否则会报错。
* 支持嵌套的 JSON 对象和数组。
* 可以接受复杂类型（如 array、struct 等），它们会自动转换为 JSON 格式。
