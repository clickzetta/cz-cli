### JSON_ARRAY
```sql
json_array([val1, val2, ...])
```
#### 功能
构造一个 JSON 数组。接受零个或多个参数，将它们转换为 JSON 数组元素。

#### 参数
* val1, val2, ... : 可选参数，任意类型的表达式，用作数组元素

#### 返回结果
* json 类型，表示 JSON 数组

#### 举例
```sql
> SELECT json_array();
[]

> SELECT json_array(1);
[1]

> SELECT json_array(NULL);
[null]

> SELECT json_array(NULL::int, 1, TRUE, FALSE, NULL::int, "a", 1.2, 1.3d);
[null,1,true,false,null,"a","1.2",1.3]
```
#### 说明
* 支持各种基本类型，包括整数、浮点数、布尔值、字符串和 NULL。
* 返回的 JSON 数组会压缩空格。
