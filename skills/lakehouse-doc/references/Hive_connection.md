## 功能概述

Hive 存储连接用于访问和管理已有的 Hive 元数据服务。通过配置此连接，您可以：

1. 无缝对接现有的数据仓库基础设施。
2. 复用已构建的表结构和元数据信息。
3. 统一管理数据目录，实现跨平台数据资产整合。

这种配置方式特别适合企业在数据平台升级或整合过程中，实现平滑过渡和系统共存。您无需迁移现有数据，即可充分利用两个系统的优势。

## 使用限制

* 使用前请确保 Lakehouse 和 Hive 集群网络已打通。
* 目前，云器 Lakehouse 的外部 Catalog 功能支持以下外部数据源：
  * Hive on OSS（阿里云对象存储服务）
  * Hive on COS（腾讯云对象存储服务）
  * Hive on S3（AWS对象存储服务）
  * Hive on GCS（Google云对象存储服务）
* 同时支持读取和写入。写入格式支持 Parquet、ORC、Text 文件格式。

### 创建外部 Catalog

**创建 Hive Catalog 的步骤**

1.  **创建存储连接**：首先需要创建一个存储连接，用于访问对象存储服务。
2.  **创建 Catalog Connection**：使用存储连接信息和 Hive Metastore 地址创建 Catalog Connection。
3.  **创建外部 Catalog**：使用 Catalog Connection 创建外部 Catalog，以便在数据湖中访问外部数据。

#### 创建存储连接

创建存储连接可参考文档 [创建STORAGE CONNECTION](aliyun_storage_connection.md)。

```SQL
CREATE STORAGE CONNECTION if not exists catalog_storage_oss
    type OSS
    ACCESS_ID='LTAIxxxxxxxxxxxx'
    ACCESS_KEY='T8Gexxxxxxmtxxxxxx'
    ENDPOINT='oss-cn-hangzhou-internal.aliyuncs.com';
```

#### 创建 Catalog Connection

```SQL
CREATE CATALOG CONNECTION if not exists catalog_api_connection
    type hms
    hive_metastore_uris='xxx:9083'
    storage_connection='catalog_storage_oss';
```

^
