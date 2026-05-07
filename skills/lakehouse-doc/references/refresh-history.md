# 功能

用于返回所有正在进行刷新和历史刷新的作业历史。目前只会显示最近7天内的10000条数据。结果中可以显示增量刷新条数、是否为增量刷新等信息。

# 语法

```SQL
 SHOW DYNAMIC TABLE REFRESH HISTORY [where <expr>] [LIMIT num];
```

# 参数说明

* `WHERE <expr>`:WHERE \<expr>: (可选) 支持用户根据 `SHOW JOBS` 命令显示的字段进行筛选。用户可以通过表达式对结果进行筛选，以便更精确地查找所需的数据。
* `LIMIT num`：（可选）限制返回的作业记录数量，范围为1-10000。

# 返回结果

| 字段                 | 说明                                                                        |
| ------------------ | ------------------------------------------------------------------------- |
| workspace\_name    | 工作空间名称                                                                    |
| schema\_name       | schema名称                                                                  |
| name               | 动态表名字                                                                     |
| virtual\_cluster   | 使用的计算集群                                                                   |
| start\_time        | 刷新开始时间，timestamp类型                                                        |
| end\_time          | 刷新结束时间，timestamp类型                                                        |
| duration           | 刷新耗时，interval类型                                                           |
| state              | 作业状态                                                                      |
| refresh\_trigger   | MANUAL(由用户调用refresh手动触发刷新,包含studio调度刷新) SYSTEM\_SCHEDULED（由lakehouse调度刷新） |
| suspended\_reson   | 保留字段，无特殊意义                                                                 |
| refresh\_mode      | NO\_DATA FULL INCREMENTAL                                                 |
| error\_message     | 刷新失败的信息                                                                   |
| source\_tables     | 记录了 Dynamic Table 使用的基表名称                                                  |
| stats              | 增量刷新条数等信息                                                                 |
| completion\_target | 保留字段，无特殊意义                                                                 |
| job\_id            | 作业 ID，通过点击作业 ID 可以查看 job profile                                              |

# 使用示例

* 根据动态表名字过滤对应的刷新历史

```SQL
 SHOW DYNAMIC TABLE REFRESH HISTORY  where name='dau';
```

* 根据耗时进行筛选，筛选耗时大于一秒的刷新

```SQL
 SHOW DYNAMIC TABLE REFRESH HISTORY  where name='dau' and duration>interval 1 second;
```

* 根据计算集群进行过滤

```SQL
 SHOW DYNAMIC TABLE REFRESH HISTORY  where name='dau' and duration>interval 1 second and virtual_cluster='DEFAULT';
```

* 根据开始时间进行过滤

```SQL
 SHOW DYNAMIC TABLE REFRESH HISTORY  where name='dau' and duration>interval 1 second and virtual_cluster='DEFAULT'  and start_time>timestamp'2024-06-12 12:47:07.881';
```

^
