# 二进制类型（BINARY）

## 概述

在 Lakehouse 中，BINARY 类型用于存储二进制数据，适用于存储图像、音频、视频以及其他二进制文件。BINARY 类型能够确保数据的完整性和一致性，适用于各种场景。最大写入长度限制为 16 MB。批量、实时导入时会对字段进行长度校验。如果您导入的数据超过 16 MB，可以修改表的属性（Properties）来调整限制，例如将 BINARY 长度设置为 32 MB：
```
ALTER TABLE table_name SET PROPERTIES("cz.storage.write.max.binary.bytes"="33554432");
```



## 语法

BINARY 类型的声明非常简单，只需在数据类型前加上关键字 `BINARY` 即可。例如：

```sql
CREATE TABLE binary_table (
  id INT,
  data BINARY
);
```

## BINARY 常量值

在 SQL 语句中，可以使用 `X` 前缀来构造 BINARY 常量值。例如：

```sql
SELECT X'4';
```

上述语句将返回一个字节序列 `[4]`。`X` 后跟的 `num` 是一个或多个十六进制字符，范围从 0 到 F，支持大写或小写。例如：

```sql
SELECT X'A413F';
```

将返回 `[0a 41 3f]`。

## 转换函数

Lakehouse 提供了多种函数来处理 BINARY 类型的数据，包括：

1. `CAST()` 函数：将其他类型的数据转换为 BINARY 类型。
2. `BASE64()` 函数：将二进制数据转换为 BASE64 编码的字符串。
3. `UNBASE64()` 函数：将 BASE64 编码的字符串转换为二进制数据。
4. `BINARY()` 函数：将字符串转换为 BINARY 类型的字节流。

## 约束限制
* BINARY 类型最大存储长度为 16 MB。

## 示例

以下是一些使用 BINARY 类型和相关函数的示例：

1. 创建一个包含 BINARY 类型列的表：

```sql
CREATE TABLE binary_table (
  id INT,
  data BINARY
);
```

2. 向表中插入数据：

```sql
INSERT INTO binary_table (id, data) VALUES (1, X'1');
```

3. 将字符串转换为 BINARY 类型并插入到表中：

```sql
INSERT INTO binary_table (id, data)
SELECT col1, BINARY(col2)
FROM values(1, 'guan') AS data(col1, col2);
```

4. 查询表中的数据：

```sql
SELECT data FROM binary_table;
```

5. 使用 `CAST()` 函数将字符串转换为 BINARY 类型：

```sql
SELECT CAST('ClickZetta' AS BINARY);
```

将返回 `[43 6c 69 63 6b 5a 65 74 74 61]`。

6. 使用 `base64()` 和 `unbase64()` 函数进行编码和解码：

```sql
SELECT base64('ClickZetta');
```

将返回 `Q2xpY2taZXR0YQ==`，然后使用 `unbase64()` 函数进行解码：

```sql
SELECT cast(unbase64('Q2xpY2taZXR0YQ==') as string);
```

将返回原始字符串 `ClickZetta`。
