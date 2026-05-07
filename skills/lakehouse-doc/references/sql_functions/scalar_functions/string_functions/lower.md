### LOWER 函数

#### 功能描述
LOWER 函数用于将输入的字符串（str）中的所有大写字符转换为小写字符，并返回转换后的字符串。

#### 参数说明
* `str`：需要转换为小写字母的字符串。

#### 返回结果
返回转换为小写字母的字符串。

#### 使用示例
以下为几个使用 LOWER 函数的例子：

1. 将 "HelloWorld" 转换为 "helloworld"：
```sql
SELECT LOWER('HelloWorld');
```
结果为：
```
helloworld
```

2. 将 "Python" 和 "JAVA" 转换为小写字母：
```sql
SELECT LOWER('Python'), LOWER('JAVA');
```
结果为：
```
python
java
```

3. 将字符串 "SQL" 和 "DATABASE" 转换为小写字母，并拼接在一起：
```sql
SELECT LOWER('SQL') || LOWER('DATABASE');
```
结果为：
```
sqldatabase
```

4. 将用户输入的字符串转换为小写字母，并存储到新列 "lower_case" 中：
```sql
SELECT id, LOWER(name) AS lower_case
FROM users;
```
假设用户表 `users` 如下所示：
```
id | name
---|-----
1  | JohnDoe
2  | AliceSmith
```
执行上述查询后，结果如下：
```
id | lower_case
---|-------------
1  | johndoe
2  | alicesmith
```
