### ROW\_NUMBER 函数

#### 概述

`ROW_NUMBER()` 函数用于计算当前分区中当前行的行号，行号从 1 开始，按指定的 `ORDER BY` 子句进行排序。该函数在处理数据时非常有用，特别是当你需要为结果集中的每一行分配一个唯一的序号时。

#### 语法

```sql
ROW_NUMBER() OVER (
  [PARTITION BY partition_expression, ...]
  ORDER BY sort_expression [ASC | DESC]
)
```

#### 参数说明

* `partition_expression`：用于定义分区的表达式，可以有多个，用于将结果集分成多个分区。
* `sort_expression`：用于指定排序的表达式，可以是列名或者表达式，用于在每个分区内对行进行排序。
* `ASC` | `DESC`：可选参数，用于指定排序方向，默认为 `ASC`。

#### 返回结果

* 返回值类型为 `bigint` 类型。
* 返回的行号连续且不重复。

#### 使用示例

1. 基本使用：
   ```sql

     SELECT name, salary, ROW_NUMBER() OVER (ORDER BY salary DESC) AS row_num 
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
   +-----------+--------+---------+
   |   name    | salary | row_num |
   +-----------+--------+---------+
   | Jeff      | 35000  | 1       |
   | Alex      | 32000  | 2       |
   | Frank     | 30000  | 3       |
   | Jane      | 29000  | 4       |
   | Paul      | 29000  | 5       |
   | Eric      | 28000  | 6       |
   | Tom       | 23000  | 7       |
   | Charles   | 23000  | 8       |
   | Charles F | 23000  | 9       |
   | NotNull   | 23000  | 10      |
   | Felix     | 21000  | 11      |
   | null      | null   | 12      |
   +-----------+--------+---------+
   ```

2. 使用分区：
   ```sql
   SELECT name,dep_no, salary, RANK() OVER (PARTITION BY dep_no ) AS row_num 
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
   +-----------+--------+--------+---------+
   |   name    | dep_no | salary | row_num |
   +-----------+--------+--------+---------+
   | Jane      | 3      | 29000  | 1       |
   | Jeff      | 3      | 35000  | 1       |
   | Eric      | 1      | 28000  | 1       |
   | Alex      | 1      | 32000  | 1       |
   | Frank     | 1      | 30000  | 1       |
   | Felix     | 2      | 21000  | 1       |
   | Tom       | 2      | 23000  | 1       |
   | Paul      | 2      | 29000  | 1       |
   | Charles   | 2      | 23000  | 1       |
   | Charles F | 2      | 23000  | 1       |
   | null      | 4      | null   | 1       |
   | NotNull   | 4      | 23000  | 1       |
   +-----------+--------+--------+---------+
   ```

3. 多列排序：
   ```sql
   SELECT name,dep_no, salary, ROW_NUMBER() OVER (PARTITION BY dep_no ORDER BY salary DESC,name ASC) AS row_num 
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
   +-----------+--------+--------+---------+
   |   name    | dep_no | salary | row_num |
   +-----------+--------+--------+---------+
   | Jeff      | 3      | 35000  | 1       |
   | Jane      | 3      | 29000  | 2       |
   | Alex      | 1      | 32000  | 1       |
   | Frank     | 1      | 30000  | 2       |
   | Eric      | 1      | 28000  | 3       |
   | Paul      | 2      | 29000  | 1       |
   | Charles   | 2      | 23000  | 2       |
   | Charles F | 2      | 23000  | 3       |
   | Tom       | 2      | 23000  | 4       |
   | Felix     | 2      | 21000  | 5       |
   | NotNull   | 4      | 23000  | 1       |
   | null      | 4      | null   | 2       |
   +-----------+--------+--------+---------+
   ```

#### 注意事项

* `ROW_NUMBER()` 函数对于每个分区都是独立的，即每个分区都会有自己的行号序列。
* 使用 `ROW_NUMBER()` 函数时，应确保 `ORDER BY` 子句中的排序键是唯一的，以避免产生非连续的行号。
* 当 `ORDER BY` 子句中的排序键存在相同值时，默认情况下 `ROW_NUMBER()` 函数会产生非连续的行号。如果需要连续的行号，可以考虑使用 `DENSE_RANK()` 函数。


