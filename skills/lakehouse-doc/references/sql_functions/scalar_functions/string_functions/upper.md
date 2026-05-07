### UPPER 函数

#### 概述
UPPER 函数用于将输入的字符串（str）中的所有小写字母转换为大写字母，并返回转换后的字符串。

#### 语法
```
UPPER(str)
```

#### 参数
- str (string): 需要转换为大写的字符串。

#### 返回结果
返回一个字符串，其中所有小写字母均已转换为大写字母。

#### 使用示例

1. 转换简单字符串：
```sql
SELECT UPPER('hello world');
-- 输出结果：HELLO WORLD
```

2. 转换包含数字和特殊字符的字符串：
```sql
SELECT UPPER('Hello123!@#');
-- 输出结果：HELLO123!@#
```

3. 转换已为大写的字符串：
```sql
SELECT UPPER('HELLOWORLD');
-- 输出结果：HELLOWORLD
```

4. 在查询中使用 UPPER 函数处理列数据：
```sql
SELECT UPPER(column_name) FROM table_name;
```

5. 结合其他字符串函数使用：
```sql
SELECT CONCAT(UPPER(first_name), UPPER(last_name)) AS full_name
FROM users;
-- 假设 users 表包含 first_name 和 last_name 列，该查询将返回一个名为 full_name 的列，其中包含将用户的名字和姓氏转换为大写的结果。
```

#### 注意事项
- UPPER 函数仅对输入字符串中的英文字母有效。对于其他语言的字母或特殊字符，转换效果可能不符合预期。
- 在使用 UPPER 函数时，请确保输入的数据类型为字符串。如果输入非字符串类型，函数可能无法正常工作或返回错误。
