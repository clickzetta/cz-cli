# 介绍

LAKEHOUSE 的 INFORMATION_SCHEMA 提供了项目实例（INSTANCE）及使用历史数据等详细信息，帮助您全面了解所有空间的信息。通过查询INFORMATION_SCHEMA，您可以查看所有空间的元数据信息和使用历史信息。INFORMATION_SCHEMA 基于 ANSI SQL-92 标准，同时增加了一些 LAKEHOUSE 服务特有的字段和视图。当您创建 LAKEHOUSE 实例时，系统会自动在名为 SYS 的系统空间中创建一个 INFORMATION_SCHEMA。INFORMATION_SCHEMA不仅记录了当前存在的元数据对象，还记录了已经删除的元数据对象。您可以通过DELETE_TIME字段来判断一个元数据对象是否被删除，以及删除的时间。如果DELETE_TIME字段为NULL，表示该元数据对象尚未被删除。需要注意的是，目前存在约 15 分钟的延迟。

# 使用限制

* 实例级别 SYS 下的视图，被删除对象保留 60 天记录。视图当前阶段存在约 15 分钟的延迟。JOB_HISTORY、MATERIALIZED_VIEW 刷新视图保留 60 天记录。
* 每个INFORMATION_SCHEMA下的表和视图都是只读的（不能修改或删除）。
* 对 INFORMATION_SCHEMA 视图的查询不保证与并发 DDL 操作的一致性。例如，在执行长时间运行的 INFORMATION_SCHEMA 查询时创建了一组表，则查询结果可能不包含这些新创建的表。

# 访问SYS下的INFORMATION_SCHEMA

要访问 SYS 下的 INFORMATION_SCHEMA，您需要具备 INSTANCE ADMIN 权限。以下是查询 INFORMATION_SCHEMA 的一个示例：

```SQL
SELECT * FROM SYS.information_schema.tables;
```

以下是一些查询INFORMATION_SCHEMA的示例，帮助您更好地了解如何使用这些视图和表。

1. 查询所有空间的元数据信息：

```SQL
SELECT * FROM SYS.information_schema.columns;
```

2. 查询指定空间的表信息：

```SQL
SELECT * FROM SYS.information_schema.tables WHERE table_schema = 'your_schema_name';
```

3. 查询已删除的元数据对象：

```SQL
SELECT * FROM SYS.information_schema.columns WHERE delete_time IS NOT NULL;
```

4. 查询表的创建时间：

```SQL
SELECT table_name, create_time FROM SYS.information_schema.tables WHERE table_schema = 'your_schema_name';
```

5. 查询JOB HISTORY信息：

```SQL
SELECT * FROM SYS.information_schema.job_history;
```

通过以上示例，您可以更深入地了解如何使用 INFORMATION_SCHEMA 来查询和管理 LAKEHOUSE 实例中的元数据和使用历史信息。