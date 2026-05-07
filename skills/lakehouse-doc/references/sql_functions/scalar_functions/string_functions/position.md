### 定位函数：POSITION
```sql
POSITION(substr, str [, pos])
```
#### 功能描述
POSITION 函数用于在一个字符串（str）中查找另一个子字符串（substr）的位置。它返回 substr 在 str 中从 pos 位置开始第一次出现的位置。如果 pos 未提供，则默认从字符串起始位置（即位置 1）开始在整个 str 中进行搜索。该函数在处理文本数据时非常有用，尤其是在需要确定特定字符或子字符串在文本中的位置时。

#### 参数说明
* substr (string): 需要查找的子字符串。
* str (string): 被搜索的原始字符串。
* pos (bigint, 可选): 开始搜索的位置。默认值为 1。如果 pos 小于 1，函数将返回 0。

#### 返回结果
返回一个 bigint 类型的数值，表示 substr 在 str 中第一次出现的位置。位置计数从 1 开始。如果 substr 未在 str 中找到，返回 0。

#### 使用示例
```sql
-- 例子 1：查找子字符串 "World" 在 "HelloWorldWorld" 中的位置
SELECT POSITION('World', 'HelloWorldWorld'); -- 结果为 6

-- 例子 2：在 "HelloWorldWorld" 中从第 7 个字符开始查找 "World"
SELECT POSITION('World', 'HelloWorldWorld', 7); -- 结果为 11

-- 例子 3：在 "HelloWorld" 中查找 "World"（注意：pos 未提供，将在整个字符串中搜索）
SELECT POSITION('World', 'HelloWorld'); -- 结果为 6

-- 例子 4：查找 "a" 在 "banana" 中的位置，并从第 3 个字符开始搜索
SELECT POSITION('a', 'banana', 3); -- 结果为 4

-- 例子 5：查找 "apple" 在 "I love apples" 中的位置，注意大小写敏感
SELECT POSITION('apple', 'I love apples'); -- 结果为 8

-- 例子 6：查找 "Apple" 在 "I love apples" 中的位置，由于大小写敏感，返回 0
SELECT POSITION('Apple', 'I love apples'); -- 结果为 0
```
