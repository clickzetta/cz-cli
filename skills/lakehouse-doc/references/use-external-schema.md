## 功能

本语句用于切换当前数据库中的 schema，以便用户能够更方便地操作和管理不同 schema 下的数据表。

## 语法

```SQL
USE [SCHEMA] schema_name;
```

## 参数说明

1. `SCHEMA`：这是一个可选关键字，您可以使用或省略它。
2. `schema_name`：指定要切换到的 schema 名称。

## 使用示例

1. 切换到名为 `ods_schema` 的 schema：

   ```SQL
   USE ods_schema;
   ```

2. 切换到名为 `reporting_schema` 的 schema，省略 `SCHEMA` 关键字：

   ```SQL
   USE reporting_schema;
   ```

3. 切换到名为 `customer_data` 的 schema，并在切换后执行一些查询操作：

   ```SQL
   USE customer_data;
   SELECT * FROM customer_orders;
   SELECT COUNT(*) FROM customer_orders WHERE order_status = 'completed';
   ```

## 注意事项

- 当您在 SQL 语句中使用 `USE` 切换到某个 schema 后，接下来的查询操作将默认针对该 schema 下的数据表进行。
- 如果您需要在多个 schema 之间频繁切换，可以在 SQL 语句中多次使用 `USE` 语句。
- 在使用 `USE` 语句时，请确保指定的 schema 名称在当前数据库中存在，否则将导致错误。
