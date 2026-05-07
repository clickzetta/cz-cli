# 自动合并小文件功能

在数据写入过程中，Lakehouse 提供了一项自动合并小文件的功能，旨在提升存储效率和查询性能。这项功能对于处理由高频写入操作产生的大量小文件尤其有效，因为这些小文件在查询时可能会引起频繁的I/O操作，进而影响整体性能。需要注意的是，启用此功能可能会导致写入速度变慢，因为合并操作需要额外的时间来处理。

> 虽然 Lakehouse 后台默认会不定时自动执行文件合并，但在频繁更新或需要精细控制合并频率的场景中，用户可以通过手动调用该命令来满足特定业务需求。该命令支持异步和同步两种执行模式，为不同场景提供灵活的优化方案。

**功能优势**：

* **减少I/O操作**：合并小文件可以减少查询过程中的I/O操作，从而加快数据访问速度。
* **自动触发**：在数据插入时，合并操作会自动执行，无需用户进行额外的手动操作。
# 注意事项
- 该功能只能在**通用型（GENERAL PURPOSE VIRTUAL CLUSTER）计算集群**上运行，在分析型计算集群上该功能不会生效。
# 执行DML语句时触发小文件合并
添加如下设置，选中后和 DML 语句一起执行会触发小文件合并。
`SET cz.sql.compaction.after.commit = true;`


## 使用场景

* **高频写入**：在需要频繁写入数据的场景下，如动态表刷新，建议开启此功能。高频写入往往会生成大量小文件，自动合并可以有效地管理这些文件。

## 使用案例

假设您有一个名为`test_sql_compaction`的表，用于存储分区数据。

```SQL
CREATE TABLE test_sql_compaction (
    id BIGINT,
    name STRING
) PARTITIONED BY (ds STRING);
```

在未启用自动合并功能前，每次插入操作可能会生成多个小文件。例如，插入 10 条记录：

```SQL
-- 插入10条记录
INSERT INTO test_sql_compaction PARTITION (ds ='1') VALUES(1, 'a');
-- 重复此INSERT操作共10次
```

插入后，您可以查看生成的文件数量：

```SQL
SHOW PARTITIONS EXTENDED test_sql_compaction;
```

再次插入数据：

```SQL
SET cz.sql.compaction.after.commit = true;
INSERT INTO test_sql_compaction PARTITION (ds ='1') VALUES(1, 'a');
```

合并后，再次查看文件数量，您会发现小文件已被合并：

```SQL
SHOW PARTITIONS EXTENDED test_sql_compaction;
```
# 使用OPTIMIZE命令触发小文件合并
## 概述
`OPTIMIZE` 是 Lakehouse 提供的一个异步文件优化命令，用于合并小文件、优化存储布局，提升查询性能。该命令‌**仅支持在 GP 型计算集群运行**‌，执行后立即返回任务ID，实际优化操作在后台异步执行。
## 语法
```SQL
OPTIMIZE table_name
[WHERE predicate]  -- 可选分区过滤条件
[OPTIONS ('key' = 'value')]  -- 可选配置参数
```
## 参数说明
1. table_name（必选）
* 需要优化的目标表名称，格式为 `[schema_name.]table_name`
2. WHERE predicate（可选）
* 分区过滤条件，必须包含‌**完整的分区列匹配条件**‌
* 支持格式：`partition_column = 'value'` 或复合分区 `dt='2023-01-01' AND region='us'`
* OPTIONS:Lakehouse保留参数
## 使用案例
假设您有一个名为`test_sql_compaction`的表，用于存储分区数据。
```SQL
DROP TABLE test_sql_compaction;
CREATE TABLE test_sql_compaction (
    id BIGINT,
    name STRING
) PARTITIONED BY (ds STRING);
```
在未启用自动合并功能前，每次插入操作可能会生成多个小文件。例如，插入 10 条记录：
```SQL
-- 插入10条记录
INSERT INTO test_sql_compaction PARTITION (ds ='1') VALUES(1, 'a');
-- 重复此INSERT操作共10次
```
插入后，您可以查看生成的文件数量：
```SQL
SHOW PARTITIONS EXTENDED test_sql_compaction;
```
执行合并小文件命令
```SQL
OPTIMIZE  test_sql_compaction;
```
合并后，再次查看文件数量，您会发现小文件已被合并：
```SQL
SHOW PARTITIONS EXTENDED test_sql_compaction;
```
