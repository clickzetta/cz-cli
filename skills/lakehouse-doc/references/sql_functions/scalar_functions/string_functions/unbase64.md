### UNBASE64 函数
```
unbase64(str)
```
#### 功能描述
UNBASE64 函数用于将 Base64 编码格式的字符串转换为二进制格式。该函数接受一个字符串参数，并返回相应的二进制数据。

#### 参数说明
* `str`：输入的 Base64 编码格式字符串。

#### 返回值
返回二进制格式的数据。

#### 使用示例
1. 将 Base64 字符串转换为文本数据：
```
SELECT CAST(unbase64('SGVsbG9Xb3JsZA==') AS STRING);
```
结果：
```
HelloWorld
```

2. 将 Base64 字符串转换为 BLOB 数据：
```
SELECT unbase64('SGVsbG9Xb3JsZA==') AS BLOB;
```
结果：
```
[48 65 6c 6c 6f 57 6f 72 6c 64]

```

3. 将多个 Base64 字符串转换为文本数据，并进行拼接：
```
SELECT CONCAT(CAST(unbase64('SGVsbG8=') AS STRING), CAST(unbase64('U3RyaW5n') AS STRING)) AS RESULT;
```
结果：
```
HelloString
```

4. 从表中提取 Base64 编码的字段，并转换为文本数据：
```
SELECT CAST(unbase64(base64_column) AS STRING) AS text_data
FROM my_table;
```
结果：
```
text_data
----------
HelloWorld
```

