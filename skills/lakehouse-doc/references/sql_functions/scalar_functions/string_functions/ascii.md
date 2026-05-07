### ASCII 函数
```
ascii(chr)
```

#### 功能描述
ASCII 函数用于获取指定字符的 ASCII 码值或 Unicode 码点。若输入的字符串长度大于 1，函数将仅返回第一个字符的 ASCII 码值或 Unicode 码点。

#### 参数说明
* `chr`：类型为字符串（string），表示需要查询 ASCII 码值或 Unicode 码点的字符或字符串。

#### 返回结果
* 返回一个整数（int），表示输入字符的 ASCII 码值或 Unicode 码点。

#### 使用示例
1. 查询单个字符的 ASCII 码值或 Unicode 码点：
   ```sql
   SELECT ASCII('A'); -- 返回 65
   ```
2. 查询字符串（多个字符）的 ASCII 码值或 Unicode 码点：
   ```sql
   SELECT ASCII('中'), ASCII('a'), ASCII('Z'); -- 返回 20013, 97, 90
   ```
3. 查询特殊字符的 ASCII 码值或 Unicode 码点：
   ```sql
   SELECT ASCII('\n'); -- 返回 10
   ```
4. 查询空字符的 ASCII 码值或 Unicode 码点：
   ```sql
   SELECT ASCII(''); -- 返回 0
   ```

### 注意事项
* 当输入字符串长度为 1 时，函数返回该字符的 ASCII 码值或 Unicode 码点。
* 当输入字符串长度大于 1 时，函数仅返回第一个字符的 ASCII 码值或 Unicode 码点。
* 对于非 ASCII 字符（如中文字符），ASCII 函数将返回其对应的 Unicode 码点。