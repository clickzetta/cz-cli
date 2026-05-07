#### 简介

`group_concat` 函数用于将一组字符串值连接成一个单一的字符串。当处理多个行或记录时，此函数非常有用，可以将来自同一组的结果合并为一个字符串，通常用于报表生成和数据汇总场景。

#### 语法

```sql
group_concat(expression [SEPARATOR sep_string]) [FILTER (WHERE condition)]
```

#### 参数

* `expression`: 要连接的列或表达式。
* `sep_string`: （可选）用作分隔符的字符串。如果省略，`Lakehouse` 默认使用逗号（`,`）作为分隔符。

#### 返回结果

* 返回一个字符串，其中包含连接后的所有非 `NULL` 值，值之间由指定的分隔符分隔。

#### 使用示例

1. 基本使用：

```sql
SELECT a, group_concat(b SEPARATOR "-")
FROM VALUES ('A1', 2), ('A1', 1), ('A2', 3), ('A1', 1) AS tab(a, b)
GROUP BY a;
+----+-------------------+
| a  | WM_CONCAT('-', b) |
+----+-------------------+
| A2 | 3                 |
| A1 | 2-1-1             |
+----+-------------------+
```

2. 使用 FILTER 子句条件性地连接字符串：

```sql
SELECT a, group_concat(b SEPARATOR "-") FILTER (WHERE b > 1)
FROM VALUES ('A1', 2), ('A1', 1), ('A2', 3), ('A1', 3) AS tab(a, b)
GROUP BY a;
+----+----------------------------------------------------+
| a  | WM_CONCAT('-', b) FILTER (WHERE (b > 1))           |
+----+----------------------------------------------------+
| A2 | 3                                                  |
| A1 | 2-3                                                |
+----+----------------------------------------------------+
```

#### 注意事项

* 如果结果字符串超过系统设定的最大长度限制，`group_concat` 可能会报错。在 `Lakehouse` 中，可以通过设置表属性 `cz.storage.write.max.string.bytes` 系统变量来调整这个限制。
* 在使用 `group_concat` 函数时，应注意 `NULL` 值会被忽略，不会包含在最终的字符串中。
