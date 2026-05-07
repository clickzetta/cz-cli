### CONCAT_WS 函数

#### 概述
`CONCAT_WS` 函数用于将多个字符串或数组中的字符串元素连接成一个字符串。它可以根据指定的分隔符 `sep` 来连接输入的字符串或数组中的字符串元素。如果输入的字符串为 `NULL`，则在结果中忽略该值。

#### 语法
```
CONCAT_WS(sep, str1, str2, ..., strN)
CONCAT_WS(sep, array1, array2, ..., arrayN)
```

#### 参数
- `sep`: 分隔符字符串，用于连接输入的各个字符串。
- `str1, str2, ..., strN`: 要连接的字符串。
- `array1, array2, ..., arrayN`: 包含要连接的字符串元素的数组。

#### 返回结果
返回一个连接后的字符串。

#### 使用示例

1. 基本使用：
```sql
SELECT CONCAT_WS('-', 'hello', 'world');
```
结果：
```
hello-world
```

2. 连接多个字符串：
```sql
SELECT CONCAT_WS('-', 'hello', 'my', 'friend', '!');
```
结果：
```
hello-my-friend-!
```

3. 忽略 `NULL` 值：
```sql
SELECT CONCAT_WS('-', 'hello', NULL, 'world', NULL);
```
结果：
```
hello-world
```

4. 使用数组连接字符串：
```sql
SELECT CONCAT_WS('-', array('hello', 'my', 'friend'), array('is', NULL, 'awesome'));
```
结果：
```
hello-my-friend-is-awesome
```

5. 结合其他函数使用：
```sql
SELECT CONCAT_WS('-', UPPER('hello'), LENGTH('world'), LOWER('!'));
```
结果：
```
HELLO-5-!
```

#### 注意事项
- 当输入的字符串或数组元素为 `NULL` 时，`CONCAT_WS` 函数会忽略这些值。
- 如果所有输入的字符串或数组元素均为 `NULL`，则返回空字符串。
- 如果分隔符 `sep` 为 `NULL`，则返回 NULL。

通过以上示例和说明，您可以更好地理解 `CONCAT_WS` 函数的用法和功能。在实际应用中，您可以根据需要灵活地使用此函数来连接字符串或数组元素。