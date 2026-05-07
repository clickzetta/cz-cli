### CHAR 函数

#### 概述
`CHAR` 函数用于将一个整数（code）转换为对应的字符。如果整数在 ASCII 范围内（即小于等于 255），则将其视为 ASCII 码并转换为相应的字符；如果整数大于 255，则尝试将其作为 Unicode 码点进行解析，并转换为相应的 Unicode 字符。如果给定的整数无法表示为有效的 Unicode 字符，则返回空字符串。

#### 语法
```
CHAR(code)
```

#### 参数
- `code`: 整数，表示要转换的字符码。

#### 返回结果
- 返回一个字符串，表示转换后的字符。

#### 使用示例

1. 将 ASCII 码转换为对应的字符：
   ```sql
   SELECT CHAR(ASCII('中')), LENGTH(CHAR(ASCII(''))), CHAR(ASCII('a'));
   ```
   结果：
   ```
   中	1	a
   ```

2. 将 Unicode 码转换为对应的字符：
   ```sql
   SELECT CHAR(20013) AS result;
   ```
   结果：
   ```
   转换结果	中
   ```

3. 转换非法 Unicode 码：
   ```sql
   SELECT CHAR(-1) AS result;
   ```
   结果：
（空字符串）

4. 转换多个字符码：
   ```sql
   SELECT CHAR(65), CHAR(66), CHAR(67) AS  ABC;
   ```
   结果：
   ```
   A	B	C
   ```

#### 注意事项
- 如果输入的整数超出 Unicode 范围，将返回空字符串。
- 请确保输入的整数是有效的码点，否则可能返回空字符串或不可预测的字符。