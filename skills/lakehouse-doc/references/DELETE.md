# 删除表中的行

## 功能
本功能允许您从指定的表中删除一行或多行数据。通过使用 WHERE 子句，您可以精确地指定需要删除的行。

## 语法

```SQL
DELETE FROM table_name WHERE condition;
```

### 必填参数

* `<table_name>`：指定您希望从中删除数据的表名。
* `<condition>`：定义删除操作的条件，可以使用 WHERE 子句中的各种表达式和子查询。

## 使用示例

1. 从名为 "employees" 的表中删除所有年龄大于 30 岁的员工：

   ```SQL
   DELETE FROM employees WHERE age > 30;
   ```

2. 从 "products" 表中删除价格低于 50 元的所有产品：

   ```SQL
   DELETE FROM products WHERE price < 50;
   ```

3. 删除 "customers" 表中名字为 "张三" 的所有客户记录：

   ```SQL
   DELETE FROM customers WHERE name = '张三';
   ```

4. 通过子查询删除 "orders" 表中所有已取消的订单：

   ```SQL
   DELETE FROM orders WHERE order_id IN (SELECT order_id FROM order_details WHERE status = 'cancelled');
   ```


## 注意事项

* 请谨慎使用 DELETE 语句，因为删除操作是不可逆的。
* 在执行删除操作之前，请确保您已备份相关数据，以防意外删除重要信息。
* 您可以使用 WHERE 子句限制删除的范围，如果没有指定 WHERE 条件，将会删除表中的所有行。