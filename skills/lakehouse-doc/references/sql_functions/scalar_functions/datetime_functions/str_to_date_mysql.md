## 功能概述

`STR_TO_DATE_MYSQL` 是一个 SQL 函数，用于将字符串转换为日期，其实现与 MySQL 中的 `STR_TO_DATE` 函数兼容。该函数能够根据指定的格式将字符串解析为日期类型，非常适合处理包含日期信息的文本字段。

## 语法

```SQL
STR_TO_DATE_MYSQL(date_string, format_string)
```

## 参数说明

* **date\_string**: 要转换的日期字符串。
* **format\_string**: 日期字符串的格式，日期字符串格式参考[mysql官网](https://dev.mysql.com/doc/refman/8.4/en/date-and-time-functions.html#function_date-format)。这个字符串定义了 `date_string` 的日期部分应该如何被解析。

## 返回结果

该函数返回一个日期类型 (DATE | TIMESTAMP) 的值，表示成功解析的日期。

## 示例

示例 1: 基本使用

```SQL
SELECT STR_TO_DATE_MYSQL('2024-07-29', '%Y-%m-%d');
+------------+
|    res     |
+------------+
| 2024-07-29 |
+------------+
```

示例 2: 格式化为timestmap\_ltz

```SQL
SELECT STR_TO_DATE_MYSQL('20130101 1130','%Y%m%d %h%i') ;
+---------------------+
|         res         |
+---------------------+
| 2013-01-01 11:30:00 |
+---------------------+
```