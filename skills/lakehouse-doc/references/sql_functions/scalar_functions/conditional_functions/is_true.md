### IS_TRUE 函数

```
is_true(expr)
```

#### 功能描述

`IS_TRUE` 函数用于判断表达式的值是否为 `true`。该函数支持布尔值和字符串类型，能够识别多种表示 `true` 的字符串格式。

#### 参数说明

* `expr`：`BOOLEAN` 或 `STRING` 类型，待判断的表达式。

#### 返回类型

* 返回 `BOOLEAN` 类型。
* 如果表达式值为 `true` 或表示 `true` 的字符串，返回 `true`。
* 如果表达式值为 `false` 或表示 `false` 的字符串，返回 `false`。
* 如果表达式值为 `NULL`，返回 `false`。

#### 注意事项

* `IS_TRUE` 函数识别以下字符串为 `true`：'t', 'true', '1', 'yes'。
* `IS_TRUE` 函数识别以下字符串为 `false`：'f', 'false', '0', 'no'。
* 与直接使用 `expr` 的区别：`is_true(NULL)` 返回 `false`，而 `NULL` 在布尔上下文中会被特殊处理。
* 字符串匹配不区分大小写。

#### 使用示例

1. 布尔值判断

```sql
SELECT is_true(true), is_true(false), is_true(NULL);
+---------------+----------------+----------------+
| is_true(true) | is_true(false) | is_true(NULL)  |
+---------------+----------------+----------------+
| true          | false          | false          |
+---------------+----------------+----------------+
```

2. 字符串判断（支持多种格式）

```sql
SELECT is_true('t'), is_true('f');
+--------------+--------------+
| is_true('t') | is_true('f') |
+--------------+--------------+
| true         | false        |
+--------------+--------------+
```

3. 在 WHERE 子句中使用

```sql
SELECT * FROM VALUES (true), (false), (NULL) AS t(flag)
WHERE is_true(flag);
+------+
| flag |
+------+
| true |
+------+
```
