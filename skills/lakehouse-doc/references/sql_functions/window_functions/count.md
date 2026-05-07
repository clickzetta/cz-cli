### COUNT 函数

#### 概述

COUNT 函数用于计算窗口内的数据行数。该函数有两种形式：`count(*)` 和 `count(expr1[,expr2...])`。`count(*)` 计算窗口内所有行的数量，包括包含 NULL 值的行；`count(expr1[,expr2...])` 计算窗口内非 NULL 表达式的数量。

#### 语法

```sql
count(*) over ([partition_clause] [orderby_clause] [frame_clause])
count(expr1[,expr2...]) over ([partition_clause] [orderby_clause] [frame_clause])
```

#### 参数

* `exprN`: 任意类型，用于计算非 NULL 值的数量。

#### 返回结果

* 返回值类型为 bigint 类型。
* 使用 `count(*)` 时，NULL 值也被计算为一行。
* 使用 `count(expr1[,expr2...])` 时，任意一列出现 NULL 值，该行将被忽略。

#### 示例 1：计算每个部门的人数

```sql
SELECT dep_no,name, count(*) OVER (PARTITION BY dep_no)
FROM VALUES
  ('Eric', 1, 28000),
  ('Alex', 1, 32000),
  ('Felix', 2, 21000),
  ('Frank', 1, 30000),
  ('Tom', 2, 23000),
  ('Jane', 3, 29000),
  ('Jeff', 3, 35000),
  ('Paul', 2, 29000),
  ('Charles', 2, 23000)
AS tab(name, dep_no, salary);
+--------+---------+---------------------------------------+
| dep_no |  name   | `count`(*) OVER (PARTITION BY dep_no) |
+--------+---------+---------------------------------------+
| 3      | Jane    | 2                                     |
| 3      | Jeff    | 2                                     |
| 1      | Eric    | 3                                     |
| 1      | Alex    | 3                                     |
| 1      | Frank   | 3                                     |
| 2      | Felix   | 4                                     |
| 2      | Tom     | 4                                     |
| 2      | Paul    | 4                                     |
| 2      | Charles | 4                                     |
+--------+---------+---------------------------------------+
```

在此示例中，我们按照部门对员工进行分组，并计算每个部门的人数。

#### 示例 2：计算每个部门按照工资递增排序后的累计人数

```sql
SELECT dep_no,name, count(*) OVER (PARTITION BY dep_no ORDER BY salary)
FROM VALUES
  ('Eric', 1, 28000),
  ('Alex', 1, 32000),
  ('Felix', 2, 21000),
  ('Frank', 1, 30000),
  ('Tom', 2, 23000),
  ('Jane', 3, 29000),
  ('Jeff', 3, 35000),
  ('Paul', 2, 29000),
  ('Charles', 2, 23000)
AS tab(name, dep_no, salary);
+--------+---------+-----------------------------------------------------------+
| dep_no |  name   | `count`(*) OVER (PARTITION BY dep_no ORDER BY salary ASC) |
+--------+---------+-----------------------------------------------------------+
| 3      | Jane    | 1                                                         |
| 3      | Jeff    | 2                                                         |
| 1      | Eric    | 1                                                         |
| 1      | Frank   | 2                                                         |
| 1      | Alex    | 3                                                         |
| 2      | Felix   | 1                                                         |
| 2      | Tom     | 3                                                         |
| 2      | Charles | 3                                                         |
| 2      | Paul    | 4                                                         |
+--------+---------+-----------------------------------------------------------+
```

在此示例中，我们按照部门对员工进行分组，并按照工资递增排序。


