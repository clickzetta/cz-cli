# 使用Explain查看动态表刷新模式

通过 explain 命令查看是否能增量刷新（preview），需要通过开关开启，开启的开关为 `set cz.optimizer.explain.can.incrementalize=true;` 在数据开发中需要选中一起执行。

**语法**

```Plain
set cz.optimizer.explain.can.incrementalize=true;
EXPLAIN REFRESH DYNAMIC TABLE dtname;
```

使用说明

* `explain` 命令通常是用来查看 SQL 执行计划。刷新动态表时添加 `explain` 可以用来查看动态表的执行计划，同时 Lakehouse 会输出是否是增量计划字段 `CanBeIncrementalized`。如果为 `Yes` 表示执行的是增量计划。如果输出为 `No` 表示不是增量计划，并会给出原因（No because ...）。

**具体案例**

```SQL
set cz.optimizer.explain.can.incrementalize=true;
explain refresh dynamic table event_gettime;
```

![](.topwrite/assets/image_1720597444254.png)

# 使用Show命令查看动态表刷新模式
通过 `show dynamic table refresh history` 查看。输出的字段中，`refresh_mode` 可以查看是否是增量刷新，`stats` 字段记录了增量刷新的条数。


**语法**

```SQL
 SHOW DYNAMIC TABLE REFRESH HISTORY [where <expr>] [LIMIT num];
```

**参数说明**

* `WHERE <expr>`:WHERE \<expr>:(可选)支持用户根据`SHOW JOBS`命令显示的字段进行筛选。用户可以通过表达式对结果进行过滤，以便更精确地查找所需的数据。
* `LIMIT num`：（可选）限制返回的作业记录数量，范围为1-10000。

**返回结果**



|            字段        |                            说明                                               |
| ------------------ | ------------------------------------------------------------------------- |
| workspace\_name    | 工作空间名称                                                                    |
| schema\_name       | schema名称                                                                  |
| name               | 动态表名字                                                                     |
| virtual\_cluster   | 使用的计算集群                                                                   |
| start\_time        | 刷新开始时间，timestamp 类型                                                        |
| end\_time          | 刷新结束时间，timestamp 类型                                                        |
| duration           | 刷新耗时，interval类型                                                           |
| state              | 作业状态                                                                      |
| refresh\_trigger   | MANUAL(由用户调用refresh手动触发刷新,包含studio调度刷新) SYSTEM\_SCHEDULED（由lakehouse调度刷新） |
| suspended\_reson   | 保留字段无特殊意义                                                                 |
| refresh\_mode      | NO\_DATA, FULL, INCREMENTAL                                                 |
| error\_message     | 刷新失败的信息                                                                   |
| source\_tables     | 记录了 dynamic table 使用的基表名称                                                  |
| stats              | 增量刷新条数等信息                                                                 |
| completion\_target | 保留字段无特殊意义                                                                 |
| job\_id            | 作业 ID，通过点击作业 ID 可以看到 job profile                                              |

