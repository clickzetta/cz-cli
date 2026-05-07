### SUBSTRING 函数

#### 概述
SUBSTRING 函数用于从字符串或二进制数据中提取子字符串。根据指定的起始位置（pos）和长度（len），SUBSTRING 函数返回相应的子字符串。

#### 语法
```
substring(str, pos [, len])
    
substring(str FROM pos [FOR len])
```

#### 参数
- `str` (string/binary): 输入的字符串或二进制数据。
- `pos` (bigint): 子字符串的起始位置。如果 pos 大于等于 1，则从左侧第 pos 个字符开始；如果 pos 小于等于 -1，则从右侧第 -pos 个字符开始；如果 pos 等于 0，则从左侧第一个字符开始。
- `len` (bigint, 可选): 子字符串的长度。如果未指定，则返回从 pos 开始的完整子字符串。

#### 返回结果
返回一个字符串，表示从输入字符串中提取的子字符串。

#### 使用示例

1. 提取字符串的前两个字符：
   ```sql
   > SELECT substring('Hello, world!', 1, 2);
   He
   ```

2. 提取字符串从第四个字符开始的完整子字符串：
   ```sql
   > SELECT substring('Hello, world!', 4);
   lo, world!
   ```

3. 提取字符串从倒数第二个字符开始的两个字符：
   ```sql
   > SELECT substring('Hello, world!', -2, 2);
   d!
   ```

4. 从 URL 中提取域名：
   ```sql
   > SELECT substring('http\://www\.example.com', LOCATE('://', 'http\://www\.example.com')+3);
   www.example.com
   ```

5. 提取字符串中的特定部分（例如，提取月份和日期）：
   ```sql
   > SELECT substring('2023-04-15', 5, 5);
   -04-1  
   ```

通过以上示例，可以看到 SUBSTRING 函数在不同场景下的应用。使用 SUBSTRING 函数可以方便地从字符串中提取所需的子字符串，从而满足各种数据处理需求。