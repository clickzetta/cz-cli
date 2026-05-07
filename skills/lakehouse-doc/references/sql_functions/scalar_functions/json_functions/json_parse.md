### JSON_PARSE 函数

#### 简介
`JSON_PARSE` 函数用于将 JSON 格式的字符串解析为 JSON 类型。解析后的 JSON 类型在输出时会自动去除多余的空格，且不保证字段（field）的顺序与原始 JSON 字符串完全一致。`PARSE_JSON` 是 `JSON_PARSE` 函数的别名，两者功能相同。

#### 语法
```
json_parse(str)
parse_json(str)
```

#### 参数
- `str`: 需要解析的 JSON 格式字符串。

#### 返回结果
- 返回解析后的 JSON 类型。

#### 使用示例

**示例 1**：解析简单的 JSON 字符串
```sql
SELECT json_parse('{"name": "张三", "age": 25}');
```
返回结果：
```json
{"name":"张三","age":25}
```

**示例 2**：解析嵌套的 JSON 字符串
```sql
SELECT json_parse('{"user":{"name":"李四","age":30},"info":{"city":"北京","country":"中国"}}');
```
返回结果：
```json
{"user":{"name":"李四","age":30},"info":{"city":"北京","country":"中国"}}
```

**示例 3**：解析包含数组的 JSON 字符串
```sql
select parse_json('{"fruits":["苹果","香蕉","橙子"],"vegetables":["白菜","萝卜"]}') as res;
```
返回结果：
```json
{"fruits":["苹果","香蕉","橙子"],"vegetables":["白菜","胡萝卜"]}
```

**示例 4**：解析含有数字和布尔值的 JSON 字符串
```sql
SELECT json_parse('{"score":85.5,true_false:true,"count":-100}');
```
返回结果：
```json
{"score":85.5,"true_false":true,"count":-100}
```

#### 注意事项
- 确保输入的字符串为有效的 JSON 格式，否则可能导致解析失败。
- 在处理复杂的 JSON 字符串时，请注意字符串的缩进和引号使用，以确保正确解析。
- 由于 JSON 类型在输出时会自动去除多余空格，因此输出结果中的字段顺序可能与原始输入有所不同。