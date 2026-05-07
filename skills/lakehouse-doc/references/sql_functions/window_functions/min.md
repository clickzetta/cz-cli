### MIN 函数

```sql
MIN(expr) OVER ([PARTITION BY clause] [ORDER BY clause] [FRAME clause])
```

#### 功能描述

MIN 函数用于计算并返回窗口内指定表达式（expr）的最小值。该函数常用于数据分析和处理，以便快速获取某个特定分组内的最小数据。

#### 参数说明

* `expr`: 需要计算最小值的表达式，可以是数值类型、字符串类型、时间类型等可比较的类型。

#### 返回结果

* 返回值类型与传入的 `expr` 参数类型相同。

#### 使用示例

**示例 1：简单使用**

```sql

SELECT name, dep_no, salary, MIN(salary) OVER (PARTITION BY dep_no) AS min_salary
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
+-----------+--------+--------+------------+
|   name    | dep_no | salary | min_salary |
+-----------+--------+--------+------------+
| Jane      | 3      | 29000  | 29000      |
| Jeff      | 3      | 35000  | 29000      |
| Eric      | 1      | 28000  | 28000      |
| Alex      | 1      | 32000  | 28000      |
| Frank     | 1      | 30000  | 28000      |
| Felix     | 2      | 21000  | 21000      |
| Tom       | 2      | 23000  | 21000      |
| Paul      | 2      | 29000  | 21000      |
| Charles   | 2      | 23000  | 21000      |
| Charles F | 2      | 23000  | 21000      |
| null      | 4      | null   | 23000      |
| NotNull   | 4      | 23000  | 23000      |
+-----------+--------+--------+------------+
```

上述 SQL 查询语句将返回每个部门的员工姓名、部门编号、薪资以及该部门的最低薪资。

**示例 2：结合 ORDER BY 子句**

```sql
SELECT name, dep_no, salary, MIN(salary) OVER (PARTITION BY dep_no ORDER BY salary) AS min_salary
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
+-----------+--------+--------+------------+
|   name    | dep_no | salary | min_salary |
+-----------+--------+--------+------------+
| Jane      | 3      | 29000  | 29000      |
| Jeff      | 3      | 35000  | 29000      |
| Eric      | 1      | 28000  | 28000      |
| Frank     | 1      | 30000  | 28000      |
| Alex      | 1      | 32000  | 28000      |
| Felix     | 2      | 21000  | 21000      |
| Tom       | 2      | 23000  | 21000      |
| Charles   | 2      | 23000  | 21000      |
| Charles F | 2      | 23000  | 21000      |
| Paul      | 2      | 29000  | 21000      |
| null      | 4      | null   | null       |
| NotNull   | 4      | 23000  | 23000      |
+-----------+--------+--------+------------+
```

此示例将按照每个部门的薪资进行排序，并返回每个部门的最低薪资。

**示例 3：使用窗口函数计算累积最小值**

```sql
SELECT name, dep_no, salary,
       MIN(salary) OVER (PARTITION BY dep_no ORDER BY salary ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_min_salary
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
|   name    | dep_no | salary | cum_min_salary |
+-----------+--------+--------+----------------+
| Jane      | 3      | 29000  | 29000          |
| Jeff      | 3      | 35000  | 29000          |
| Eric      | 1      | 28000  | 28000          |
| Frank     | 1      | 30000  | 28000          |
| Alex      | 1      | 32000  | 28000          |
| Felix     | 2      | 21000  | 21000          |
| Tom       | 2      | 23000  | 21000          |
| Charles   | 2      | 23000  | 21000          |
| Charles F | 2      | 23000  | 21000          |
| Paul      | 2      | 29000  | 21000          |
| null      | 4      | null   | null           |
| NotNull   | 4      | 23000  | 23000          |
+-----------+--------+--------+----------------+
```

在这个示例中，我们将计算每个部门的累积最小薪资，即从每个员工开始到当前员工为止的最小薪资。

^
^
