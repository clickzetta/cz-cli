# 函数名称：RLIKE

## 功能描述
`RLIKE` 函数用于检查一个字符串是否符合指定的正则表达式模式。它既可以作为操作符使用，也可以作为函数调用，提供灵活的字符串匹配能力。

## 语法
- 作为操作符使用：
  ```sql
  str [NOT] RLIKE regex
  ```
- 作为函数使用：
  ```sql
  RLIKE(str, regex)
  ```

## 参数
- `str`：要检查的字符串。
- `regex`：用于匹配的正则表达式。

## 返回值
- 返回布尔值，如果字符串符合正则表达式模式，则返回 `TRUE`；否则返回 `FALSE`。
- 如果使用 `[NOT] RLIKE` 作为操作符，返回值相反，即不符合模式时返回 `TRUE`。


## 使用示例

以下是 RLIKE 函数的使用示例：

1. 匹配字符串开头：

   ```sql
   select rlike('aabb', r'^a');
   -- 结果为true，因为字符串'aabb'的开头是'a'
   ```

2. 匹配字符串开头和结尾：

   ```sql
   select rlike('aabb', r'^a.*b$');
   -- 结果为true，因为字符串'aabb'的开头是'a'，结尾是'b'
   ```

3. 使用通配符匹配任意字符：

   ```sql
   select rlike('footerbar', r'foo(.*?)(bar)');
   -- 结果为true，因为正则表达式中的'.*?'可以匹配任意长度的任意字符
   ```

4. 匹配邮箱地址：

   ```sql
   select rlike('user@example.com', r'^[a-zA-Z0-9._%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4}$');
   -- 结果为true，因为该正则表达式可以匹配大多数有效的电子邮箱地址
   ```

5. 匹配电话号码：

   ```sql
   select rlike('123-4567-8900', r'\d{3}-\d{4}-\d{4}');
   -- 结果为true，因为该正则表达式可以匹配特定格式的电话号码
   ```
6. 使用 NOT RLIKE
    ```sql
    -- 使用作为函数
    SELECT RLIKE('hello world', 'hello.*world') AS result;
    -- 返回 TRUE
    
    -- 使用作为操作符
    SELECT 'hello world' RLIKE r'hello.*world' AS result;
    -- 返回 TRUE
    
    -- 使用 NOT 操作符
    SELECT 'hello world' NOT RLIKE r'hello.*world' AS result;
    -- 返回 FALSE
    ```


