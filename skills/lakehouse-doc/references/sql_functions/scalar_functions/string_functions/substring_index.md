### SUBSTRING_INDEX 函数
```sql
substring_index(expr, delim, count) 
```
#### 功能描述
SUBSTRING_INDEX 函数用于提取字符串或二进制数据中，分隔符 delim 出现 count 次之前的子字符串。该函数在处理文本数据时非常有用，尤其是在需要根据特定分隔符来拆分或提取字符串时。

#### 参数说明
* **expr** (string/binary): 需要处理的原始字符串或二进制数据。
* **delim** (string/binary): 用作分隔符的字符串或二进制数据，与 expr 类型相同。
* **count** (bigint): 表示分隔符出现的计数。如果 count 是正数，则从字符串左侧开始计数；如果 count 是负数，则从字符串右侧开始计数；如果 count 为 0，则返回空字符串。

#### 返回结果
返回一个字符串或二进制数据，表示在 expr 中 delim 出现 count 次之前的子字符串。

#### 使用示例
```sql
-- 例子 1: 从左向右提取子字符串
SELECT substring_index('a,b,c,d', ',', 2);
-- 结果: 'a,b'

-- 例子 2: 从右向左提取子字符串
SELECT substring_index('a,b,c,d', ',', -2);
-- 结果: 'c,d'

-- 例子 3: 提取分隔符之前的全部字符串
SELECT substring_index('a,b,c,d', ',', 1);
-- 结果: 'a'

-- 例子 4: 使用负数 count 从右向左提取子字符串
SELECT substring_index('a,b,c,d', ',', -1);
-- 结果: 'd'

-- 例子 5: 当 count 为 0 时返回空字符串
SELECT substring_index('a,b,c,d', ',', 0);
-- 结果: ''

-- 例子 6: 提取二进制数据中的子字符串
SELECT substring_index('hello,world,123', ',world,', 1);
-- 结果: 'hello'
```
#### 注意事项
* 当 count 为正数时，函数将从字符串左侧开始查找分隔符 delim，并返回其之前的子字符串。
* 当 count 为负数时，函数将从字符串右侧开始查找分隔符 delim，并返回其之前的子字符串。
* 当 count 的绝对值大于分隔符在字符串中出现的次数时，函数将返回整个原始字符串 expr。
* 如果 expr 或 delim 为 NULL，则返回 NULL。