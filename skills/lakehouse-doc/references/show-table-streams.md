## 功能

本命令用于查看当前数据库 schema 下所有的表流（Table Streams）信息。表流是一种实时数据流，可以让您对表中的数据进行实时分析和处理。

## 语法

```SQL
SHOW TABLE STREAMS [IN schema_name] [LIKE 'pattern' | WHERE expr] [LIMIT num]
```

## 参数说明
1. `LIKE pattern`：此选项为可选参数，用于按对象名称进行过滤。支持不区分大小写的模式匹配，并可使用SQL通配符`%`（表示任意数量的字符）和`_`（表示单个字符）。示例：`LIKE '%testing%'`。需要注意的是，此过滤器不支持与 `WHERE` 条件同时使用。

2. `IN schema_name`：此选项为可选参数，允许用户指定特定的schema名称，从而列举出该schema下的所有数据库对象。

3. `WHERE expr`：此选项为可选参数，支持用户根据 `SHOW TABLES` 命令显示的字段进行筛选。


## 示例

1. 查看当前 schema 下所有的表流：

   ```
   SHOW TABLE STREAMS;
   ```

   结果：

   ```
   +-------------------------+-------------+--------------+------------+-------------+---------+
   |       create_time       | schema_name |     name     | table_name |    mode     | comment |
   +-------------------------+-------------+--------------+------------+-------------+---------+
   | 2023-11-24 21:44:07.261 | public      | event_stream | event      | APPEND_ONLY |         |
   +-------------------------+-------------+--------------+------------+-------------+---------+
   ```

2. 查看指定 schema 下所有的表流：

   ```
   SHOW TABLE STREAMS IN my_schema;
   ```

3. 查看当前 schema 下名称中包含 "test" 的表流：

   ```
   SHOW TABLE STREAMS LIKE '%test%';
   ```

4. 结合 WHERE 子句查看满足特定条件的表流：

   ```
   SHOW TABLE STREAMS WHERE mode = 'APPEND_ONLY';
   ```
