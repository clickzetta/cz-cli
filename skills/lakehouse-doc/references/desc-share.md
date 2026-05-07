# 查看共享数据对象信息

## 功能描述

`DESC SHARE` 语句用于查询指定共享数据对象（share）中包含的具体数据对象，如表、视图和模式（schema）等。通过该语句，用户可以了解共享数据对象的详细信息，包括对象类型、名称、共享时间等。

## 语法格式

```
DESC SHARE <instance_name>.<share_name>;
```

## 参数说明

* **instance_name**：提供 share 的服务实例名称。`SHOW SHARES;` 语句中的 `provider_instance` 字段返回该名称。
* **share_name**：需要查询的共享数据对象名称。

## 返回说明

* **kind**：添加到共享数据对象中的数据对象类型，通常包括 schema、table 和 view。
* **name**：被分享的数据对象名称。对于 schema 类型，直接返回其名称；对于 table 和 view 类型，返回格式为 `<schema_name>.<table_name>` 或 `<schema_name>.<view_name>`。
* **shared_on**：数据对象被添加到共享数据对象中的时间。

## 使用示例

以下是一些使用 `DESC SHARE` 语句的示例：

1. 查询名为 `customer_data` 的共享数据对象中包含的数据对象信息：

   ```
   DESC SHARE customer_data;
   ```

   可能的返回结果：

   ```
   kind | name               | shared_on
   -----|--------------------|----------
   schema | customer           | 2022-01-01 10:00:00
   table  | customer.orders     | 2022-01-02 14:30:00
   view   | customer.order_summary | 2022-01-03 09:20:00
   ```

2. 查询从 instance_name 为 `share_demo` 的实例分享来的、名称为 `financial_data` 的共享数据对象中包含的表和视图信息：

   ```
   DESC SHARE share_demo.financial_data;
   ```

   可能的返回结果：

   ```
   kind | name                  | shared_on
   -----|-----------------------|----------
   table  | financial.transactions  | 2022-02-01 11:15:00
   view   | financial.revenue_summary | 2022-02-02 16:45:00
   ```

通过以上示例，用户可以了解如何使用 `DESC SHARE` 语句查询共享数据对象的详细信息，并根据实际需求进行相应的操作。
