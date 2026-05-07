## 功能概述

`MAX_PT` 用于获取分区表中最大分区的值。该函数特别适用于处理分区表，可以帮助用户快速定位到最新的数据分区。

## 命令格式

```SQL
max_pt('schema_name.table_name'｜ 'table_name')
```

## 参数说明

* **schema\_name.table\_name**: 这是一个必填参数，类型为 STRING。支持 `schema_name.table_name` 或 `table_name` 形式。如果不指定 schema，则默认使用当前上下文环境。

## 返回值说明

* 该函数返回最大的一级分区的值。

## 示例

示例 1：基本使用

假设 `tbl` 是一个分区表，其对应的分区为 `20120901` 和 `20120902`，并且这两个分区中都有数据。以下语句中，`max_pt` 返回的值为 `'20120902'`。

```SQL
SELECT * FROM tbl WHERE pt = max_pt('tbl');
```

等效于以下语句：

```SQL
SELECT * FROM tbl WHERE pt = (SELECT MAX(pt) FROM tbl);
```

示例 2：多级分区场景

在多级分区的场景中，可以使用标准 SQL 获取最大分区下的数据。

```SQL
SELECT * FROM table WHERE pt1 = (SELECT MAX(pt1) FROM table) AND pt2 = (SELECT MAX(pt2) FROM table WHERE pt1 = (SELECT MAX(pt1) FROM table));
```
