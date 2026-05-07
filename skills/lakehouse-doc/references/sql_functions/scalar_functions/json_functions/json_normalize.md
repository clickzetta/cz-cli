### JSON_NORMALIZE
```sql
json_normalize(json)
```
#### 功能
规范化 JSON 字符串，将 JSON 对象的键按字母顺序排序，并移除多余的空格。

#### 参数
* json : string 类型的表达式

#### 返回结果
* string 类型，返回规范化后的 JSON 字符串
* 如果输入为 NULL 或无效的 JSON，返回 NULL

#### 举例
```sql
> SELECT json_normalize('{"b": 1, "a": 2, "c": 3}');
{"a":2,"b":1,"c":3}

> SELECT json_normalize('[{"a": 4, "c": 5, "b": 6}]');
[{"a":4,"b":6,"c":5}]

> SELECT json_normalize('1');
1

> SELECT json_normalize(null);
NULL

> SELECT json_normalize('[');
NULL
```
#### 说明
* 对 JSON 对象的键进行字母排序，便于比较和去重
* 会递归处理嵌套的 JSON 对象和数组
* 对于非对象类型（如数字、字符串等），直接返回原值的压缩形式
* 对于无效的 JSON 字符串，返回 NULL
