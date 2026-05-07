# 利用 External Catalog 访问 Snowflake Open Catalog 中的 Iceberg 表

## **概述**

Lakehouse 支持通过 Catalog Integration 功能连接第三方的 Iceberg REST API，实现与外部数据目录的无缝集成。本文档介绍如何连接和使用 Snowflake 的 Open Catalog 功能。

**功能特性**：

* **统一数据访问**：通过统一的接口访问 Snowflake Open Catalog 中的 Iceberg 表
* **实时数据同步**：直接读取 Snowflake 中的最新数据，无需数据复制
* **元数据映射**：自动映射 Snowflake 中的表结构和元数据信息
* **OAuth 认证**：支持安全的 OAuth 2.0 认证机制

## **环境准备**

Snowflake Open Catalog 提供了两种类型的目录：

**Internal Catalog**：

* **功能特性**：Lakehouse 支持完整的读写操作
* **数据管理**：支持表结构变更、数据插入、更新、删除等全生命周期操作

**External Catalog**：

* **功能特性**：Lakehouse 仅支持只读操作
* **数据访问**：支持复杂查询、联表分析，但不支持数据修改操作

在 Snowflake 中准备 Iceberg 表，并注册到 Snowflake Open Catalog 中，请参考 [Snowflake 官方文档](https://docs.snowflake.com/en/user-guide/tables-iceberg-open-catalog-sync)

实现效果：在 Snowflake Open Catalog 中，注册了一张位于 Snowflake 引擎中的表：

* Database 名称： ICEBERG\_TABLES\_DB\_FLATTEN
* Schema 名称：ICEBERG\_SCHEMA
* Iceberg 表名：czcustomer （要求小写。Snowflake 的建表 DDL 中，用双引号避免表名自动转成大写）

> 注意：在 Snowflake 引擎中创建 Database 时，需加入 `CATALOG_SYNC_NAMESPACE_MODE` 和 `CATALOG_SYNC_NAMESPACE_FLATTEN_DELIMITER` 两个参数以调整 Catalog 层级。如下配置后，在 Snowflake Open Catalog 中，Database 与 Schema 将合并成一个层级："`ICEBERG_TABLES_DB_FLATTEN_ICEBERG_SCHEMA"`
>
> ```
> CREATE OR REPLACE DATABASE iceberg_tables_db_flatten
> CATALOG_SYNC_NAMESPACE_MODE = 'FLATTEN'
> CATALOG_SYNC_NAMESPACE_FLATTEN_DELIMITER = '_';
> ```

![](.topwrite/assets/20250901-112722.jpeg)

## **配置步骤**

### 步骤 1：创建 Catalog Connection

使用以下 SQL 语句创建与 Snowflake Open Catalog 的连接：

```
CREATE CATALOG CONNECTION snow_opencatalog 
    TYPE ICEBERG_REST 
    URI='https://lhnrdre-derekmeng.snowflakecomputing.com/polaris/api/catalog'
    ACCESS_REGION = 'ap-southeast-1' 
    OAUTH_CLIENT_ID='d3r3cuhHitrI+fUpFtvXxxxxxxx'
    OAUTH_CLIENT_SECRET='gY3ZWOGoSMM1tKK7QaqQYKpSdTcPY1ruVv7xxxxxxx'
    OAUTH_SCOPE='PRINCIPAL_ROLE:ALL'
    NAMESPACE='ICEBERG_TABLES_DB_FLATTEN_ICEBERG_SCHEMA'
    WAREHOUSE='singdata'
    WITH PROPERTIES (
        'client.region'='ap-southeast-1',
        'io-impl'='org.apache.iceberg.aws.s3.S3FileIO'
    );
```

| 参数                    | 说明                                  | 示例                                                           |
| --------------------- | ----------------------------------- | ------------------------------------------------------------ |
| TYPE                  | 连接类型，固定为 `ICEBERG_REST`       | `ICEBERG_REST`                                               |
| URI                   | Snowflake Polaris API 端点            | <https://account.snowflakecomputing.com/polaris/api/catalog> |
| ACCESS_REGION         | 访问对象所在的区域                     | `ap-southeast-1`                                             |
| OAUTH_CLIENT_ID       | OAuth 客户端 ID                       | 在 Snowflake Open Catalog 创建 Service connection 时获取     |
| OAUTH_CLIENT_SECRET   | OAuth 客户端密钥                      | 在 Snowflake Open Catalog 创建 Service connection 时获取     |
| OAUTH_SCOPE           | OAuth 授权范围                        | `PRINCIPAL_ROLE:ALL`                                         |
| NAMESPACE             | Snowflake Open Catalog 中的第二个层级  | `ICEBERG_TABLES_DB_FLATTEN_ICEBERG_SCHEMA`                   |
| WAREHOUSE             | Snowflake Open Catalog 的 Catalog 名称 | `singdata`                                                   |

### 步骤 2：创建外部表

创建外部表来映射 Snowflake Open Catalog 中的表：

```SQL
-- 创建外表，映射 Snowflake Open Catalog 中的表（表名需一致）
CREATE EXTERNAL TABLE IF NOT EXISTS `czcustomer`
USING ICEBERG 
CONNECTION snow_opencatalog;
```

> **注意**：外部表名必须与 Snowflake 中的表名完全一致。

### 步骤 3：验证和查询

验证表结构并查询数据：

```SQL
-- 查看表结构
DESC EXTENDED `czcustomer`;

-- 查询数据
SELECT * FROM `czcustomer` LIMIT 10;
```

![](.topwrite/assets/opencatalog_3.jpeg)

## 使用限制

* 连接基于 S3 的 Snowflake 托管的 Iceberg 表时，不支持写入和更新操作
* 外部表名必须与 Snowflake 中的源表名完全匹配
* 暂时仅支持小写表名
* 不支持表名转换
* 在目标 Catalog 服务侧，需要开启 Credential Vending 配置

![](.topwrite/assets/credentials_vending.jpeg)
