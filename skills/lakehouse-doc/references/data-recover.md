# Lakehouse Time Travel 功能使用指南

## Time Travel功能简介

Lakehouse 的 Time Travel 功能让您能够轻松访问时间旅行窗口内任何时间点的数据。这意味着您可以在不同的时间点查看数据，甚至可以恢复到先前的数据状态。

借助 Time Travel，您可以查询已更新或删除的数据、恢复已删除的表或者恢复已过期的表。
![](.topwrite/assets/image_1708936936399.png =740)

如上图所示，表中原来有一条数据，对表执行 INSERT、UPDATE、DELETE 等操作后，一共有四个版本。当指定的时间点或版本在 v0 到 v1 之间时，则会返回 v0 的数据。通过 Time Travel 指定时间点或版本可以查看历史版本数据。

## 访问特定时间点的数据

[TIME TRAVEL](TIMETRAVEL.md)

## 设置数据保留周期

您可以配置 Time Travel 的数据保留周期，以决定数据在时间旅行窗口中保留的时间长度。根据您的需求，您可以设置不同的保留期限。

Time Travel 保留期限决定了您可以访问多久以前的数据。例如，如果 Time Travel 保留期限设置为 7 天，那么您可以访问过去 7 天内任何时间点的数据。如果超过了 7 天，您将无法再使用 Time Travel 访问过期的数据，数据会被物理删除。

当前版本中，默认保留周期是 1 天，可以查询 1 天内的数据。

### 在表上设置数据保留周期

您可以通过以下SQL语句设置表的数据保留周期：

```SQL
ALTER TABLE orders SET PROPERTIES ('data_retention_days'='num');
```

其中 `num` 的设置范围为 0-90，表示数据保留的天数。

## 恢复已删除的对象

如果您意外删除了某个对象，可以使用 `UNDROP` 命令来恢复它。以下是一个恢复已删除表的示例：

```SQL
UNDROP TABLE orders;
```

此命令将恢复名为 `orders` 的已删除表。

## 恢复到指定版本的数据

使用 `RESTORE` 命令，您可以将数据恢复到特定版本。这对于回滚或修复错误的数据更改非常有用。以下是一个将数据恢复到指定版本的示例：

```SQL
RESTORE TABLE orders TO TIMESTAMP AS OF '2023-03-01 10:00:00';
```

此命令将 `orders` 表的数据恢复到 2023年3月1日 10:00:00 的版本。
