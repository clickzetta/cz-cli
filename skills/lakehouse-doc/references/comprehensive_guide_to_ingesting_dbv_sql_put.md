# 将数据导入云器 Lakehouse 的完整指南

## 数据入湖：通过数据库客户端 DBV/SQLWorkbench PUT 文件的方式

#### 概述

PUT 命令是 Lakehouse SQL 中的一个实用工具，用于将客户端主机的本地文件上传到 Lakehouse 的数据湖 Volume 对象中。通过该命令，用户可以轻松地将本地文件传输至云端，实现数据的快速迁移和同步。要执行 PUT 命令，您可以使用 sqlline 工具或数据库管理工具。

#### 使用场景

* 将本地文件上传到数据湖 Volume 对象。
* 快速迁移和同步本地与云端数据。

#### 实现步骤

##### 下载安装 DBV

本指南示例数据库管理工具使用 [DbVisualizer Free版](https://www.dbvis.com/)。如已安装请跳过。

下载云器 Lakehouse 的 [JDBC Driver](JDBC-Driver.md) 到本地。

在 DBV 中安装 Lakehouse 的 JDBC Driver。

##### 在 DBV 中新建 Database

建立与云器 Lakehouse 的连接。

##### 新建 SQL Script 并运行

```SQL
PUT 'data/lift_tickets_data.csv.zip' TO volume ingest_demo  FILE 'gz/lift_tickets_data_put.csv.zip';SHOW  VOLUME DIRECTORY ingest_demo;
```

##### ![](.topwrite/assets/image_1736215162253.png =531)

##### 检查 PUT 结果

```SQL
SHOW  VOLUME DIRECTORY ingest_demo;
```

#### 资料

[SQL PUT 命令](PUT.md)

[JDBC Driver](JDBC-Driver.md)

[数据库管理工具](data-mamager-tool.md)
