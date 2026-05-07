# 查看动态表结构

## 功能描述

通过使用 DESC 或 DESCRIBE 语句，用户可以查看 Lakehouse 数据库中指定动态表的详细结构信息。添加 EXTENDED 关键字可以查看动态表的调度周期和刷新属性。

## 语法格式

```
DESC[RIBE] [TABLE] [EXTENDED] dynamic_table_name;
```

## 参数说明

* **DESC[RIBE]**：DESC 和 DESCRIBE 可以互换使用，都表示描述表结构的命令。
* **TABLE**：可选参数，用于指定查看表结构的类型，如BASE TABLE或VIEW等。
* **EXTENDED**：可选参数。加入此关键字后，可以查看动态表的调度周期、刷新属性、调度状态、使用的基表和条数大小等。
* **dynamic_table_name**：指定需要查看结构的表名。

## 使用具体案例

```
DESC dt_agg;
+-------------+-----------------+---------+
| column_name |    data_type    | comment |
+-------------+-----------------+---------+
| j           | int             |         |
| cnt         | bigint not null |         |
+-------------+-----------------+---------+

DESC EXTENDED dt_agg;
+------------------------------+---------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
|         column_name          |                                                                                                                   data_type                                               |
+------------------------------+---------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| j                            | int                                                                                                                                                                       |
| cnt                          | bigint not null                                                                                                                                                           |
|                              |                                                                                                                                                                           |
| # detailed table information |                                                                                                                                                                           |
| schema                       | public                                                                                                                                                                    |
| name                         | dt_agg                                                                                                                                                                    |
| creator                      | UAT_TEST                                                                                                                                                                  |
| created_time                 | 2024-07-23 18:02:15.774                                                                                                                                                   |
| last_modified_time           | 2024-07-24 11:01:11.289                                                                                                                                                   |
| comment                      |                                                                                                                                                                           |
| properties                   | ()                                                                                                                                                                        |
| type                         | DYNAMIC TABLE                                                                                                                                                             |
| view_text                    | SELECT dt_tran.j, `count`(*) AS cnt FROM qingyun.`public`.dt_tran GROUP BY dt_tran.j;                                                                                     |
| view_original_text           | (select j,count(*) as cnt from dt_tran group by j);                                                                                                                       |
| source_tables                | [86:qingyun.public.dt_tran=9063157128606430641]                                                                                                                           |
| refresh_type                 | on schedule(disabled)                                                                                                                                                     |
| refresh_start_time           | 2024-07-23 18:02:15.725                                                                                                                                                   |
| refresh_interval_second      | 60                                                                                                                                                                        |
| refresh_vcluster             | qingyun.TEST                                                                                                                                                              |
| unique_key_is_valid          | true                                                                                                                                                                      |
| unique_key_version_info      | unique_key_version: 1, explode_sort_key_version: 1, digest: H4sIAAAAAAAAA3NMT9cx0nEP8g8NUHCKVDBUcPb3CfX1C+ZSCE5OzANKBfmHx3u7Riq4Bfn7KqSUxJcUJeZxAQCTzdfANgAAAA==, unique  |
| format                       | PARQUET                                                                                                                                                                   |
| statistics                   | 5 rows 2729 bytes                                                                                                                                                         |
+------------------------------+---------------------------------------------------------------------------------------------------------------------------------------------------------------------------+

```


