### 百分比排名函数（PERCENT\_RANK）

#### 概述

`PERCENT_RANK` 函数用于计算指定行在其所在分区中的百分比排名。该函数会根据 `ORDER BY` 子句指定的排序顺序对数据进行排序，并计算每个分区中各行的排名。其返回值是一个 `double` 类型，值域在 [0.0, 1.0] 范围内。具体计算公式为 `(当前行排名 - 1) / (分区总行数 - 1)`。当分区中只有一行时，返回值为 0。

#### 使用方法

```sql
PERCENT_RANK() OVER (
    [PARTITION BY partition_expression, ...]
    [ORDER BY sort_expression [ASC | DESC], ...]
)
```

* `PARTITION BY` 子句（可选）：指定用于分区的表达式，可以有多个。如果省略此子句，将使用整个结果集作为一个分区。
* `ORDER BY` 子句：指定用于排序的表达式，可以有多个，并可指定排序方向（升序 ASC 或降序 DESC）。

#### 示例

以下示例展示了如何使用 `PERCENT_RANK` 函数计算不同部门人员的薪水排名百分比。

```sql
SELECT    name, dep_no,salary,
PERCENT_RANK() OVER (PARTITION BY dep_no ORDER BY  salary DESC) AS PERCENT_RANK
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
+-----------+--------+--------+--------------+
|   name    | dep_no | salary | PERCENT_RANK |
+-----------+--------+--------+--------------+
| Jeff      | 3      | 35000  | 0.0          |
| Jane      | 3      | 29000  | 1.0          |
| Alex      | 1      | 32000  | 0.0          |
| Frank     | 1      | 30000  | 0.5          |
| Eric      | 1      | 28000  | 1.0          |
| Paul      | 2      | 29000  | 0.0          |
| Tom       | 2      | 23000  | 0.25         |
| Charles   | 2      | 23000  | 0.25         |
| Charles F | 2      | 23000  | 0.25         |
| Felix     | 2      | 21000  | 1.0          |
| NotNull   | 4      | 23000  | 0.0          |
| null      | 4      | null   | 1.0          |
+-----------+--------+--------+--------------+
```


