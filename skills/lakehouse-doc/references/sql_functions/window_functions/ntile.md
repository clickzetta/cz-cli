### NTILE 函数

```sql
ntile(n) over ([partition_clause] [orderby_clause])
```

#### 功能描述

NTILE 函数用于将数据集按照顺序划分为 n 个等份（桶），并为每个数据项分配一个桶编号。当数据集无法被均匀划分为 n 个等份时，前面的桶将优先分配额外的数据项。此函数通常用于数据分析和分组。

#### 参数说明

* `n` (bigint 类型常量)：划分的桶数量。

#### 返回结果

* 返回一个 bigint 类型的桶编号。

#### 使用示例

1. 简单使用：

```sql
SELECT name, dep_no,salary,NTILE(4) OVER (ORDER BY salary) AS quartile
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
+-----------+--------+--------+----------+
|   name    | dep_no | salary | quartile |
+-----------+--------+--------+----------+
| null      | 4      | null   | 1        |
| Felix     | 2      | 21000  | 1        |
| Tom       | 2      | 23000  | 1        |
| Charles   | 2      | 23000  | 2        |
| Charles F | 2      | 23000  | 2        |
| NotNull   | 4      | 23000  | 2        |
| Eric      | 1      | 28000  | 3        |
| Jane      | 3      | 29000  | 3        |
| Paul      | 2      | 29000  | 3        |
| Frank     | 1      | 30000  | 4        |
| Alex      | 1      | 32000  | 4        |
| Jeff      | 3      | 35000  | 4        |
+-----------+--------+--------+----------+
```

此示例将员工按照薪资从低到高的顺序划分为 4 个等份（四分位数），并为每个员工分配一个桶编号。
