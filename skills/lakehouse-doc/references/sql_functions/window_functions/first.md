### FIRST函数

```
FIRST(expr[, ignoreNull]) OVER ([partition_clause] [orderby_clause] [frame_clause])
```

#### 功能描述

排序键相同时，FIRST函数用于返回指定窗口内第一行的值。当窗口内存在非null值时，将返回第一行的非null值。如果窗口内所有值均为null，并且ignoreNull参数设置为true，则返回第一个null值。该函数为非确定性函数。

#### 参数说明

* **expr**: 任意类型的表达式。
* **ignoreNull**: 可选参数，布尔类型，默认值为false。当设置为true时，如果窗口内所有值均为null，将返回第一个null值。

#### 返回类型

返回值类型与输入的expr类型相同。

#### 使用示例

**示例1：基本使用**

```sql

SELECT dep_no, salary, FIRST(salary,true) OVER (PARTITION BY dep_no) AS first_salary
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
  (null,4,null)
AS tab(name, dep_no, salary);
+--------+--------+--------------+
| dep_no | salary | first_salary |
+--------+--------+--------------+
| 3      | 29000  | 29000        |
| 3      | 35000  | 29000        |
| 1      | 28000  | 28000        |
| 1      | 32000  | 28000        |
| 1      | 30000  | 28000        |
| 2      | 21000  | 21000        |
| 2      | 23000  | 21000        |
| 2      | 29000  | 21000        |
| 2      | 23000  | 21000        |
| 2      | 23000  | 21000        |
| 4      | null   | null         |
+--------+--------+--------------+
```

**示例2：忽略null值**

```sql
SELECT dep_no, salary, FIRST(salary, true) OVER (PARTITION BY dep_no) AS first_non_null_salary
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
  (null,4,null)
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
+--------+--------+-----------------------+
```

**示例3：结合排序和窗口函数**

```sql
SELECT dep_no, salary, FIRST(salary, true) OVER (PARTITION BY dep_no ORDER BY salary DESC) AS highest_salary_in_department
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
  (null,4,null)
AS tab(name, dep_no, salary);
+--------+--------+------------------------------+
| dep_no | salary | highest_salary_in_department |
+--------+--------+------------------------------+
| 3      | 35000  | 35000                        |
| 3      | 29000  | 35000                        |
| 1      | 32000  | 32000                        |
| 1      | 30000  | 32000                        |
| 1      | 28000  | 32000                        |
| 2      | 29000  | 29000                        |
| 2      | 23000  | 29000                        |
| 2      | 23000  | 29000                        |
| 2      | 23000  | 29000                        |
| 2      | 21000  | 29000                        |
| 4      | null   | null                         |
+--------+--------+------------------------------+
```

**示例4：使用ROWS BETWEEN子句**

```sql
SELECT dep_no, salary, FIRST(salary, true) OVER (PARTITION BY dep_no ORDER BY salary ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS highest_salary_in_department
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
  (null,4,null)
AS tab(name, dep_no, salary);
+--------+--------+------------------------------+
| dep_no | salary | highest_salary_in_department |
+--------+--------+------------------------------+
| 3      | 29000  | 29000                        |
| 3      | 35000  | 29000                        |
| 1      | 28000  | 28000                        |
| 1      | 30000  | 28000                        |
| 1      | 32000  | 28000                        |
| 2      | 21000  | 21000                        |
| 2      | 23000  | 21000                        |
| 2      | 23000  | 21000                        |
| 2      | 23000  | 21000                        |
| 2      | 29000  | 21000                        |
| 4      | null   | null                         |
+--------+--------+------------------------------+
```

^
