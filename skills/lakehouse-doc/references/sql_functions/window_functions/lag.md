### LAG 函数

#### 简介

LAG 函数用于获取当前行的前一行或指定行数的行数据。通过使用 LAG 函数，您可以轻松地访问窗口内的前一行数据，以便进行计算或比较。

#### 语法

```sql
LAG(expr[,offset[,default]]) OVER ([partition_clause] orderby_clause)
```

#### 参数说明

* `expr` (任意类型): 需要获取前一行的表达式。
* `offset` (可选，`bigint` 类型常量，默认为 1): 表示从当前行向前移动的行数。当值为 0 时，表示当前行；当值为正数时，表示向前移动的行数；当值为负数时，表示向后移动的行数。
* `default` (可选，与 `expr` 类型相同的常量，默认为 `null`): 当 `offset` 超出窗口边界时使用的默认值。

#### 返回结果

返回与 `expr` 相同的数据类型。

#### 使用示例

1. 获取前一行的数据：

```sql
SELECT a, b, LAG(b) OVER (PARTITION BY a ORDER BY b) as prev_b FROM VALUES ('A', 2), ('A', 1), ('B', 3), ('A', 1) tab(a, b);
```

结果：

```
A	1	null
A	1	1
A	2	1
B	3	null
```

2. 获取前两行的数据：

```sql
SELECT a, b, LAG(b, 2) OVER (PARTITION BY a ORDER BY b) as prev_b FROM VALUES ('A', 2), ('A', 1), ('B', 3), ('A', 1) tab(a, b);
```

结果：

```
A	1	null
A	2	null
A      2        1
B	3	null
```

3. 使用默认值：

```sql
SELECT a, b, LAG(b, 1, 0) OVER (PARTITION BY a ORDER BY b) as prev_b FROM VALUES ('A', 2), ('A', 1), ('B', 3), ('A', 1) tab(a, b);
```

结果：

```
A	1	0
A	1	1
A	2	1
B	3	0
```

#### 总结

LAG 函数是一个非常实用的工具，可以帮助您轻松地访问窗口内的前一行数据。通过调整 offset 和 default 参数，您可以灵活地获取所需的数据。在实际应用中，LAG 函数可以用于计算移动平均、累积和等统计指标。
