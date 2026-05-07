# ENDSWITH 函数

## 功能描述

`ENDSWITH` 函数用于判断一个字符串或二进制表达式是否以另一个指定的字符串或二进制表达式结尾。如果满足条件，则返回布尔值 `TRUE`，否则返回 `FALSE`。该函数支持字符串和二进制数据，适用于字符串处理和模式匹配场景。

## 语法

```sql
ENDSWITH(expr, endExpr)
```

## 参数

* `expr`：字符串或二进制表达式，表示需要检查的目标数据。
* `suffix`：字符串或二进制表达式，表示用于比较的结尾模式。

## 返回值

* 返回值为布尔类型（`TRUE` 或 `FALSE`）。
* 如果 `expr` 或 `endExpr` 为 `NULL`，则返回 `NULL`。
* 如果 `endExpr` 是空字符串或空二进制数据，则返回 `TRUE`。

## 示例

示例 1：字符串模式匹配

```sql
SELECT ENDSWITH('LakehouseSQL', 'SQL') AS result;
+--------+
| result |
+--------+
| true   |
+--------+
```

示例 2：区分大小写

```sql
SELECT ENDSWITH('LakehouseSQL', 'sql') AS result;
+--------+
| result |
+--------+
| false  |
+--------+
```

示例 3：包含 NULL 值

```sql
SELECT ENDSWITH('LakehouseSQL', NULL) AS result;
+--------+
| result |
+--------+
| null   |
+--------+
```

示例 4：空字符串

```sql
SELECT ENDSWITH('LakehouseSQL', '') AS result;
+--------+
| result |
+--------+
| true   |
+--------+
```

^
