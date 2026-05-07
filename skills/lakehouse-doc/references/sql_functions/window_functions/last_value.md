### LAST_VALUE 函数

#### 功能描述
排序键相同时`LAST_VALUE` 函数用于返回在指定窗口内的最后一行的某个表达式的值。该函数在数据分析和处理中非常有用，特别是当你需要获取分组内或整个数据集的最后一个非空值时。

#### 参数说明
- `expr`：任意类型的表达式，其值将被返回。
- `ignoreNull`（可选）：布尔类型常量，默认值为 `false`。当设置为 `true` 时，函数将忽略窗口内的空值（`NULL`），并返回最后一个非空值。

#### 返回结果
返回值的类型与 `expr` 参数的类型相同。

1. 基本使用：

   ```sql

   SELECT name, salary, LAST_VALUE(salary) OVER (PARTITION BY salary ) as min_salary
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
   +-----------+--------+------------+
   |   name    | salary | min_salary |
   +-----------+--------+------------+
   | null      | null   | null       |
   | Eric      | 28000  | 28000      |
   | Jeff      | 35000  | 35000      |
   | Frank     | 30000  | 30000      |
   | Felix     | 21000  | 21000      |
   | Tom       | 23000  | 23000      |
   | Charles   | 23000  | 23000      |
   | Charles F | 23000  | 23000      |
   | NotNull   | 23000  | 23000      |
   | Jane      | 29000  | 29000      |
   | Paul      | 29000  | 29000      |
   | Alex      | 32000  | 32000      |
   +-----------+--------+------------+
   ```

2. 忽略 NULL 值：

   在这个例子中，我们将忽略工资为 NULL 的员工。

   ```sql
   SELECT name, salary, LAST_VALUE(salary,true) OVER (PARTITION BY salary ) as min_salary
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
   +-----------+--------+------------+
   |   name    | salary | min_salary |
   +-----------+--------+------------+
   | null      | null   | null       |
   | Eric      | 28000  | 28000      |
   | Jeff      | 35000  | 35000      |
   | Frank     | 30000  | 30000      |
   | Felix     | 21000  | 21000      |
   | Tom       | 23000  | 23000      |
   | Charles   | 23000  | 23000      |
   | Charles F | 23000  | 23000      |
   | NotNull   | 23000  | 23000      |
   | Jane      | 29000  | 29000      |
   | Paul      | 29000  | 29000      |
   | Alex      | 32000  | 32000      |
   +-----------+--------+------------+
   ```

3. 结合 ORDER BY 使用：

   ```sql
   SELECT name, salary, LAST_VALUE(salary) OVER (PARTITION BY dep_no ORDER BY dep_no DESC) as min_salary
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
   +-----------+--------+------------+
   |   name    | salary | min_salary |
   +-----------+--------+------------+
   | Jane      | 29000  | 35000      |
   | Jeff      | 35000  | 35000      |
   | Eric      | 28000  | 30000      |
   | Alex      | 32000  | 30000      |
   | Frank     | 30000  | 30000      |
   | Felix     | 21000  | 23000      |
   | Tom       | 23000  | 23000      |
   | Paul      | 29000  | 23000      |
   | Charles   | 23000  | 23000      |
   | Charles F | 23000  | 23000      |
   | null      | null   | 23000      |
   | NotNull   | 23000  | 23000      |
   +-----------+--------+------------+
   ```

4. 使用窗口函数：

   当您需要对整个数据集应用 LAST 函数时，可以使用 ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING 子句。

   ```sql
   SELECT name, salary, LAST_VALUE(salary, true) OVER (ORDER BY salary ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) as global_min_salary
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
   +-----------+--------+-------------------+
   |   name    | salary | global_min_salary |
   +-----------+--------+-------------------+
   | null      | null   | 35000             |
   | Felix     | 21000  | 35000             |
   | Tom       | 23000  | 35000             |
   | Charles   | 23000  | 35000             |
   | Charles F | 23000  | 35000             |
   | NotNull   | 23000  | 35000             |
   | Eric      | 28000  | 35000             |
   | Jane      | 29000  | 35000             |
   | Paul      | 29000  | 35000             |
   | Frank     | 30000  | 35000             |
   | Alex      | 32000  | 35000             |
   | Jeff      | 35000  | 35000             |
   +-----------+--------+-------------------+
   ```