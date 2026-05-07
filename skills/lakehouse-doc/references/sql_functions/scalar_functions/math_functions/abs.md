### ABS 函数
#### 简介
`ABS` 函数用于计算给定数值表达式的绝对值。无论输入的数值是正数还是负数，`ABS` 函数都能返回相应的非负值。

#### 语法
```sql
ABS(expr)
```
#### 参数
- `expr`: 需要计算绝对值的数值类型表达式，可以是 `smallint`, `tinyint`, `int`, `bigint`, `decimal`, `double` 或 `float`。

#### 返回结果
返回参数 `expr` 的绝对值，返回值类型与输入参数类型一致。

#### 使用示例
1. 计算一个负整数的绝对值：
   ```sql
   SELECT ABS(-10); -- 返回结果为 10
   ```
2. 计算一个正整数的绝对值：
   ```sql
   SELECT ABS(5); -- 返回结果为 5
   ```
3. 计算一个小数的绝对值：
   ```sql
   SELECT ABS(-3.14); -- 返回结果为 3.14
   ```
4. 计算一个带有小数点的负数的绝对值：
   ```sql
   SELECT ABS(-0.5); -- 返回结果为 0.5
   ```
5. 计算一个 `decimal` 类型的绝对值：
   ```sql
   SELECT ABS(-123.456); -- 返回结果为 123.456
   ```
6. 在一个查询中使用 `ABS` 函数来获取员工工资的绝对值：
   ```sql
   SELECT employee_name, ABS(salary - 100) AS adjusted_salary
   FROM employees;
   -- 返回结果中，每名员工的 `adjusted_salary` 将显示为工资与 100 的差值的绝对值
   ```

#### 注意事项
- 当 `expr` 为 `NULL` 时，`ABS` 函数将返回 `NULL`。
- `ABS` 函数可以与其他 SQL 函数结合使用，例如在排序或过滤查询时。

