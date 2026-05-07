### JSON_TYPE
```sql
json_type(json)
```
#### 功能
返回 JSON 值的类型。

#### 参数
* json : json 类型的表达式

#### 返回结果
* string 类型，返回以下值之一：
  * `JSON_NULL` - JSON null 值
  * `JSON_BOOLEAN` - JSON 布尔值
  * `JSON_INTEGER` - JSON 整数
  * `JSON_DOUBLE` - JSON 浮点数
  * `JSON_STRING` - JSON 字符串
  * `JSON_ARRAY` - JSON 数组
  * `JSON_OBJECT` - JSON 对象
  * `NULL` - 输入为 NULL 或无效 JSON

#### 举例
```sql
> SELECT json_type(json_parse('null'));
JSON_NULL

> SELECT json_type(json_parse('true'));
JSON_BOOLEAN

> SELECT json_type(json_parse('1'));
JSON_INTEGER

> SELECT json_type(json_parse('1.1'));
JSON_DOUBLE

> SELECT json_type(json_parse('"a"'));
JSON_STRING

> SELECT json_type(json_parse('[1,2,3]'));
JSON_ARRAY

> SELECT json_type(json_parse('{"a":1, "b":{"c":"x","d": "x"}}'));
JSON_OBJECT
```
