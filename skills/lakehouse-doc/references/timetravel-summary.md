# Time Travel

Time Travel功能可以让您像时间旅行一样访问时间窗口中的任何时间点的数据，包括已更新或删除的数据、恢复已删除的表或恢复已过期的表。通过Time Travel，您可以轻松查看历史版本数据，从而更好地了解数据的变更历史。

![Time Travel示意图](.topwrite/assets/image_1708936936399.png)

如上图所示，表中原来有一条数据，经过insert、update、delete等操作后，共有四个版本。当指定的版本在v0-v1之间时，Time Travel将返回v0的数据。通过指定版本，您可以查看历史版本数据。

## Time Travel功能支持的操作

* 使用undrop命令恢复已删除的表
* 使用restore命令恢复现有表或dynamic表到指定版本
* 查询表或dynamic表已更新或删除之前的数据
* 查看表或dynamic表的版本历史
* 创建表流（table stream）或使用table\_changes获取表或dynamic表的变化

# Time Travel保留期限设置

Time Travel保留期限决定了您可以访问多久以前的数据。例如，如果Time Travel保留期限设置为7天，那么您可以访问过去7天内的任何时间点的数据。超过7天后，您将无法使用Time Travel访问过期的数据，且数据会被物理删除。
Lakehouse表的历史状态默认保留周期1天(24小时），您可以通过Time Travel查询1天内的历史版本。请注意如果设置的时间更长存储费用会增加

如需保留更长周期的历史版本，您可以为每个表设置不同的数据保留周期，以满足不同的业务需求。num的设置范围为0-90。

  * ```SQL
    ALTER TABLE tablename SET PROPERTIES ('data_retention_days'='num');
    ```

## 恢复删除的对象

请参考[恢复删除数据](UNDROP-TABLE.md)文档，了解如何使用undrop命令恢复已删除的表。

## 恢复数据到指定版本

请参考[RESTORE命令](restore.md)文档，了解如何使用restore命令将现有表或dynamic表恢复到指定版本。

## 查询历史数据

请参考[TIME TRAVEL](TIMETRAVEL.md)文档，了解如何查询表或dynamic表已更新或删除之前的数据。

## 查看对象的版本历史

请参考[DESC HISTORY](desc-history.md)文档，了解如何查看表或dynamic表的版本历史。

## 使用table stream和table\_changes获取表的变化

* 请参考[使用TABLE CHANGES获取数据变化](sql_functions/table_functions/table_changes.md)文档，了解如何使用table\_changes获取表或dynamic表的变化。
* 请参考[使用TABLE STREAM获取数据变化](tablestream_summary.md)文档，了解如何使用table stream获取表或dynamic表的变化。
