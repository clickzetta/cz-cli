## 功能概述

`FORMAT_STRING` 是一个 SQL 函数，用于格式化字符串。它基于 `printf` 样式的格式字符串生成格式化后的字符串。此函数使用 `java.util.Formatter` 类，利用 `Locale.US` 进行格式化。

## 语法

```SQL
FORMAT_STRING(strfmt [, obj1 [, ...]])
```

## 参数说明

* **strfmt**: 一个 `STRING` 类型的表达式，定义了字符串的格式。这应该包含格式化指令，如 `%d`、`%s` 等。
* **obj1, ...**: 一个或多个 `STRING` 或数值类型的表达式，这些表达式将被格式化并插入到 `strfmt` 中相应的位置。

## 返回结果

该函数返回一个 `STRING` 类型的值，表示格式化后的字符串。

## 示例

示例 1: 基本使用

```SQL
SELECT FORMAT_STRING('Hello World %d %s', 100, 'days') as res;
+----------------------+
|         res          |
+----------------------+
| Hello World 100 days |
+----------------------+
```

示例 2: 使用数值参数

```SQL
SELECT FORMAT_STRING('The square of %d is %d', 5, 5*5) as res;
+-----------------------+
|          res          |
+-----------------------+
| The square of 5 is 25 |
+-----------------------+
```

示例 3: 使用多个参数

```SQL
SELECT FORMAT_STRING('Name: %s, Age: %d, Location: %s', 'Alice', 30, 'Wonderland') as res;
+--------------------------------------------+
|                    res                     |
+--------------------------------------------+
| Name: Alice, Age: 30, Location: Wonderland |
+--------------------------------------------+
```
