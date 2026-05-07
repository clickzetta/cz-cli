# 查看Connection详细信息

本功能允许用户查询已创建的 Connection 对象的详细信息，包括其属性、配置等。

## 语法

```SQL
{ DESC | DESCRIBE } CONNECTION [ EXTENDED ] connection_name
```

## 参数说明

* **EXTENDED**：可选关键字，用于显示创建 Connection 时的属性信息。添加此关键字后，查询结果将包含更详细的属性信息。
* **connection\_name**：已创建的 Connection 名称。

## 使用示例

1. 查询名为 `my_connection` 的 Connection 的基本信息：

   ```SQL
   DESC CONNECTION catalog_storage_oss;
   +--------------------+---------------------------------------+
   |     info_name      |              info_value               |
   +--------------------+---------------------------------------+
   | name               | catalog_storage_oss                   |
   | creator            | UAT_TEST                              |
   | created_time       | 2024-12-14 20:09:40.146               |
   | last_modified_time | 2024-12-14 20:09:40.146               |
   | comment            |                                       |
   | properties         | ()                                    |
   | type               | OSS                                   |
   | enabled            | ENABLED                               |
   | ACCESS_ID          | xxxxxt7xb8NouiqLrjfnC1xx              |
   | ENDPOINT           | oss-cn-hangzhou-internal.aliyuncs.com |
   +--------------------+---------------------------------------+
   10 rows selected (0.274 seconds)

   ```

