# 更新表记录

## 功能描述
更新数据库表中的记录，将指定的字段值修改为新的值。

## 语法格式
```SQL
UPDATE target_table
       SET column_name1 = new_value1 [ , column_name2 = new_value2 , ... ]
  [ WHERE condition ]
[ORDER BY ...] 
[LIMIT row_count]
```

**必选参数**

- `target_table`：需要更新记录的目标表名。
- `column_name`：需要更新的列名。
- `new_value`：新的值，可以是常量、变量、函数调用、算术运算符、字符串操作等。支持子查询。

**可选参数**
- `condition`：更新操作的条件，用于限定哪些记录需要被更新。条件可以包含子查询和表达式。
- `ORDER BY ...`‌按指定列排序后更新：
  * 通常与 `LIMIT` 配合使用，控制更新顺序。
  * 适用于分批更新或按优先级处理数据（如先处理最新记录）。
- `LIMIT row_count`：限制更新的最大行数：
  * 常用于分批更新大数据表，避免锁表或事务过长。
  * 需配合 `ORDER BY` 确保更新顺序的确定性。


## 使用示例

### 示例1：更新单个字段值
假设我们有一个名为`employees`的表，包含员工的ID、姓名和工资。现在我们要将ID为1的员工的工资增加1000元。

```SQL
UPDATE employees
SET salary = salary + 1000
WHERE id = 1;
```

### 示例2：同时更新多个字段值
继续使用`employees`表，现在我们要将ID为1的员工的工资增加1000元，并将职位从"Developer"更改为"Senior Developer"。

```SQL
UPDATE employees
SET salary = salary + 1000, position = 'Senior Developer'
WHERE id = 1;
```

### 示例3：使用子查询更新字段值
假设我们有一个名为`orders`的表，包含订单ID、客户ID和订单金额。我们还有一个名为`customers`的表，包含客户ID、姓名和会员等级。现在我们要将所有VIP客户的订单金额增加10%。

```SQL
UPDATE orders
SET amount = amount * 1.1
WHERE customer_id IN (
  SELECT id
  FROM customers
  WHERE membership_level = 'VIP'
);
```
### 示例4：UPDATE语句带有ORDER BY
```
UPDATE t SET id = id + 1 ORDER BY id DESC;
```

## 注意事项
- 在执行更新操作时，请确保`WHERE`子句正确无误，以免错误地更新了不应该更新的记录。
- 在对生产环境进行更新操作之前，建议先在测试环境中进行验证。
