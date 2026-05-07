# 修改表属性

## 1. 重命名表

功能：通过 ALTER TABLE 命令，您可以将现有的表重命名为新的表名。

语法：

```SQL
ALTER  TABLE name RENAME TO new_table_name;
```

示例：

```SQL
ALTER TABLE old_table_name RENAME TO new_table_name;
```

## 2. 修改表注释

功能：通过 ALTER TABLE 命令，您可以为外部表添加或修改注释。

语法：

```SQL
ALTER TABLE tbname SET COMMENT '';
```

示例：

```SQL
ALTER TABLE new_pepole_delta SET COMMENT 'new_pepole_delta';
```

执行上述命令后，您可以使用DESC EXTENDED命令查看表的详细信息，包括注释：

```SQL
DESC EXTENDED new_pepole_delta;
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
| name                         | new_pepole_delta                                       |         |
| creator                      | UAT_TEST                                               |         |
| created_time                 | 2024-05-24 14:04:17.517                                |         |
| last_modified_time           | 2024-12-30 11:47:32.806                                |         |
| comment                      | new_pepole_delta                                       |         |
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

## 3. 修改表的属性

功能：通过 ALTER TABLE 命令，您可以为外部表设置或修改属性。目前为保留参数。

语法：

```
ALTER TABLE table_name SET PROPERTIES("key"="value");
```

^
