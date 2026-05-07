### COALESCE 函数

#### 概述

`COALESCE` 函数用于返回其参数列表中第一个非空（non-null）的表达式值。如果所有参数都是空值（null），则返回空值（null）。

#### 语法

```sql
COALESCE(expr1 [, ...])
```

#### 参数

* `exprN`: 待验证的表达式，参数数量可变，但至少需要一个。参数类型可以不同，返回值类型与第一个非空参数的类型相同。

#### 返回值

* 返回参数列表中第一个非空的表达式值，如果所有参数均为空值，则返回空值（null）。

#### 使用示例

**示例 1：基本使用**

```sql
 SELECT COALESCE(null, 'A', null, 'B', 'C') as res;
+-----+
| res |
+-----+
| A   |
+-----+
```

在此示例中，`COALESCE` 函数返回第一个非空参数 `'A'`。

**示例 2：处理多个可能为空的字段**

```sql
SELECT COALESCE(column1, column2, column3) AS non_null_value
FROM table_name;
```

假设 `column1`、`column2` 和 `column3` 均有可能包含空值。此查询将返回这三个字段中的第一个非空值。

#### 注意事项

* `COALESCE` 函数在处理参数时，一旦找到第一个非空值，就会停止检查后续参数。
* 当所有参数均为空值时，`COALESCE` 函数返回空值（null），不会引发错误。
* 在比较参数值时，`NULL` 被视为等于 `NULL`，但并不被视为任何其他值，包括它自己。这意味着即使有两个 `NULL` 值，`COALESCE` 也不会将它们视为相等。


