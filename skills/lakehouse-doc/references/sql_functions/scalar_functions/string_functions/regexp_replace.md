### REGEXP_REPLACE 函数
```sql
regexp_replace(str, regexp, rep [, position])
```
#### 功能描述
REGEXP_REPLACE 函数用于在字符串 str 中查找所有匹配正则表达式 regexp 的子字符串，并将它们替换为指定的字符串 rep。

#### 参数说明
* str (string) ：待处理的字符串。
* regexp (string) ：正则表达式字符串。当前使用的正则表达式引擎为 [re2](https://github.com/google/re2)。
* rep (string) ：用于替换匹配到的子字符串的字符串。
* position (int, 可选) ：开始匹配的位置，大于等于 0。默认值为 1，表示从 str 的开头进行匹配。如果 position 超过 str 的长度，结果将返回 str。

#### 返回结果
返回处理后的字符串。

#### 使用示例
```sql
-- 示例 1: 将字符串中的数字替换为 "digit"
> SELECT regexp_replace('100-500',r'(\d+)', 'digit');
-- 返回结果：digit-digit

-- 示例 2: 替换字符串中的特定字符
> SELECT regexp_replace('a1b2c3', r'(\d)', 'x');
-- 返回结果：axbxcx

-- 示例 3: 使用正则表达式匹配并替换字符串中的子字符串
> SELECT regexp_replace('hello world', r'(\w{5})', '$1!');
-- 返回结果：hello! world!

-- 示例 4: 指定开始匹配的位置
> SELECT regexp_replace('abcdef', '(b.)', 'x', 2);
-- 返回结果：axdef

