# 查看外部表结构

## 功能描述

通过使用 DESC 或 DESCRIBE 语句，用户可以查看 Lakehouse 数据库中指定外部表的详细结构信息，包括字段名、数据类型、是否允许为空、键信息以及默认值等。

## 语法格式

```
DESC[RIBE] [EXTENDED] table_name;
```

## 参数说明

* **DESC[RIBE]**：DESC 和 DESCRIBE 可以互换使用，都表示描述表结构的命令。
* **EXTENDED**：（可选）加入此关键字后，可以展示更多扩展信息，如文件的位置信息。
* **table_name**：指定需要查看结构的外部表名。支持查看 EXTERNAL TABLE、VIEW、DYNAMIC TABLE、物化视图。

## 使用示例

1. **查看外部表的基本结构**：

   ```sql
   DESC my_external_table;
   +-------------------------+-----------+---------+
   |       column_name       | data_type | comment |
   +-------------------------+-----------+---------+
   | id                      | int       |         |
   | name                    | string    |         |
   | dt                      | string    |         |
   | # Partition Information |           |         |
   | # col_name              | data_type | comment |
   | dt                      | string    |         |
   +-------------------------+-----------+---------+
   ```

2. **查看外部表的扩展结构信息**：

   ```sql
   DESC EXTENDED my_external_table;
   +------------------------------+--------------------------------------------------------+---------+
   |         column_name          |                       data_type                        | comment |
   +------------------------------+--------------------------------------------------------+---------+
   | id                           | int                                                    |         |
   | name                         | string                                                 |         |
   | dt                           | string                                                 |         |
   | # Partition Information      |                                                        |         |
   | # col_name                   | data_type                                              | comment |
   | dt                           | string                                                 |         |
   |                              |                                                        |         |
   | # detailed table information |                                                        |         |
   | schema                       | public                                                 |         |
   | name                         | my_external_table                                      |         |
   | creator                      | UAT_TEST                                               |         |
   | created_time                 | 2024-05-24 14:04:17.517                                |         |
   | last_modified_time           | 2024-05-24 14:04:17.537                                |         |
   | comment                      | edelta-external                                        |         |
   | properties                   | ()                                                     |         |
   | external                     | true                                                   |         |
   | type                         | TABLE                                                  |         |
   | clustered_keys               | RANGE (__dt)                                           |         |
   | bucket_count                 | 0                                                      |         |
   | format                       | delta                                                  |         |
   | location                     | "oss://function-compute-my1/delta-format/uploaddelta/" |         |
   | connection                   | ql_ws.oss_delta                                        |         |
   | statistics                   | NULL rows NULL bytes                                   |         |
   +------------------------------+--------------------------------------------------------+---------+
   ```

^
