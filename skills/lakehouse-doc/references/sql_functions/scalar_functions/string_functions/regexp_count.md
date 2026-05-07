## REGEXP\_COUNT

### 函数描述

`REGEXP_COUNT` 函数用于计算字符串中与指定正则表达式模式匹配的子字符串出现的次数。该函数返回一个整数，表示匹配的总数。如果字符串为空或不存在匹配项，则返回 0。

### 语法

sql

```sql
REGEXP_COUNT(string_expression, pattern_expression)
```

### 参数说明

- string\_expression:STRING,待搜索的字符串表达式
- pattern\_expression:STRING,Java 正则表达式模式。详见[正则表达式支持的函数列表](../../../regexp-statement.md)

### 返回值

返回类型：`INTEGER`

返回指定正则表达式在字符串中匹配的次数。如果模式不匹配，返回 0。

### 使用示例

**示例 1：计数简单字符串匹配**

统计字符串中 `hello` 出现的次数：

```sql
SELECT REGEXP_COUNT('hello world hello', 'hello') as count_result;
```

执行结果：

```
count_result2
```

**示例 2：计数数字匹配**

统计日期字符串中数字的个数：

```sql
SELECT REGEXP_COUNT('2024-10-28', '\\d+') as test2;
```

执行结果：

```
test23
```

这个示例中，日期字符串 `2024-10-28` 包含 3 个数字序列：`2024`、`10` 和 `28`。

**示例 3：计数字符类模式**

统计字符串中单个数字字符的个数：

sql

```sql
SELECT REGEXP_COUNT('hello123world456', '[0-9]') as test3;
```

执行结果：

```
test36
```

字符串 `hello123world456` 中包含 6 个数字字符（1、2、3、4、5、6）。

**示例 4：复杂模式匹配**

在多个字符串上应用不同的模式：

```sql
SELECT  REGEXP_COUNT('apple apple apple', 'apple') as apple_count,  REGEXP_COUNT('The quick brown fox', '[aeiou]') as vowel_count,  REGEXP_COUNT('123-456-7890', '[0-9]') as digit_count;
```

执行结果：

```
apple_count	vowel_count	digit_count3	5	10
```

* `apple` 在字符串中出现 3 次
* 元音字母在 "The quick brown fox" 中出现 5 次
* 数字字符在电话号码中出现 10 次

**示例 5：边界情况处理**

测试空字符串和不匹配的模式：

```sql
SELECT  REGEXP_COUNT('', 'a') as empty_string,  REGEXP_COUNT('hello', 'xyz') as no_match,  REGEXP_COUNT('aaa', 'a+') as pattern_match;
```

执行结果：

```
| apple_count | vowel_count | digit_count |
| ----------- | ----------- | ----------- |
| 3           | 5           | 10          |

```

* 空字符串返回 0
* 不存在的模式返回 0
* 贪心量词 `a+` 将连续的 `aaa` 视为一个匹配项，返回 1

^
