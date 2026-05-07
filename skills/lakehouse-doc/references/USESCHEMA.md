### 功能描述

`USE SCHEMA` 语句旨在改变当前会话的默认 SCHEMA 设置。当您执行此操作后，所有未明确指定 SCHEMA 的 SQL 查询和命令都将在新设定的 SCHEMA 范围内执行。这有助于简化 SQL 语句的编写，提高工作效率。

### 语法

```SQL
USE [SCHEMA] schema_name;
```

### 参数说明

- `schema_name`: 您希望切换至的目标 SCHEMA 名称。

### 使用示例

1. 切换至名为 `reporting` 的 SCHEMA：

   ```SQL
   USE reporting;
   ```

2. 在执行一系列针对 `sales` 数据表的操作时，首先切换至相应的 SCHEMA：

   ```SQL
   USE sales_schema;
   SELECT * FROM sales_data;
   UPDATE sales_data SET quantity = 100 WHERE product_id = 12;
   ```

3. 当需要在不同的 SCHEMA 之间频繁切换时，可以通过 `USE` 语句快速定位至特定的数据集合：

   ```SQL
   -- 从当前的 sales_schema 切换至 customer_schema
   USE customer_schema;
   -- 查询客户信息
   SELECT * FROM customers;
   -- 切换回 sales_schema
   USE sales_schema;
   ```

4. 如果您希望在创建表时指定 SCHEMA，但不想立即切换至该 SCHEMA，可以在创建表的语句中包含 SCHEMA 名称，而无需使用 `USE` 语句：

   ```SQL
   CREATE TABLE finance_schema.ledger (
     id INT PRIMARY KEY,
     amount DECIMAL(10, 2) NOT NULL
   );
   ```

## 注意事项
- 在使用客户端工具（如[客户端SQLLine](<connect-with-cli.md>)、[DBeaver](<eco_integration/dbeaver-lakehouse.md>)等）连接时，相关操作会在整个会话期间生效。而如果您使用 Lakehouse Studio 界面，建议优先通过页面来切换 Schema 和计算集群。需要说明的是，若直接使用相关命令，其效果仅临时生效，且要和需要执行的SQL一起选中执行方可生效。
![](.topwrite/assets/image_1741317824124.png)
