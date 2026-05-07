# GET 命令

## 概述

GET 命令用于从云器 Lakehouse 的数据湖 Volume 对象中下载文件到客户端本地路径。通过该命令，用户可以轻松地将数据从云端同步到本地环境，以便进行进一步的分析和处理。要执行 GET 命令，您可以使用 [sqlline](connect-with-cli.md) 工具或 [数据库管理工具](eco_integration/dbeaver-lakehouse.md)。该命令暂不支持在 Studio 中运行。

## 使用场景

* 数据分析：将数据文件从云端下载到本地进行分析和挖掘。
* 数据迁移：将数据从云端迁移到本地存储，以便在本地进行备份或迁移到其他云平台。
* 数据恢复：从云端恢复丢失或损坏的数据到本地。

## 语法

```
GET 
    [ VOLUME volume_name | TABLE VOLUME table_name | USER VOLUME ]
    [ FILE 'file' ] 
    TO 'local_path'
    [ option_key = option_value ] ...
```

## 参数说明

* `VOLUME/TABLE VOLUME/USER VOLUME`：分别指将外部 Volume、TABLE VOLUME 和 USER VOLUME 中的数据下载到本地。具体使用方式参考 [COPY INTO导出](<COPY-INTO-Location.md>)。
* `FILE`：指定要下载的文件。
* `local_path`：文件下载到本地的目标路径，其格式根据不同操作系统有所区别。


## 示例

1. 将表中数据下载到本地

   ```
    --将数据导出到内部user volume中
    COPY INTO USER VOLUME SUBDIRECTORY 'tmp/' FROM TABLE mytable  file_format = (type = CSV);;
    
    -- 查看导出的文件
    SHOW  USER VOLUME DIRECTORY;
   +-------------------+------------------------------------------------------------------------------------------------------------+------+---------------------+
   |   relative_path   |                                                    url                                                     | size | last_modified_time  |
   +-------------------+------------------------------------------------------------------------------------------------------------+------+---------------------+
   | tmp/part00001.csv | oss://xxxx/tmp/part00001.csv | 5    | 2024-11-14 19:44:37 |
   +-------------------+------------------------------------------------------------------------------------------------------------+------+---------------------+

    --下载文件
    GET USER VOLUME FILE 'tmp/part00001.csv' TO  './';
    --删除volume中文件，避免占用存储
    REMOVE USER VOLUME FILE 'tmp/part00001.csv';
    SHOW USER VOLUME DIRECTORY;
   +---------------+-----+------+--------------------+
   | relative_path | url | size | last_modified_time |
   +---------------+-----+------+--------------------+
   ```



## 注意事项

* 从外部 Volume 下载文件会产生对应云账号的对象存储下载费用。
* GET 命令不能通过 Studio SQL 任务节点执行，但可以通过云器 Lakehouse SQLline 客户端、JDBC 客户端以及 SDK 来执行。


