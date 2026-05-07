### FIRST\_VALUE 函数

#### 概述

排序键相同时，FIRST\_VALUE 函数用于从窗口内返回第一行的值。该函数可以对数据进行分组和排序，以便在特定的数据范围内查找所需的值。通过使用可选的 ignoreNull 参数，可以指定函数在计算时是否忽略 NULL 值。该函数为非确定性函数

#### 语法

```sql
FIRST_VALUE(expr[, ignoreNull]) OVER ([PARTITION BY partition_clause] [ORDER BY order_by_clause] [frame_clause])
```

#### 参数

* expr：任意类型的表达式。
* ignoreNull（可选）：布尔类型常量，默认值为 false。当设置为 true 时，函数将返回窗口内第一个非 NULL 的值。

#### 返回结果

返回值的类型与 expr 参数的类型相同。

#### 示例

1. 基本使用：

```sql
SELECT dep_no, salary, FIRST_VALUE(salary) OVER (PARTITION BY dep_no) AS first_salary
FROM VALUES
  ('Eric', 1, 28000),
  ('Alex', 1, 32000),
  ('Felix', 2, 21000),
  ('Frank', 1, 30000),
  ('Tom', 2, 23000),
  ('Jane', 3, 29000),
  ('Jeff', 3, 35000),
  ('Paul', 2, 29000),
  ('Charles', 2, 23000),
  ('Charles F', 2, 23000),
  ('null',4,null),
  ('NotNull',4,23000)
  AS tab(name, dep_no, salary);
+--------+--------+-----------------------+
| dep_no | salary | first_non_null_salary |
+--------+--------+-----------------------+
| 3      | 29000  | 29000                 |
| 3      | 35000  | 29000                 |
| 1      | 28000  | 28000                 |
| 1      | 32000  | 28000                 |
| 1      | 30000  | 28000                 |
| 2      | 21000  | 21000                 |
| 2      | 23000  | 21000                 |
| 2      | 29000  | 21000                 |
| 2      | 23000  | 21000                 |
| 2      | 23000  | 21000                 |
| 4      | null   | null                  |
| 4      | 23000  | null                  |
+--------+--------+-----------------------+
```

2. 忽略 NULL 值：

```sql
SELECT dep_no, salary, FIRST_VALUE(salary, true) OVER (PARTITION BY dep_no) AS first_non_null_salary
FROM VALUES
  ('Eric', 1, 28000),
  ('Alex', 1, 32000),
  ('Felix', 2, 21000),
  ('Frank', 1, 30000),
  ('Tom', 2, 23000),
  ('Jane', 3, 29000),
  ('Jeff', 3, 35000),
  ('Paul', 2, 29000),
  ('Charles', 2, 23000),
  ('Charles F', 2, 23000),
  ('null',4,null),
  ('NotNull',4,23000)
  AS tab(name, dep_no, salary);
+--------+--------+-----------------------+
| dep_no | salary | first_non_null_salary |
+--------+--------+-----------------------+
| 3      | 29000  | 29000                 |
| 3      | 35000  | 29000                 |
| 1      | 28000  | 28000                 |
| 1      | 32000  | 28000                 |
| 1      | 30000  | 28000                 |
| 2      | 21000  | 21000                 |
| 2      | 23000  | 21000                 |
| 2      | 29000  | 21000                 |
| 2      | 23000  | 21000                 |
| 2      | 23000  | 21000                 |
| 4      | null   | 23000                 |
| 4      | 23000  | 23000                 |
+--------+--------+-----------------------+
```

3. 结合 ORDER BY 子句：

```sql

SELECT dep_no, salary, FIRST_VALUE(salary, true) OVER (PARTITION BY dep_no ORDER BY salary) AS first_salary_by_salary
FROM VALUES
  ('Eric', 1, 28000),
  ('Alex', 1, 32000),
  ('Felix', 2, 21000),
  ('Frank', 1, 30000),
  ('Tom', 2, 23000),
  ('Jane', 3, 29000),
  ('Jeff', 3, 35000),
  ('Paul', 2, 29000),
  ('Charles', 2, 23000),
  ('Charles F', 2, 23000),
  ('null',4,null),
  ('NotNull',4,23000)
  AS tab(name, dep_no, salary);
+--------+--------+------------------------+
| dep_no | salary | first_salary_by_salary |
+--------+--------+------------------------+
| 3      | 29000  | 29000                  |
| 3      | 35000  | 29000                  |
| 1      | 28000  | 28000                  |
| 1      | 30000  | 28000                  |
| 1      | 32000  | 28000                  |
| 2      | 21000  | 21000                  |
| 2      | 23000  | 21000                  |
| 2      | 23000  | 21000                  |
| 2      | 23000  | 21000                  |
| 2      | 29000  | 21000                  |
| 4      | null   | null                   |
| 4      | 23000  | 23000                  |
+--------+--------+------------------------+
```


