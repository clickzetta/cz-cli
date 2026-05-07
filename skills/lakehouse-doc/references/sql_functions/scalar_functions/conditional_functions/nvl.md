### NVL 函数

```
nvl(expr1, expr2)
```

#### 功能描述
NVL 函数用于处理 SQL 查询中的 NULL 值。当 expr1 的值为 NULL 时，NVL 函数返回 expr2 的值，否则返回 expr1 的值。这个函数可以确保返回的结果不包含 NULL 值，便于后续的数据处理和分析。

#### 参数说明
- expr1：任意类型的表达式，当其值为 NULL 时，将使用 expr2 的值作为替代。
- expr2：与 expr1 类型相同的表达式，当 expr1 为 NULL 时，作为替代值返回。

#### 返回结果
返回结果的类型与 expr1 和 expr2 的类型相同。

#### 使用示例

1. 查询员工工资，如果某员工工资为 NULL，则显示为 "未知"：
```sql
SELECT name, nvl(salary, '未知') AS salary FROM employees;
```

2. 计算订单总金额，如果某个订单的金额为 NULL，则将其金额视为 0：
```sql
SELECT order_id, nvl(amount, 0) AS total_amount FROM orders;
```

3. 比较两个数值型字段，如果其中一个字段为 NULL，则返回另一个字段的值：
```sql
SELECT product_id, nvl(column1, column2) AS result FROM products;
```

4. 根据学生考试成绩判断是否及格，如果成绩为 NULL，则将其视为及格：
```sql
SELECT student_id, nvl(score, 60) AS adjusted_score FROM student_scores;
```

通过以上示例，您可以看到 NVL 函数在处理 SQL 查询中的 NULL 值时非常有用。它可以帮助您在数据分析和报表生成中避免因 NULL 值而产生的问题。