## LEFT 函数

Lakehouse 中的 LEFT 函数用于从给定的字符串左侧提取指定数量的字符。需要注意的是，字符长度的单位是 utf8 字符，这意味着一个中文字符将被视为一个长度单位。

### 函数语法

LEFT 函数的语法格式如下：

```Plaintext
LEFT(str, len)
```

- `str`：待提取字符的字符串。该参数接受 VARCHAR 类型的数据。
- `len`：需要从字符串左侧提取的字符数量。该参数应为正整数。

### 返回值

LEFT 函数返回一个字符串，包含从输入字符串左侧提取的指定数量的字符。返回值的数据类型为 VARCHAR。

### 使用示例

以下为 LEFT 函数的几个使用示例：

#### 示例 1：

```SQL
SELECT LEFT('Hello, welcome to Lakehouse', 5);
```

此查询将返回字符串 'Hello, welcome to Lakehouse' 左侧的前 5 个字符，即 'Hello'。

#### 示例 2：

```SQL
SELECT LEFT('Lakehouse，一个强大的实时数据仓库。', 9);
```

此查询将返回字符串 'Lakehouse，一个强大的实时数据仓库。' 左侧的前 9 个字符，即 'Lakehouse'。

#### 示例 3：

```SQL
SELECT LEFT('The quick brown fox jumps over the lazy dog', 9);
```

此查询将返回字符串 'The quick brown fox jumps over the lazy dog' 左侧的前 9 个字符，即 'The quick'。

### 注意事项

- 确保 `len` 参数为正整数，否则函数将返回错误。
- 如果 `len` 参数大于输入字符串的长度，LEFT 函数将返回整个输入字符串。
