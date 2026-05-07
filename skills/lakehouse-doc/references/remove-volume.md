# REMOVE 命令

## 概述

REMOVE 命令用于从云器 Lakehouse 的数据湖 Volume 对象中删除文件，同时实际存储与对象存储的文件也会删除。该命令支持在 Studio 和 Lakehouse 客户端中运行。

## 使用场景

* 可以结合Lakehouse定时调度任务将已经导入到lakehouse的文件定时删除

## 语法

```
REMOVE 
    [ VOLUME volume_name | TABLE VOLUME table_name | USER VOLUME ]
    [ SUBDIRECTORY 'dir' | FILE 'file' ] 
```

## 参数说明

* `VOLUME/TABLE VOLUME/USER VOLUME`：分别指将外部 Volume，TABLE VOLUME 和USER VOLUME 中的数据删除。
* `SUBDIRECTORY/FILE`：指定下载文件包括的范围，可以是 volume 中的子目录。指定目录会将下面的所有文件删除（`SUBDIRECTORY`），也可以利用 FILE 参数删除多个文件。

## 示例

删除volume中的某个目录

```SQL
REMOVE VOLUME my_volume SUBDIRECTORY 'delta-format/uploaddelta';
```

^
