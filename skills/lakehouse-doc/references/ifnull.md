## IFNULL 函数

IFNULL 函数是一个逻辑函数，用于处理 SQL 查询中可能出现的 NULL 值。当第一个参数的值为 NULL 时，IFNULL 函数返回第二个参数的值；如果第一个参数的值不为 NULL，则返回第一个参数的值。

### 语法

```sql
IFNULL(expression_1, expression_2)
```

- `expression_1`：需要检查的表达式，通常是一个字段名。
- `expression_2`：当 `expression_1` 为 NULL 时，要返回的值。

### 使用说明

- `expression_1` 和 `expression_2` 的数据类型必须相同或兼容。
- 如果 `expression_1` 和 `expression_2` 的数据类型不兼容，IFNULL 函数将返回 NULL。
- IFNULL 函数的返回值是 `expression_1` 或 `expression_2` 的数据类型。

### 示例

假设有一个名为 `student` 的表，包含以下列：

- `id`：学生的唯一标识。
- `name`：学生的姓名。
- `score`：学生的成绩。

表 `student` 的数据如下：

| id | name  | score |
|----|-------|-------|
| 1  | Alice | 90    |
| 2  | Bob   | NULL  |
| 3  | Cathy | 80    |
| 4  | David | NULL  |

现在，我们想要查询每个学生的姓名和成绩，将成绩为 NULL 的记录替换为 0。可以使用以下 SQL 语句：

```sql
SELECT name, IFNULL(score, 0) AS score FROM student;
```

查询结果如下：

| name  | score |
|-------|-------|
| Alice | 90    |
| Bob   | 0     |
| Cathy | 80    |
| David | 0     |

### 更多示例

1. 查询学生的姓名和年龄，如果年龄为 NULL，则显示为 "Unknown"：

```sql
SELECT name, IFNULL(age, 'Unknown') AS age FROM student;
```

2. 查询员工的姓名和工资，如果工资为 NULL，则显示为 "Not available"：

```sql
SELECT name, IFNULL(salary, 'Not available') AS salary FROM employee;
```

3. 查询产品的名称和库存数量，如果库存数量为 NULL，则显示为 "Out of stock"：

```sql
SELECT product_name, IFNULL(stock_quantity, 'Out of stock') AS stock FROM products;
```

通过使用 IFNULL 函数，我们可以确保查询结果中不会出现 NULL 值，从而提高数据的可读性和可用性。