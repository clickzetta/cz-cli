## REGEXP\_INSTR

### 函数描述

`REGEXP_INSTR` 函数用于返回与指定正则表达式模式相匹配的子字符串在源字符串中首次出现的位置。位置从 1 开始计数。如果未找到匹配项，则返回 0。

### 语法

sql

```sql
REGEXP_INSTR(string_expression, pattern_expression)
```

### 参数说明
- string\_expression:STRING,待搜索的字符串表达式
- pattern\_expression:STRING,Java 正则表达式模式。详见[正则表达式支持的函数列表](../../../regexp-statement.md)


### 返回值

返回类型：`INTEGER`

返回与指定模式相匹配的首个子字符串的起始位置（从 1 开始）。如果没有找到匹配项，返回 0。

### 使用示例

**示例 1：查找特定字符位置**

查找 `@` 符号在邮箱地址中的位置：



```sql
SELECT REGEXP_INSTR('email@example.com', '@') as position;
```

执行结果：

```
position6
```

字符 `@` 在邮箱地址中位置为 6（即第 6 个字符）。

**示例 2：查找字符串首次出现的位置**

在含有重复字符串的文本中查找首次出现的位置：


```sql
SELECT REGEXP_INSTR('hello world hello', 'hello') as first_position;
```

执行结果：

```
first_position1
```

`hello` 在字符串中首次出现的位置是 1。

**示例 3：使用字符类查找匹配位置**

查找第一个数字字符的位置：


```sql
SELECT REGEXP_INSTR('abc123def456ghi', '[0-9]') as first_digit_position;
```

执行结果：

```
first_digit_position4
```

第一个数字 `1` 位于字符串中的第 4 个位置。

**示例 4：多个字符串的并行查找**

在多个字符串上查找不同模式的位置：


```sql
SELECT  REGEXP_INSTR('email@example.com', '@') as at_position,  REGEXP_INSTR('hello world hello', 'hello') as hello_position,  REGEXP_INSTR('test string', ' ') as space_position;
```

执行结果：

```
at_position	hello_position	space_position6	1	5
```

* `@` 符号位于第 6 位
* 首个 `hello` 位于第 1 位
* 空格位于第 5 位

**示例 5：使用复杂模式匹配**

使用字符类和单词边界等高级模式：


```sql
SELECT  REGEXP_INSTR('user@example.com', '[a-z]+') as letters_position,  REGEXP_INSTR('file_123_backup.txt', '[0-9]') as digit_position,  REGEXP_INSTR('www.example.com', '\\w+') as word_position;
```

执行结果：

```
letters_position	digit_position	word_position1	6	1
```

* 小写字母序列从第 1 位开始
* 第一个数字在第 6 位
* 单词字符从第 1 位开始

**示例 6：处理无匹配的情况**

测试不存在匹配项的场景：


```sql
SELECT  REGEXP_INSTR('', 'a') as empty_result,  REGEXP_INSTR('hello', 'xyz') as no_match_result;
```

执行结果：

```
empty_result	no_match_result0	0
```

* 空字符串返回 0
* 不存在的模式返回 0

### 应用场景

* **邮箱地址解析**：快速定位 `@` 符号以分割用户名和域名部分
* **数据清洗**：在混合格式的字符串中定位特定模式以进行分割或提取
* **文件路径处理**：查找文件扩展名开始位置（`.` 的位置）
* **电话号码格式化**：定位数字序列的开始位置以进行格式转换
* **URL 解析**：快速定位 `://` 或其他协议分隔符的位置

### 注意事项

* 返回的位置从 1 开始计数，不是 0
* 使用反斜杠作为转义字符时，需要在 SQL 字符串中使用双反斜杠 `\\` 表示单个 `\`
* 函数返回的是首个匹配项的位置，如需查找后续匹配项，需要结合其他字符串函数（如 `SUBSTR`）使用
* 正则表达式引擎使用 RE2 规范
* 模式匹配是区分大小写的。


