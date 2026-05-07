### LAST 函数

#### 功能描述

当排序键相同时，LAST 函数返回窗口内最后一行的值。通过使用 LAST 函数，您可以轻松地获取数据集中的特定值，从而进行进一步的数据分析和处理。该函数为非确定性函数。

#### 参数说明

* `expr`：任意类型的表达式，表示要获取的值。
* `ignoreNull`（可选）：布尔值，表示是否忽略 NULL 值。默认为 false，即不忽略 NULL 值。当参数值为 true 时，LAST 函数将返回窗口内最后一条非 NULL 的值。

#### 返回结果

返回值类型与 expr 参数类型相同。

#### 使用示例

1. 基本使用：

   ```sql

   SELECT name, salary, LAST(salary) OVER (PARTITION BY salary ) as min_salary
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

   在这个例子中，我们将忽略工资为 NULL 的记录。

   ```sql
   SELECT name, salary, LAST(salary,true) OVER (PARTITION BY salary ) as min_salary
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
   SELECT name, salary, LAST(salary) OVER (PARTITION BY dep_no ORDER BY dep_no DESC) as min_salary
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

   当您需要对整个数据集应用 LAST 函数时，可以使用 `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING` 子句。

   ```sql
   SELECT name, salary, LAST(salary, true) OVER (ORDER BY salary ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) as global_min_salary
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

