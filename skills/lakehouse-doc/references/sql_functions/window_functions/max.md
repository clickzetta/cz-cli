### MAX 函数

```sql
max(expr) OVER ([partition_clause] [orderby_clause] [frame_clause])
```

#### 功能描述

MAX 函数用于计算并返回指定表达式（expr）在窗口范围内的最大值。该函数常用于数据分析和统计，以便快速获取某个分组或整体数据的最大值。

#### 参数说明

* **expr**: 需要计算最大值的表达式，可以是数值类型、字符串类型、时间类型等可比较的类型。

#### 返回结果

返回值的类型与传入的表达式类型相同。

#### 使用示例

**示例 1：简单使用**

```sql
SELECT name, dep_no, salary, MAX(salary) OVER () AS max_salary FROM VALUES
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
+-----------+--------+--------+------------+
|   name    | dep_no | salary | max_salary |
+-----------+--------+--------+------------+
| Eric      | 1      | 28000  | 35000      |
| Alex      | 1      | 32000  | 35000      |
| Felix     | 2      | 21000  | 35000      |
| Frank     | 1      | 30000  | 35000      |
| Tom       | 2      | 23000  | 35000      |
| Jane      | 3      | 29000  | 35000      |
| Jeff      | 3      | 35000  | 35000      |
| Paul      | 2      | 29000  | 35000      |
| Charles   | 2      | 23000  | 35000      |
| Charles F | 2      | 23000  | 35000      |
| null      | 4      | null   | 35000      |
| NotNull   | 4      | 23000  | 35000      |
+-----------+--------+--------+------------+
```

上述 SQL 语句将返回 employees 表中所有员工的最大工资。

**示例 2：按部门分组**

```sql
SELECT dep_no, salary, MAX(salary) OVER (PARTITION BY dep_no) AS max_salary_by_department FROM VALUES
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
+--------+--------+--------------------------+
| dep_no | salary | max_salary_by_department |
+--------+--------+--------------------------+
| 3      | 29000  | 35000                    |
| 3      | 35000  | 35000                    |
| 1      | 28000  | 32000                    |
| 1      | 32000  | 32000                    |
| 1      | 30000  | 32000                    |
| 2      | 21000  | 29000                    |
| 2      | 23000  | 29000                    |
| 2      | 29000  | 29000                    |
| 2      | 23000  | 29000                    |
| 2      | 23000  | 29000                    |
| 4      | null   | 23000                    |
| 4      | 23000  | 23000                    |
+--------+--------+--------------------------+
```

该语句将返回每个部门员工的最高工资。

**示例 3：结合排序**

```sql
SELECT name, salary, MAX(salary) OVER (ORDER BY salary DESC) AS max_salary_after FROM VALUES
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
+-----------+--------+------------------+
|   name    | salary | max_salary_after |
+-----------+--------+------------------+
| Jeff      | 35000  | 35000            |
| Alex      | 32000  | 35000            |
| Frank     | 30000  | 35000            |
| Jane      | 29000  | 35000            |
| Paul      | 29000  | 35000            |
| Eric      | 28000  | 35000            |
| Tom       | 23000  | 35000            |
| Charles   | 23000  | 35000            |
| Charles F | 23000  | 35000            |
| NotNull   | 23000  | 35000            |
| Felix     | 21000  | 35000            |
| null      | null   | 35000            |
+-----------+--------+------------------+
```

在这个例子中，我们将员工按工资降序排列，并获取每个员工之后的最大工资值。

**示例 4：使用窗口函数**

```sql
SELECT name, dep_no, salary,
 MAX(salary) OVER (PARTITION BY dep_no ORDER BY salary DESC ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS top_two_salary
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
+-----------+--------+--------+----------------+
|   name    | dep_no | salary | top_two_salary |
+-----------+--------+--------+----------------+
| Jeff      | 3      | 35000  | 35000          |
| Jane      | 3      | 29000  | 35000          |
| Alex      | 1      | 32000  | 32000          |
| Frank     | 1      | 30000  | 32000          |
| Eric      | 1      | 28000  | 30000          |
| Paul      | 2      | 29000  | 29000          |
| Tom       | 2      | 23000  | 29000          |
| Charles   | 2      | 23000  | 23000          |
| Charles F | 2      | 23000  | 23000          |
| Felix     | 2      | 21000  | 23000          |
| NotNull   | 4      | 23000  | 23000          |
| null      | 4      | null   | 23000          |
+-----------+--------+--------+----------------+
```
