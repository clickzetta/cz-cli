### DENSE\_RANK 函数

#### 概述

`DENSE_RANK` 函数是一个窗口函数，用于计算当前行在指定分区中的连续排名，排名从1开始。当 `ORDER BY` 子句中的值相同时，`DENSE_RANK` 函数会生成相同的排名，但排名的数字不会跳跃。

#### 语法

```sql
DENSE_RANK() OVER ([PARTITION_clause] [ORDER_BY_clause])
```

#### 参数说明

* `PARTITION_clause` (可选)：指定分区的子句，用于将数据集划分为不同的分区。如果未指定分区，则对整个数据集应用排名。
* `ORDER_BY_clause`：指定用于对数据进行排序的列或表达式。

#### 返回类型

返回值类型为 `bigint` 类型。

#### 使用示例

1. 基本使用

```sql

SELECT 
       name,
       salary,
       dense_rank() OVER (PARTITION BY dep_no ORDER BY salary DESC) AS salary_rank
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
  ('null',4,null)
AS tab(name, dep_no, salary);
+-----------+--------+-------------+
|   name    | salary | salary_rank |
+-----------+--------+-------------+
| Jeff      | 35000  | 1           |
| Jane      | 29000  | 2           |
| Alex      | 32000  | 1           |
| Frank     | 30000  | 2           |
| Eric      | 28000  | 3           |
| Paul      | 29000  | 1           |
| Tom       | 23000  | 2           |
| Charles   | 23000  | 2           |
| Charles F | 23000  | 2           |
| Felix     | 21000  | 3           |
| null      | null   | 1           |
+-----------+--------+-------------+
```

在此示例中，我们根据部门ID对员工进行分区，并按工资降序排列，计算每个员工在其所在部门中的薪资排名。

2. 无分区排名

```sql
SELECT 
       name,
       salary,
       dense_rank() OVER ( ORDER BY salary DESC) AS salary_rank
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
  ('null',4,null)
AS tab(name, dep_no, salary);
+---------+--------+-------------+
|  name   | salary | salary_rank |
+---------+--------+-------------+
| Jeff    | 35000  | 1           |
| Alex    | 32000  | 2           |
| Frank   | 30000  | 3           |
| Jane    | 29000  | 4           |
| Paul    | 29000  | 4           |
| Eric    | 28000  | 5           |
| Tom     | 23000  | 6           |
| Charles | 23000  | 6           |
| Felix   | 21000  | 7           |
| null    | null   | 8           |
+---------+--------+-------------+
```

在这个例子中，我们没有指定分区，因此将计算整个产品数据集中的库存排名，按库存数量升序排列。

3. 多列排序

```sql
SELECT student_id,
       student_name,
       exam_score,
       dense_rank() OVER (PARTITION BY exam_subject ORDER BY exam_score DESC, student_name ASC) AS score_rank
FROM exam_results;
```

在这个示例中，我们首先按考试科目进行分区，然后按考试成绩降序排列，如果成绩相同，则按学生姓名升序排列，计算每个学生在各科目考试中的排名。

#### 注意事项

* 当 `ORDER BY` 子句中的值相同时，`DENSE_RANK` 函数不会生成跳跃的排名，排名将重复。
* 与 `RANK()` 函数相比，`DENSE_RANK()` 函数在处理相同值时具有更紧凑的排名，而 `RANK()` 函数会产生有间断的排名。
* 在使用 `DENSE_RANK()` 函数时，请确保 `ORDER BY` 子句正确地反映了您希望对数据进行排序的方式。

^
