### MAX_BY 函数

```sql
max_by(expr1, expr2) [FILTER (WHERE condition)]
```

#### 功能描述

`MAX_BY` 函数用于从一组数据中返回与 `expr2` 表达式的最大值相关联的 `expr1` 表达式的值。该函数在处理成对的数据时非常有用，可以帮助您快速找到与最大值相对应的数据项。

#### 参数说明

* `expr1`：任何数据类型的表达式。
* `expr2`：可比较的数据类型表达式，包括数值类型（如 `TINYINT`、`SMALLINT`、`INT`、`BIGINT`、`FLOAT`、`DOUBLE`、`DECIMAL`），时间类型（如 `DATE`、`TIMESTAMP`）以及字符串类型（如 `CHAR`、`VARCHAR`、`STRING`、`BINARY`）。

#### 返回结果

返回与 `expr2` 表达式的最大值相关联的 `expr1` 表达式的值。结果类型与 `expr1` 的类型匹配。如果 `expr2` 中的所有值均为 `NULL`，则返回 `NULL`。

#### 使用示例

1.  从一组字符串和整数数据中找到与最大整数值相关联的字符串：

    ```sql
SELECT max_by(str, num) FROM VALUES ('apple', 1), ('banana', 3), ('cherry', 2) AS tab(str, num);
+------------------+
| max_by(str, num) |
+------------------+
| banana           |
+------------------+
```

2.  从一组日期和字符串数据中找到与最晚日期相关联的字符串：

    ```sql
SELECT max_by(str, date)
FROM VALUES ('event1', '2022-01-01'), ('event2', '2022-02-01'), ('event3', '2022-01-15') AS tab(str, date);
+---------------------+
| max_by(str, `date`) |
+---------------------+
| event2              |
+---------------------+
```

3.  从一组员工姓名和工资数据中找到与最高工资相关联的员工姓名：

    ```sql
SELECT max_by(name, salary)
FROM VALUES ('Alice', 5000), ('Bob', 6000), ('Charlie', 4500) AS tab(name, salary);
+----------------------+
| max_by(name, salary) |
+----------------------+
| Bob                  |
+----------------------+
```

4.  使用 FILTER 子句条件性地查找关联值：

    ```sql
SELECT max_by(name, salary) FILTER (WHERE salary < 6000)
FROM VALUES ('Alice', 5000), ('Bob', 6000), ('Charlie', 4500) AS tab(name, salary);
+------------------------------------------------------+
| max_by(name, salary) FILTER (WHERE (salary < 6000))  |
+------------------------------------------------------+
| Alice                                                |
+------------------------------------------------------+
```
