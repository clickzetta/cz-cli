### 定位函数：LOCATE
```sql
LOCATE(substr, str [, pos])
```
#### 功能描述
LOCATE 函数用于在字符串 str 中查找子串 substr，并返回 substr 从 pos 位置之后第一次出现的位置索引。如果指定了 pos 参数，则从该位置开始搜索；若未指定 pos，则在整个字符串 str 中进行搜索。该函数返回的位置索引从 1 开始计数，如果 pos 小于 1，则返回 0。

#### 参数说明
* substr (string): 需要查找的子串。
* str (string): 被搜索的主字符串。
* pos (bigint, 可选): 开始搜索的位置索引。默认值为 1。

#### 返回结果
返回 substr 在 str 中第一次出现的位置索引（bigint 类型），若未找到返回 0。

#### 使用示例
```sql
-- 例子 1：在字符串 "HelloWorldWorld" 中查找 "World"，默认从位置 1 开始搜索
SELECT LOCATE('World', 'HelloWorldWorld');
-- 结果：6

-- 例子 2：在字符串 "HelloWorldWorld" 中查找 "World"，从位置 7 开始搜索
SELECT LOCATE('World', 'HelloWorldWorld', 7);
-- 结果：11

-- 例子 3：在字符串 "1234" 中查找 "3"，默认从位置 1 开始搜索
SELECT LOCATE('3', '1234');
-- 结果：3

-- 例子 4：在字符串 "abcde" 中查找 "c"，并从位置 2 开始搜索
SELECT LOCATE('c', 'abcde', 2);
-- 结果：3

-- 例子 5：在字符串 "MoonshotAI" 中查找 "shot"，未指定 pos 参数
SELECT LOCATE('shot', 'MoonshotAI');
-- 结果：5

-- 例子 6：在字符串 "HelloWorld" 中查找 "World"，从位置 9 开始搜索，不存在于该位置之后
SELECT LOCATE('World', 'HelloWorld', 9);
-- 结果：0
```
通过以上示例，您可以更好地理解 LOCATE 函数的使用方法和功能。在实际应用中，LOCATE 函数可以帮助您快速定位和提取字符串中的特定子串。