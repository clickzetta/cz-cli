# EXTERNAL SCHEMA
>**【预览发布】本功能当前处于公开预览发布阶段。**
## 简介

外部 Schema（EXTERNAL SCHEMA）是 Lakehouse 提供的一项查询外部数据源的功能，借助 EXTERNAL SCHEMA 可以实现与外部元数据服务（如 HMS）的访问以及外表的批量映射，无需将数据导入 Lakehouse。例如，通过与Hive的Database建立映射，并利用Hive元数据服务（HMS）接口，外部Schema能够直接获取Hive的元数据信息，但不会在Lakehouse中实际创建表结构。
使用 EXTERNAL SCHEMA 可以带来如下收益：
1. **直接查询**：通过 EXTERNAL SCHEMA，用户可以直接对外部数据库（如 Apache Hive）中的数据进行查询，而无需进行复杂的数据导入过程。由于 Lakehouse 性能更优，也可以起到为第三方引擎加速查询的作用。
2. **数据转换和导入**：结合使用`INSERT INTO ..SELECT`语句，用户可以实现数据的提取、转换和加载（ETL），将查询结果直接写入到Lakehouse的表中。
3. **实时联接**：EXTERNAL SCHEMA支持将Lakehouse的表与外部数据源中的数据进行实时联接，这意味着用户可以在数据发生变化时直接查询，而不是等待数据重新加载。
4. **删除行为说明**：删除外部 Schema 不会删除 Hive 中的 Database，因为外部 Schema 仅是与 Hive 中的 Database 建立了映射关系，删除操作只会移除 Lakehouse 中的外部 Schema 元数据信息。

这种设计提供了极大的灵活性和便利性，因为它减少了数据迁移的需要，并使得用户能够实时地查询和分析存储在外部数据源中的数据。
## 外部Catalog和外部Schema使用关系
外部 Catalog 和外部 Schema 形成两层映射结构。外部 Catalog 是顶层容器，直接映射外部数据系统；外部 Schema 是中间层容器，提供细粒度的数据组织。通过将外部Schema关联到内部Catalog，您可以在同一工作空间中统一查询外部和内部表，只需使用 `schema.table` 的简单格式即可。
## 支持的范围

* Hive on OSS（阿里云对象存储服务）
* Hive on COS（腾讯云对象存储服务）
* Hive on GCS（Google云对象存储服务）
* Hive on HDFS (Preview，请联系 Lakehouse 支持)
* Databricks
* 同时支持写入和读取。写入格式支持 Parquet、ORC、Text 文件格式。

## 外部Schema与外部表的区别

* **External Schema**：直接与 Hive 元数据服务（HMS）交互，通过 HMS 接口直接获取 Hive 的元数据信息。
* **外部表：** 用户可以自定义创建表，指定列内容和表名。
* **External Schema 限制**：由于是直接映射 HMS，无法在 External Schema 下直接创建、删除表或重命名表。
* **外部表优势：** 支持重命名和修改注释等操作，因为它们是在内部 Schema 下创建的。

## 外部Schema计费

* **存储费用：** 外部表不产生存储费用，因为数据不存储在Lakehouse中。
* **计算费用：** 使用外部表进行计算会消耗计算资源，因此会产生计算费用。

## 外部Schema权限

* **创建外部Schema权限：** 需要具有创建Schema（create schema）的权限。
* **删除外部Schema权限：** 需要具有删除（drop）权限。
* **外部 Schema 下表的权限**：目前单独表无法单独授权，只支持 ALL TABLES 权限。


## 管理

云器 Lakehouse 提供了创建和删除 EXTERNAL SCHEMA 的命令，以便用户可以根据需要管理这些外部数据源的访问权限和配置。

- **创建EXTERNAL SCHEMA**：用户可以通过`CREATE EXTERNAL SCHEMA`命令来创建一个新的EXTERNAL SCHEMA，从而开始与外部数据库进行交互。具体的语法和参数设置可以在[创建EXTERNAL SCHEMA](CREATEEXTERNAlLSCHEMA.md)文档中找到。
- **删除EXTERNAL SCHEMA**：如果某个EXTERNAL SCHEMA不再需要，或者用户希望移除对外部数据库的访问权限，可以使用`DROP SCHEMA`命令来删除它。相关的操作步骤和注意事项在[删除EXTERNAL SCHEMA](DROPSCHEMA.md)文档中有详细说明。

## 权限说明

* **创建外部Schema权限：** 需要具有创建Schema（create schema）的权限。
* **删除外部Schema权限：** 需要具有删除（drop）权限。
* **外部 Schema 下表的权限**：目前单独表无法单独授权，只支持 ALL TABLES 权限。


## 约束限制
**支持的数据源**：目前，EXTERNAL SCHEMA 主要支持访问 Hive Metastore 元数据服务，且数据需要存储在 HDFS 或阿里云、腾讯云、谷歌云对象存储服务中。
**操作限制**：在外部 Schema 下，不支持执行创建表、删除表等操作，因为它们是直接映射的。此外，外部 Schema 下的表仅支持只读操作，不允许进行插入、更新、截断或删除等数据操作语言（DML）操作。用户可以执行查询和连接操作，并能基于这些表创建视图。
**删除行为说明：** 删除外部Schema不会删除源系统中的映射对象（如Hive Database及其包含的表）。

## 使用样例

#### **1. 连接阿里云 OSS**

要连接阿里云 OSS，您需要以下参数，具体参考 *[阿里云OSS文档](https://help.aliyun.com/zh/oss/developer-reference/configure-ossutil)*：

首先，您需要创建一个存储连接，以连接到外部对象存储服务。

```SQL
CREATE STORAGE CONNECTION if not exists catalog_storage_oss
    type OSS
    ACCESS_ID='LTAIxxxxxxxxxxxx'
    ACCESS_KEY='T8Gexxxxxxmtxxxxxx'
    ENDPOINT='xxx';
```
接着，创建一个目录连接，指向 Hive 元数据存储服务（Hive Metastore）。

```SQL
CREATE CATALOG CONNECTION if not exists connection_name
    type hms
    hive_metastore_uris='metastore_uris'
    storage_connection='storage_connection';
```

```SQL
CREATE EXTERNAL SCHEMA if not exists schema_name
    CONNECTION connection_name
    options(SCHEMA='hive_database_name');
```

* `connection`：必选参数，指定目录连接的名称。
* `SCHEMA`：可选参数，用于映射 Hive 的数据库名称。如果未指定，Lakehouse 将默认使用创建的 `schema_name` 名称与 Hive 中的数据库自动映射。

