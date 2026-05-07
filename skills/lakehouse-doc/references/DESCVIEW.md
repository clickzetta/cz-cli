## 功能

本命令用于查看视图的结构，包括视图的字段、类型等。

## 语法

```
DESC[RIBE] [TABLE] [EXTENDED] view_name;
```

**参数说明**

1. `DESC[RIBE]`：DESC和DESCRIBE可以互换使用，都表示查看视图结构的命令。
2. `view_name`：指定需要查看结构的视图名称。

可选参数：

3. `EXTENDED`：加上此关键字后，可以展示包括定义视图的SQL语句.

## 使用示例

### 1. 查看视图结构（不使用EXTENDED关键字）

```
DESC customer_masked;
+-------------+-----------+---------+
| column_name | data_type | comment |
+-------------+-----------+---------+
| id          | int       |         |
| name        | string    |         |
| phone       | string    |         |
| email       | string    |         |
+-------------+-----------+---------+

```

执行该命令后，将显示`my_view`视图的结构信息，包括字段名、类型、是否允许为空、键信息等。

### 2. 查看视图结构及扩展信息（使用EXTENDED关键字）

```
DESCRIBE EXTENDED customer_masked;
+------------------------------+---------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
|         column_name          |                                                                                    data_type                                                                              |
+------------------------------+---------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| id                           | int                                                                                                                                                                       |
| name                         | string                                                                                                                                                                    |
| phone                        | string                                                                                                                                                                    |
| email                        | string                                                                                                                                                                    |
|                              |                                                                                                                                                                           |
| # detailed table information |                                                                                                                                                                           |
| schema                       | public                                                                                                                                                                    |
| name                         | customer_masked                                                                                                                                                           |
| creator                      | UAT_TEST                                                                                                                                                                  |
| created_time                 | 2023-11-23 21:47:19.996                                                                                                                                                   |
| last_modified_time           | 2023-11-23 21:47:20.001                                                                                                                                                   |
| comment                      |                                                                                                                                                                           |
| properties                   | ()                                                                                                                                                                        |
| type                         | VIEW                                                                                                                                                                      |
| view_text                    | SELECT customer.id, customer.name, mask_outer(CAST(customer.phone AS string), 3, 4) AS phone, mask_inner(customer.email, 0, 12) AS email FROM qingyun.`public`.customer c |
| view_original_text           | SELECT id, name, mask_outer(phone, 3, 4) AS phone, mask_inner(email, 0, 12) AS email
FROM customer                                                                        |
| format                       | INVALID                                                                                                                                                                   |
| statistics                   | NULL rows NULL bytes                                                                                                                                                      |
+------------------------------+---------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
```
