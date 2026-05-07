## 功能概述

`LENGTHB` 是 SQL 中的一个函数，用于返回字符串参数的字节长度。与 `CHAR_LENGTH` 或 `CHARACTER_LENGTH` 函数不同，`LENGTHB` 计算的是字节数而不是字符数，这在处理多字节字符集（如 UTF-8）时尤其重要。

## 语法

```SQL
LENGTHB(string)
```

## 参数说明

* **string**: 要计算字节长度的字符串表达式。

## 返回结果

该函数返回一个整数，表示输入字符串中的字节总数。对于 NULL 输入，返回值也是 NULL。

## 示例

### 示例 1: 基本使用

```SQL
SELECT LENGTHB('Hello, World!');
```

这将返回 13。

### 示例 2: 处理 NULL 值

```SQL
SELECT LENGTHB(NULL);
```

这将返回 `NULL`，因为输入参数是 NULL。

### 示例 3: 中文字符

```SQL
SELECT LENGTHB('中文')
union all
SELECT CHARACTER_LENGTH('中文');
+---------------+
| LENGTHB('中文') |
+---------------+
| 3             |
| 6             |
+---------------+
```
