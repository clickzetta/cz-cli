### RANK 函数

#### 概述

`RANK()` 函数用于计算当前行在指定分区中的排名。排名从 1 开始，根据 `ORDER BY` 子句中的值进行排序。若存在相同的排序值，`RANK()` 函数会将相同的排名分配给这些行，并将下一个排名跳过。

#### 语法

```sql
RANK() OVER ([PARTITION BY column_name | column_name, ...] [ORDER BY column_name [ASC|DESC], ...])
```

#### 参数说明

* `PARTITION BY`：可选参数，用于将数据分区。可以指定一个或多个列名，对数据进行分区。
* `ORDER BY`可选参数，用于指定排序的列和排序方式（升序或降序）。

#### 返回值

* 返回值类型为 bigint 类型。
* 返回值可能不连续，可能重复。若存在相同的 `ORDER BY` 值，结果相同，为第一个 `ORDER BY` 行的排名。

#### 示例

1. 基本使用
   我们可以使用 `RANK()` 函数来计算每个员工的薪水排名。
   ```sql
   SELECT name, salary, RANK() OVER (ORDER BY salary DESC) AS rank 
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
   +-----------+--------+------+
   |   name    | salary | rank |
   +-----------+--------+------+
   | Jeff      | 35000  | 1    |
   | Alex      | 32000  | 2    |
   | Frank     | 30000  | 3    |
   | Jane      | 29000  | 4    |
   | Paul      | 29000  | 4    |
   | Eric      | 28000  | 6    |
   | Tom       | 23000  | 7    |
   | Charles   | 23000  | 7    |
   | Charles F | 23000  | 7    |
   | NotNull   | 23000  | 7    |
   | Felix     | 21000  | 11   |
   | null      | null   | 12   |
   +-----------+--------+------+
   ```

2. 分区使用
   如果我们想要根据员工的部分（grade）来计算薪水排名，可以使用 `PARTITION BY` 子句。

```SQL
 SELECT name,dep_no, salary, RANK() OVER (PARTITION BY dep_no ORDER BY salary DESC) AS rank 
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
   +-----------+--------+--------+------+
   |   name    | dep_no | salary | rank |
   +-----------+--------+--------+------+
   | Jeff      | 3      | 35000  | 1    |
   | Jane      | 3      | 29000  | 2    |
   | Alex      | 1      | 32000  | 1    |
   | Frank     | 1      | 30000  | 2    |
   | Eric      | 1      | 28000  | 3    |
   | Paul      | 2      | 29000  | 1    |
   | Tom       | 2      | 23000  | 2    |
   | Charles   | 2      | 23000  | 2    |
   | Charles F | 2      | 23000  | 2    |
   | Felix     | 2      | 21000  | 5    |
   | NotNull   | 4      | 23000  | 1    |
   | null      | 4      | null   | 2    |
   +-----------+--------+--------+------+
```

3. 多列排序
   如果我们需要根据两个或更多列进行排序，可以在 `ORDER BY` 子句中指定这些列。
   ```sql
   SELECT name,dep_no, salary, RANK() OVER (PARTITION BY dep_no ORDER BY salary DESC,name ASC) AS rank 
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
   +-----------+--------+--------+------+
   |   name    | dep_no | salary | rank |
   +-----------+--------+--------+------+
   | Jeff      | 3      | 35000  | 1    |
   | Jane      | 3      | 29000  | 2    |
   | Alex      | 1      | 32000  | 1    |
   | Frank     | 1      | 30000  | 2    |
   | Eric      | 1      | 28000  | 3    |
   | Paul      | 2      | 29000  | 1    |
   | Charles   | 2      | 23000  | 2    |
   | Charles F | 2      | 23000  | 3    |
   | Tom       | 2      | 23000  | 4    |
   | Felix     | 2      | 21000  | 5    |
   | NotNull   | 4      | 23000  | 1    |
   | null      | 4      | null   | 2    |
   +-----------+--------+--------+------+
   ```

#### 注意事项

* `RANK()` 函数可能在存在相同排序值的情况下产生不连续的排名。
* 使用 `RANK()` 函数时，确保 `ORDER BY` 子句中的列与您希望根据其排名的列相匹配。


