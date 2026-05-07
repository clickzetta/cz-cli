### SPLIT_PART 函数
```sql
split_part(str, delim, partNum)
```
#### 功能描述
SPLIT_PART 函数用于将一个字符串（str）按照指定的分隔符（delim）进行分割，并返回指定位置（partNum）的子字符串。

#### 参数说明
* str (string)：需要进行分割操作的字符串。
* delim (string)：用作分隔符的字符串，用于将输入字符串拆分成多个子字符串。
* partNum (bigint)：用于指定返回子字符串的位置。当 partNum 大于 0 时，表示从左侧开始计算第 partNum 个子字符串；当 partNum 小于 0 时，表示从右侧开始计算第 partNum 个子字符串。如果 partNum 超过分割后的子字符串数量，则返回空字符串。partNum 不能为 0。

#### 返回结果
返回一个字符串（string），表示指定位置的子字符串。

#### 使用示例
```sql
-- 例子 1：返回第二个子字符串
SELECT split_part('a,b,c', ',', 2);
-- 结果：b

-- 例子 2：返回最后一个子字符串
SELECT split_part('a,b,c', ',', -1);
-- 结果：c

-- 例子 3：返回第三个子字符串（从右侧计算）
SELECT split_part('a,b,c,d,e', ',', -2);
-- 结果：d

-- 例子 4：当 partNum 超过子字符串数量时，返回空字符串
SELECT split_part('a,b,c', ',', 4);
-- 结果为空

-- 例子 5：使用多个字符作为分隔符
SELECT split_part('apple-orange-grape', '-|g', 1);
-- 结果：apple-orange-grape
```
#### 注意事项
* 当 partNum 为 0 时，函数将返回一个错误。
* 如果输入的字符串或分隔符为空，函数将返回一个空字符串。
* 当 partNum 为负数时，从右侧开始计算子字符串的位置。
* 如果需要使用多个字符作为分隔符，可以连续使用多个字符或使用正则表达式进行分割。