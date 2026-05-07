# 数据生命周期

数据生命周期（TTL）是指云器 Lakehouse 中表和表分区从最后一次更新时间算起的时间长度。在指定的时间周期内，如果数据没有发生变动，系统将自动回收这些数据。生命周期的单位是天，且取值为整数类型。

## 数据生命周期的工作原理

数据生命周期到期的回收依赖于数据的最后修改时间（last\_modified\_time）。对于非分区表，您可以通过 `desc extended` 命令查看 last_modified_time；对于分区表，您可以通过 `SHOW PARTITIONS EXTENDED table_name` 查看对应具体分区的 last_modified_time。当发生 DDL（数据定义语言）或 DML（数据操纵语言）操作时，last_modified_time 会更新。

需要注意的是，到期的数据并不会立即被回收。您仍然可以查询这些数据，直到后台进程执行删除操作。通常，后台进程会在 24 小时内删除这些数据。此外，被回收的表仍然遵守 [数据保留周期](TIMETRAVEL.md)，您仍可以使用 [时间旅行](TIMETRAVEL.md) 功能进行查询。若需要恢复已删除的对象，可以使用 [undrop table](UNDROP-TABLE.md) 命令。

## 设置数据生命周期

生命周期单位为天，取值为正整数。设置为 '-1' 代表不开启生命周期，即数据将被永久保留。您可以在创建表时指定生命周期，也可以在表创建后进行修改。

### 具体SQL操作方式

**创建表时设置生命周期**

```SQL
-- 创建表并设置生命周期为7天
CREATE TABLE tname (col1 datatype1, col2 datatype2) PROPERTIES('data_lifecycle'='7');
-- 创建表并设置生命周期为7天，同时在生命周期到期时删除表结构
CREATE TABLE tname (col1 datatype1, col2 datatype2) PROPERTIES('data_lifecycle'='7', 'data_lifecycle_delete_meta'='true');
```

**修改现有表的生命周期**

```SQL
-- 修改表的生命周期为10天
ALTER TABLE tname SET PROPERTIES ('data_lifecycle'='10');
-- 修改表的生命周期为10天，并在生命周期到期时删除表结构
ALTER TABLE tname SET PROPERTIES ('data_lifecycle'='10', 'data_lifecycle_delete_meta'='true');
```

## 注意事项

1.  生命周期回收任务每天不定时启动，每 12 小时轮询一次，会扫描全量分区。只有当 last_modified_time 超过生命周期指定的时间时，数据才会被回收。
2.  生命周期回收主要针对表或分区，每天根据服务的繁忙程度进行，不能确保到期后立即被回收。
3.  生命周期到期时，默认行为是不删除表结构，只清空数据。如果您希望删除表结构，请在设置生命周期时添加参数 `ALTER TABLE tname SET PROPERTIES ('data_lifecycle_delete_meta'='true')`。
4.  修改生命周期时，例如当您将生命周期策略从 15 天更改为 30 天时，新策略会立即生效。但是由于生命周期回收任务每天不定时启动，通常每 12 小时轮询一次。在极少数情况下，如果在策略变更时，回收任务恰好启动并读到了旧的策略，可能会按照旧策略（15 天）回收部分数据。该现象属于系统设计的正常机制，不会影响未到期数据的安全。






