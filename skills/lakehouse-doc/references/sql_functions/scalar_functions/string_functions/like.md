### LIKE 操作符

#### 功能描述
LIKE 操作符用于在 SQL 查询中根据指定的模式匹配字符串。它可以帮助你查找包含特定字符或模式的数据。使用 LIKE 操作符时，你可以使用通配符来表示一个或多个字符。

#### 参数说明
* `str` (string)：需要匹配的原始字符串。
* `pattern` (string)：包含通配符的模式字符串。

#### 返回结果
返回一个布尔值，表示 str 是否匹配 pattern。

#### 通配符说明
* `%`：表示任意数量的字符（包括零个字符）。
* `_`：表示任意单个字符。

#### 使用示例

1. 匹配以 "Hello" 开头的字符串：
```sql
SELECT 'HelloWorld' LIKE 'Hello%';
```
结果：
```
true
```

2. 匹配包含 "lo" 的字符串：
```sql
SELECT 'HelloWorld' LIKE '%lo%';
```
结果：
```
true
```

3. 匹配以 "ld" 结尾且包含 "lo" 的字符串：
```sql
SELECT 'HelloWorld' LIKE '%lo_ld';
```
结果：
```
false
```

4. 使用单个字符通配符匹配包含 "oW" 的字符串：
```sql
SELECT 'HelloWorld' LIKE 'Hello_W%';
```
结果：
```
true
```

5. 结合 NOT 关键字，查找不匹配特定模式的字符串：
```sql
SELECT 'HelloWorld' NOT LIKE 'Hello%';
```
结果：
```
false
```

