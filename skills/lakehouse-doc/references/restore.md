## 功能概述

**历史版本恢复**：
使用本命令，您可以将未删除的表或动态表恢复到指定的历史版本。借助时间旅行功能，您可以轻松地将表状态回滚到过去的某个时刻，以便在需要时恢复数据。

**数据保留周期**：
对象的历史恢复能力取决于数据的保留周期。当前预览版本的数据保留周期默认为 7 天，未来将调整为 1 天。您可以通过执行 [ALTER TABLE...SET PROPERTIES](timetravel-summary.md) 来调整保留周期。请注意，修改保留周期可能会增加存储成本。该功能支持表（TABLE）和动态表（DYNAMIC TABLE），不支持物化视图。


## 语法示例

```SQL
RESTORE TABLE table_name TO time_travel_version;
time_travel_version ::= 
    TIMESTAMP AS OF timestamp_expression;
```

## 参数说明

1. **table_name**：指定未删除的表名，可以是 TABLE 或 DYNAMIC TABLE。若表已被删除，请使用 [UNDROP](UNDROP-TABLE.md) 命令进行恢复。
2. **time_travel_version**：指定要恢复的表版本。先使用 `DESC HISTORY table_name` 查看版本时间点，再在 `TIMESTAMP AS OF` 子句中指定具体的时间点。`timestamp_expression` 是一个返回时间戳类型表达式的参数，例如：

* `'2023-11-07 14:49:18'`，即可强制转换为时间戳的字符串。
* `CAST('2023-11-07 14:49:18' AS TIMESTAMP)`。
* `CURRENT_TIMESTAMP() - INTERVAL 12 HOURS`，即 12 小时之前的版本。
* 任何本身是时间戳类型或可强制转换为时间戳的表达式。

## 使用案例

**案例 1：使用 RESTORE 命令恢复普通表到指定版本**

```SQL
-- 查看表的变更历史
DESC HISTORY json_table;

-- 使用 RESTORE 命令恢复到指定版本
RESTORE TABLE json_table TO TIMESTAMP AS OF '2024-01-26 17:44:45.349';
SELECT * FROM json_table;

-- 查询结果
+----------------------------------+
|                j                 |
+----------------------------------+
| {"id":1,"value":"200"}           |
| {"id":2,"value":"300"}           |
| {"extra":1,"id":3,"value":"400"} |
| {"value":"100"}                  |
+----------------------------------+
```

**案例 2：使用 RESTORE 命令恢复动态表到指定版本**

需要注意的是，如果动态表依赖的表数据没有变化，下次动态表刷新又会恢复成原来的结果。

```sql
DROP TABLE IF EXISTS dy_base_a;
CREATE TABLE dy_base_a (i int, j int);
INSERT INTO dy_base_a VALUES
(1, 10),
(2, 20),
(3, 30),
(4, 40);
-- 使用 dynamic table 进行加工
DROP DYNAMIC TABLE IF EXISTS change_table;
CREATE DYNAMIC TABLE change_table
(i, j)
AS SELECT * FROM dy_base_a;
-- 刷新 dynamic table
REFRESH DYNAMIC TABLE change_table;
-- 查询表数据
SELECT    *
FROM      change_table;
+---+----+
| i | j  |
+---+----+
| 1 | 10 |
| 2 | 20 |
| 3 | 30 |
| 4 | 40 |
+---+----+
-- 向基表中插入数据
INSERT INTO dy_base_a VALUES(5, 10);
-- 刷新 dynamic table
REFRESH DYNAMIC TABLE change_table;
-- 查询表数据
SELECT    *
FROM      change_table;
+---+----+
| i | j  |
+---+----+
| 1 | 10 |
| 2 | 20 |
| 3 | 30 |
| 4 | 40 |
| 5 | 10 |
+---+----+
-- 恢复最初的版本
DESC HISTORY change_table;
+---------+-------------------------+------------+-------------+----------+-----------+-------------------------------+------------------------------------------------------------------------------------+
| version |          time           | total_rows | total_bytes |   user   | operation |            job_id             |                                                       source_tables                |
+---------+-------------------------+------------+-------------+----------+-----------+-------------------------------+------------------------------------------------------------------------------------+
| 3       | 2024-12-27 12:04:20.738 | 5          | 4950        | UAT_TEST | REFRESH   | 2024122712042034961pl5i9617jc | [{"table_name":"dy_base_a","workspace":"qingyun","schema":"public","version":"3"," |
| 2       | 2024-12-27 12:01:33.349 | 4          | 2501        | UAT_TEST | REFRESH   | 2024122712013303061pl5i9617dk | [{"table_name":"dy_base_a","workspace":"qingyun","schema":"public","version":"2"," |
| 1       | 2024-12-27 12:01:33.078 | 0          | 0           | UAT_TEST | CREATE    | 2024122712013279961pl5i9616do | [{"table_name":"dy_base_a","workspace":"qingyun","schema":"public"}]               |
+---------+-------------------------+------------+-------------+----------+-----------+-------------------------------+------------------------------------------------------------------------------------+
-- 恢复至指定版本
RESTORE TABLE change_table TO TIMESTAMP AS OF '2024-12-27 12:01:33.349';
-- 查询数据
SELECT    *
FROM      change_table;
+---+----+
| i | j  |
+---+----+
| 1 | 10 |
| 2 | 20 |
| 3 | 30 |
| 4 | 40 |
+---+----+
```

# 注意事项

1. 请确保在执行 RESTORE 命令时，指定的时间点在表的保留期内。
2. 执行 RESTORE 命令后，表的数据将被还原到指定的历史版本，但不会删除后续的历史版本。
3. 请谨慎使用 RESTORE 命令，以避免数据丢失或不一致的风险。在执行此操作之前，建议先备份相关数据。


