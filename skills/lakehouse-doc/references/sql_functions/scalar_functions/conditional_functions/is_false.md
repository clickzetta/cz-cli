### IS_FALSE 函数

```
is_false(expr)
```

#### 功能描述

`IS_FALSE` 函数用于判断表达式的值是否为 `false`。该函数支持布尔值和字符串类型，能够识别多种表示 `false` 的字符串格式。

#### 参数说明

* `expr`：`BOOLEAN` 或 `STRING` 类型，待判断的表达式。

#### 返回类型

* 返回 `BOOLEAN` 类型。
* 如果表达式值为 `false` 或表示 `false` 的字符串，返回 `true`。
* 如果表达式值为 `true` 或表示 `true` 的字符串，返回 `false`。
* 如果表达式值为 `NULL`，返回 `false`。

#### 注意事项

* `IS_FALSE` 函数识别以下字符串为 `false`：'f', 'false', '0', 'no'。
* `IS_FALSE` 函数识别以下字符串为 `true`：'t', 'true', '1', 'yes'。
* 与 `NOT expr` 的区别：`is_false(NULL)` 返回 `false`，而 `NOT NULL` 返回 `NULL`。
* 字符串匹配不区分大小写。

#### 使用示例

1. 布尔值判断

```sql
SELECT is_false(true), is_false(false), is_false(NULL);
+----------------+-----------------+-----------------+
| is_false(true) | is_false(false) | is_false(NULL)  |
+----------------+-----------------+-----------------+
| false          | true            | false           |
+----------------+-----------------+-----------------+
```

2. 字符串判断（支持多种格式）

```sql
SELECT is_false('t'), is_false('f');
+---------------+---------------+
| is_false('t') | is_false('f') |
+---------------+---------------+
| false         | true          |
+---------------+---------------+
```

3. 在 WHERE 子句中使用

```sql
SELECT * FROM VALUES (true), (false), (NULL) AS t(flag)
WHERE is_false(flag);
+-------+
| flag  |
+-------+
| false |
+-------+
```
