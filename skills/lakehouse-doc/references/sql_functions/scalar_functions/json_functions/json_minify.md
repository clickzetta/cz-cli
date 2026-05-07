### JSON_MINIFY
```sql
json_minify(json)
```
#### 功能
压缩 JSON 字符串，移除多余的空格和换行符。

#### 参数
* `json`：string 类型的表达式

#### 返回结果
* string 类型，返回压缩后的 JSON 字符串。

#### 举例
```sql
> SELECT json_minify('{ "a": 1, "b": 2 }');
{"a":1,"b":2}

> SELECT json_minify('[
    "a",
    "b",
    "c"
]');
["a","b","c"]
```
#### 说明
* 主要用于移除 JSON 字符串中的格式化空白字符。
* 不改变 JSON 的内容和结构，仅压缩格式。
