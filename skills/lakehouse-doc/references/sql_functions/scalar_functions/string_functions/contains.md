### CONTAINS 函数
`contains(expr, subExpr)`
#### 功能描述
`contains` 函数用于判断字符串或二进制表达式 `subExpr` 是否存在于字符串或二进制表达式 `expr` 中。如果 `subExpr` 存在于 `expr` 中，则返回 `true`，否则返回 `false`。

#### 参数说明
- `expr`：需要搜索的字符串或二进制表达式。
- `subExpr`：需要在 `expr` 中查找的子字符串或二进制表达式。

#### 返回结果
返回一个布尔值，表示 `subExpr` 是否在 `expr` 中存在。

#### 使用示例
1. 判断 "HelloWorld" 中是否包含 "Hello"：
   ```sql
   SELECT contains('HelloWorld', 'Hello'); -- 返回 true
   ```
2. 判断 "123456" 中是否包含 "34"：
   ```sql
   SELECT contains('123456', '34'); -- 返回 true
   ```
3. 判断 "示例文本" 中是否包含 "本"（中文字符）：
   ```sql
   SELECT contains('示例文本', '本'); -- 返回 true
   ```


#### 注意事项
- 当 `expr` 或 `subExpr` 为 `NULL` 时，`contains` 函数将返回 `NULL`。

通过使用 `contains` 函数，您可以轻松地在数据查询中实现对特定子字符串或二进制模式的检测，从而提高数据处理的灵活性和效率。