## 功能概述

在数据湖架构中，Hive Catalog 是一个关键组件，用于将数据湖与外部的元数据存储（例如 Hive Metastore）关联起来。通过创建 Hive Catalog，用户可以实现元数据的统一管理和访问，从而直接读取存储在外部系统中的数据。Apache Hive 已成为数据仓库生态系统的核心，不仅是大数据分析和 ETL 的 SQL 引擎，还是一个数据管理平台，可用于发现、定义和演化数据。同时，Lakehouse 支持读取和写入 Hive 数据。

## 使用限制

* 使用前请注意，需要保证 Lakehouse 和 Hive 集群网络连通。
* 目前，云器 Lakehouse 的外部 Catalog 功能支持以下外部数据源：
  * Hive on OSS（阿里云对象存储服务）
  * Hive on COS（腾讯云对象存储服务）
  * Hive on S3（AWS 对象存储服务）
  * Hive on GCS（Google云对象存储服务）
  * Hive on HDFS (Preview，请联系 Lakehouse 支持)
* 同时支持读取和写入。写入格式支持 Parquet、ORC、Text 文件格式。

### 创建外部 Catalog

**创建 Hive Catalog 的步骤**

1. **创建存储连接**：首先需要创建一个存储连接，用于访问对象存储服务。
2. **创建 Catalog Connection**：使用存储连接信息和 Hive Metastore 地址创建 Catalog Connection。
3. **创建外部 Catalog**：使用 Catalog Connection 创建外部 Catalog，以便在数据湖中访问外部数据。

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

#### 创建外部 Catalog

```SQL
CREATE EXTERNAL CATALOG test_external_catalog
    CONNECTION catalog_catalog_connection;
```

#### 使用 Catalog

```SQL
--列出catalog下的schema
show schemas in test_external_catalog;
--列出catalog下的所有表
show tables in test_external_catalog.my_external_test;
--查寻catalog下的表
select * from test_external_catalog.my_external_test.test;
--查看catalog下的表结构
desc test_external_catalog.my_external_test.test;
```

#### 使用 Hive 表和 Lakehouse 表关联查询

其中，`test_external_catalog.my_external_test.test` 是 Hive 中的表，`public.test` 是 Lakehouse 的内部表。

```
select * from 
test_external_catalog.my_external_test.test a
left join 
public.test b 
on a.id=b.id;
```

^
