# 查看表结构

## 功能描述

通过使用 DESC 或 DESCRIBE 语句，用户可以查看 Lakehouse 数据库中指定表的详细结构信息，包括字段名、数据类型、是否允许为空、键信息以及默认值等。

## 语法格式

```
DESC[RIBE] [TABLE] [EXTENDED] table_name;
```

## 参数说明

* **DESC[RIBE]**：DESC 和 DESCRIBE 可以互换使用，都表示描述表结构的命令。
* **TABLE**：可选关键字，用于指定查看的对象是表。
* **EXTENDED**：可选参数，加入此关键字后，可以展示更多扩展信息，如表的大小和记录数。
* **table_name**：指定需要查看结构的表名。支持查看表（TABLE）、视图（VIEW）、动态表（DYNAMIC TABLE）、物化视图（MATERIALIZED VIEW）。

## 使用示例

1. 查看表的基本结构信息：
   ```SQL
   DROP TABLE employees;
   CREATE TABLE employees(id int,name string,skills array<string>);
   INSERT INTO employees (id, name, skills) VALUES
   (1, 'John Doe', ['Java', 'Python', 'SQL']),
   (2, 'Jane Smith', ['C++', 'Hadoop', 'SQL']),
   (3, 'Bob Johnson', ['Python', 'Docker']);
    DESC employees;
   +-------------+---------------+---------+
   | column_name |   data_type   | comment |
   +-------------+---------------+---------+
   | id          | int           |         |
   | name        | string        |         |
   | skills      | array<string> |         |
   +-------------+---------------+---------+
   ```
   上述命令将展示表 t1 的基本结构信息。

2. 查看表的扩展信息，包含表的大小和记录数：
   ```SQL
   DESCRIBE EXTENDED employees;
   +------------------------------+-------------------------+---------+
   |         column_name          |        data_type        | comment |
   +------------------------------+-------------------------+---------+
   | id                           | int                     |         |
   | name                         | string                  |         |
   | skills                       | array<string>           |         |
   |                              |                         |         |
   | # detailed table information |                         |         |
   | schema                       | public                  |         |
   | name                         | employees               |         |
   | creator                      | UAT_TEST                |         |
   | created_time                 | 2024-12-26 20:15:41.902 |         |
   | last_modified_time           | 2024-12-26 20:16:00.901 |         |
   | comment                      |                         |         |
   | properties                   | ()                      |         |
   | type                         | TABLE                   |         |
   | format                       | PARQUET                 |         |
   | statistics                   | 3 rows 2548 bytes       |         |
   +------------------------------+-------------------------+---------+
   ```
   执行该命令后，除了基本的表结构信息，还会展示表 t1 的创建语句等扩展信息。

3. 查看动态表信息：
   ```SQL
   DESC TABLE aa;
   +------------------------------+----------------------------------------------------------------------------------------------------------+---------+
   |         column_name          |                                                data_type                                                 | comment |
   +------------------------------+----------------------------------------------------------------------------------------------------------+---------+
   | id                           | int                                                                                                      |         |
   | event                        | timestamp_ltz                                                                                            |         |
   | col3                         | int                                                                                                      | comment |
   |                              |                                                                                                          |         |
   | # detailed table information |                                                                                                          |         |
   | schema                       | public                                                                                                   |         |
   | name                         | aa                                                                                                       |         |
   | creator                      | UAT_TEST                                                                                                 |         |
   | created_time                 | 2024-12-11 10:48:17.93                                                                                   |         |
   | last_modified_time           | 2024-12-13 14:53:16.158                                                                                  |         |
   | comment                      |                                                                                                          |         |
   | properties                   | ()                                                                                                       |         |
   | type                         | DYNAMIC TABLE                                                                                            |         |
   | view_text                    | SELECT test_timestamp.id, test_timestamp.event, test_timestamp.col FROM `public`.test_timestamp; |         |
   | view_original_text           | select * from public.test_timestamp;                                                                     |         |
   | source_tables                | [:.public.test_timestamp=1055409697418575788]                                                   |         |
   | query_rewrite                | disabled                                                                                                 |         |
   | refresh_type                 | on schedule                                                                                              |         |
   | refresh_start_time           | 2024-12-11 10:48:17.86                                                                                   |         |
   | refresh_interval_second      | 300                                                                                                      |         |
   | refresh_vcluster             | TEST_ALTER                                                                                       |         |
   | unique_key_is_valid          | false                                                                                                    |         |
   | unique_key_version_info      | unique_key_version: 0, explode_sort_key_version: 0, digest: , unique key infos:[]                        |         |
   | format                       | PARQUET                                                                                                  |         |
   | statistics                   | 17 rows 2976 bytes                                                                                       |         |
   +------------------------------+----------------------------------------------------------------------------------------------------------+---------+
   ```

## 注意事项

* 确保在执行 DESC 或 DESCRIBE 命令前，已连接到正确的数据库，以避免查看到错误的表结构信息。
* 如果需要查看表的创建语句等详细信息，请使用 EXTENDED 参数。


