### COUNT_DISTINCT 函数

```
count_distinct(expr)
```

#### 功能描述

`COUNT_DISTINCT` 函数用于计算指定列中不同值（去重后）的数量。这是一个聚合函数，等价于 `COUNT(DISTINCT expr)`，但在某些场景下优化器可能会做特殊优化。

#### 参数说明

* `expr`：任意类型的表达式，要计算其不同值的数量。

#### 返回类型

* 返回 `BIGINT` 类型（非空）。
* 返回不同值的数量。

#### 注意事项

* 函数计算过程中，`NULL` 值会被忽略，不计入结果。
* 如果所有值都是 `NULL`，返回 0。
* 如果输入为空集，返回 0。
* `COUNT_DISTINCT` 需要维护所有不同值的集合，内存开销较大。对于大数据集，如果只需要近似值，考虑使用 `APPROX_COUNT_DISTINCT`。

#### 使用示例

1. 基本用法：计算不同值的数量

```sql
SELECT count_distinct(city)
FROM VALUES ('Beijing'), ('Shanghai'), ('Beijing'), ('Shenzhen') AS t(city);
+------------------------+
| count_distinct(city)   |
+------------------------+
| 3                      |
+------------------------+
```

2. 等价于 COUNT(DISTINCT ...)

```sql
SELECT count_distinct(city), COUNT(DISTINCT city)
FROM VALUES ('Beijing'), ('Shanghai'), ('Beijing'), ('Shenzhen') AS t(city);
+------------------------+----------------------+
| count_distinct(city)   | COUNT(DISTINCT city) |
+------------------------+----------------------+
| 3                      | 3                    |
+------------------------+----------------------+
```

3. NULL 值被忽略

```sql
SELECT count_distinct(value)
FROM VALUES (1), (2), (NULL), (1), (NULL), (3) AS t(value);
+-------------------------+
| count_distinct(value)   |
+-------------------------+
| 3                       |
+-------------------------+
```

4. 所有值都是 NULL 时返回 0

```sql
SELECT count_distinct(value)
FROM VALUES (NULL), (NULL), (NULL) AS t(value);
+-------------------------+
| count_distinct(value)   |
+-------------------------+
| 0                       |
+-------------------------+
```

5. 按分组计算不同值数量

```sql
SELECT dept, count_distinct(name) as unique_employees
FROM VALUES
  ('Sales', 'Alice'),
  ('Sales', 'Bob'),
  ('Sales', 'Alice'),
  ('IT', 'Charlie'),
  ('IT', 'David'),
  ('IT', 'Charlie')
AS employees(dept, name)
GROUP BY dept;
+-------+------------------+
| dept  | unique_employees |
+-------+------------------+
| Sales | 2                |
| IT    | 2                |
+-------+------------------+
```
