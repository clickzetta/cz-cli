# PUT 命令

## 简介

PUT 命令是 Lakehouse SQL 中的一个实用工具，用于将客户端主机的本地文件上传到 Lakehouse 数据湖的 Volume 对象中。通过该命令，用户可以轻松地将本地文件传输至云端，实现数据的快速迁移和同步。要执行 PUT 命令，您可以使用 [sqlline](connect-with-cli.md) 工具或 [数据库管理工具](eco_integration/dbeaver-lakehouse.md)。该命令暂不支持在 Studio 中运行。

## 使用场景

PUT 命令适用于以下场景：

1. 将本地文件上传到数据湖 Volume 对象。
2. 快速迁移和同步本地与云端数据。

## 语法

```
PUT 'local_path' [ , 'local_path' [ , ... ] ] 
    TO 
    [ VOLUME volume_name | TABLE VOLUME table_name | USER VOLUME ]
    [ SUBDIRECTORY 'dir' | FILE 'filename' ]
    [ option_key = option_value ] ..
```

## 参数说明

* `local_path`：本地要上传文件的路径。**Linux / macOS**：路径以根目录 `/` 开始，或者使用 `'file:///'` 前缀表示本地路径。**Windows 系统**：如果目录路径和/或文件名包含特殊字符，则整个文件 URI 必须用单引号括起来。注意，在封闭的 URI 中，分隔符为正斜杠 (`/`)。
* `VOLUME/TABLE VOLUME/USER VOLUME`：指将本地数据上传至外部 Volume、TABLE VOLUME 或 USER VOLUME。
* `SUBDIRECTORY/FILE`：指定上传文件的目标路径，可以指定子目录（`SUBDIRECTORY`），也可以利用 FILE 参数对上传的文件进行重命名操作。

## 示例

1. 使用内部 Volume 上传文件到表中

```
--上传文件
PUT '/Users/Downloads/data.csv' TO TABLE VOLUME my_table FILE 'data.csv';
-- 查看文件
SHOW TABLE VOLUME DIRECTORY my_table;
--导入文件
COPY INTO my_table FROM TABLE VOLUME my_table(id int, name string) USING csv  
OPTIONS(
        'header'='true',
        'lineSep'='\n'
)
FILES ('data.csv')
--删除volume中的文件，节省存储
PURGE=TRUE;

```

2. 创建名为 `hz_image_volume` 的外部 Volume 对象，并上传文件 `'/Users/Downloads/cats_and_dogs.zip'`，将其重命名为 catsdogs.zip：

   ```SQL
   PUT '/Users/Downloads/cats_and_dogs.zip' to VOLUME hz_image_volume FILE 'catsdogs.zip'
   ```

3. 将本地数据上传至名为 `tbl_region` 的表的 Volume 空间：

   ```SQL
   PUT '/Users/Downloads/region.tbl' TO TABLE VOLUME tbl_region;
   ```

## 注意事项

* PUT 命令不能通过 Studio SQL 任务节点执行。用户可以通过 Lakehouse SQLLine 客户端、JDBC 客户端或 SDK 来执行该命令。
* 请确保上传的单个文件大小不超过 5 GB。
* 在使用 PUT 命令时，请确保本地文件的路径和文件名正确无误，避免因路径错误导致上传失败。
* 上传文件时，如果目标 Volume 对象中已存在同名文件，系统将自动覆盖原有文件。如有需要，请在上传前进行相应的备份操作。

^
