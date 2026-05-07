### CONCAT 函数

#### 概述
`CONCAT` 函数用于连接多个字符串、数组或二进制数据。根据输入参数的类型，`CONCAT` 函数可以执行以下操作：
1. 将多个数组元素组合成一个新的数组。
2. 将多个字符串拼接成一个新的字符串。
3. 将多个二进制数据拼接成一个新的二进制数据。

#### 语法
```
CONCAT(array1, array2, ..., arrayN)
CONCAT(str1, str2, ..., strN)
CONCAT(binary1, binary2, ..., binaryN)
```

#### 参数
- `array1 ~ arrayN`: `array<T>` 类型，表示要连接的数组。
- `str1 ~ strN`: `string` 类型，表示要连接的字符串。
- `binary1 ~ binaryN`: `binary` 类型，表示要连接的二进制数据。

#### 返回结果
- 数组重载版本：返回一个 `array<T>` 类型的新数组。
- 字符串重载版本：返回一个连接后的字符串。
- 二进制重载版本：返回一个连接后的二进制数据。

#### 示例
1. 连接两个数组：
```sql
SELECT CONCAT(array(1, 2), array(3, 4));
```
结果：
```
[1, 2, 3, 4]
```

2. 连接多个字符串：
```sql
SELECT CONCAT('hello', '-', 'world');
```
结果：
```
hello-world
```

3. 连接两个二进制数据：
```sql
SELECT CONCAT(CAST('123' AS BINARY), CAST('456' AS BINARY));
```
结果：
```
[31 32 33 34 35 36] 
```

4. 连接字符串和数字（注意：数字需要先转换为字符串）：
```sql
SELECT CONCAT('The price is ', CAST(100 AS STRING), ' dollars.');
```
结果：
```
The price is 100 dollars.
```

5. 使用 `CONCAT` 函数连接多个字段：
```sql
SELECT CONCAT(first_name, ' ', last_name) AS full_name
FROM users;
```
结果：
```
full_name
----------
John Doe
Jane Smith
```

