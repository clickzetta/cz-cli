# Clickzetta Lakehouse约束属性概述

Clickzetta Lakehouse支持多种约束属性，以满足用户在数据写入、更新和维护过程中的需求。本文档将详细介绍Clickzetta Lakehouse的约束属性，并通过实例演示如何使用这些属性。

## ANSI SQL约束属性

ANSI SQL约束属性主要涉及以下几个方面：

1. **ENFORCED | NOT ENFORCED**：指定是否强制执行约束。ENFORCED表示强制执行约束，NOT ENFORCED表示不强制执行约束。
2. **DEFERRABLE | NOT DEFERRABLE**：指定延迟执行和非延迟执行。DEFERRABLE表示可以延迟执行约束，NOT DEFERRABLE表示立即执行约束。
3. **INITIALLY { DEFERRED | IMMEDIATE** }：指定校验的时机。如果约束属性为NOT DEFERRABLE，则只能是INITIALLY IMMEDIATE。

### 使用示例

假设我们有一个订单表`orders`，其中包含以下字段：

- `order_id`：订单ID，为主键。
- `customer_id`：客户ID，为外键。
- `order_date`：订单日期。
- `total_amount`：订单总金额。

我们可以为`orders`表定义以下约束：

```sql
CREATE TABLE orders (
  order_id INT PRIMARY KEY ENFORCED,
  customer_id INT REFERENCES customers DEFERRABLE INITIALLY DEFERRED,
  UNIQUE (customer_id, order_date) ENFORCED
);
```

在这个例子中，我们为`order_id`指定了ENFORCED属性，以确保每个订单都有一个唯一的ID。对于`customer_id`，我们使用了DEFERRABLE和INITIALLY DEFERRED属性，允许在插入数据时暂时违反外键约束。最后，我们为`customer_id`和`order_date`定义了一个唯一约束，以确保每个客户在同一天只能有一个订单。

## 扩展的约束状态

Clickzetta Lakehouse扩展的约束状态主要用于主键、外键和唯一键。这些约束状态包括：

1. **ENABLE | DISABLE**：指定约束是禁用还是启动。ENABLE表示启动约束，DISABLE表示禁用约束。
2. **VALIDATE | NOVALIDATE**：指定是否验证表上已有的数据，并创建索引。VALIDATE表示需要验证并创建索引，NOVALIDATE表示不需要验证和创建索引。
3. **RELY | NORELY**：当指定NOVALIDATE为RELY时，查询优化器会使用此属性，提高查询性能。

### 使用示例

假设我们有一个销售记录表`sales`，其中包含以下字段：

- `sale_id`：销售记录ID，为主键。
- `product_id`：产品ID，为外键。
- `sale_date`：销售日期。
- `amount`：销售金额。

我们可以为`sales`表定义以下约束：

```sql
CREATE TABLE sales (
  sale_id INT PRIMARY KEY ENABLE VALIDATE RELY,
  product_id INT REFERENCES products DISABLE NOVALIDATE NORELY
);
```

在这个例子中，我们为`sale_id`指定了ENABLE、VALIDATE和RELY属性，以确保每个销售记录都有一个唯一的ID，并在插入数据时验证外键约束。对于`product_id`，我们使用了DISABLE、NOVALIDATE和NORELY属性，表示在插入数据时不验证外键约束，同时查询优化器可以提高查询性能。

## 云器Lakehouse约束属性

云器Lakehouse约束属性为ENABLE VALIDATE RELY，强制执行约束校验。需要注意的是，这种约束属性只支持使用Java SDK进行写入，不支持使用SQL进行插入。

### 使用示例

假设我们有一个用户表`users`，其中包含以下字段：

- `user_id`：用户ID，为主键。
- `username`：用户名。
- `email`：电子邮件地址。

我们可以使用Java SDK为`users`表定义以下约束：

```java
Table table = session.getTable("users");
TableSchema schema = table.getSchema();
PrimaryKeyConstraint primaryKeyConstraint = new PrimaryKeyConstraint("user_id");
schema.addConstraint(primaryKeyConstraint);
UniqueConstraint uniqueConstraint = new UniqueConstraint("username");
schema.addConstraint(uniqueConstraint);
session.createTable("users", schema, true);
```

在这个例子中，我们使用Java SDK创建了一个`users`表，并为其定义了一个主键约束和一个唯一约束。这些约束将强制执行，确保每个用户都有一个唯一的ID和用户名。由于使用了云器Lakehouse约束属性，我们无法通过SQL插入数据，只能使用Java SDK进行写入。