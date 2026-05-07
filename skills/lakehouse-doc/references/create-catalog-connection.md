# 创建 Catalog Connection

Catalog Connection 是一个关键组件，用于管理与第三方Catalog的连接信息。它的核心功能是为External Catalog提供访问认证，确保Lakehouse平台能够安全、无缝地访问和管理存储服务中的数据资源。

# 支持的Catalog

* Hive Catalog：通过连接 Hive Metastore，或者兼容 Hive Metastore 的元数据服务，Lakehouse 可以自动获取 Hive 的库表信息，并进行数据查询。
* Databricks Unity Catalog：Unity Catalog 是 Databricks 上数据和 AI 资产的统一治理解决方案。在 Unity Catalog 中，所有元数据都注册在元存储中。任何 Unity Catalog 元存储中的数据库对象层次结构都分为三个级别，当您引用表、视图、卷、模型和函数时，它们表示为三级命名空间。通过连接 Databricks 的 Unity Catalog，Lakehouse 可以自动获取 Databricks 的库表信息，并进行数据查询。
* 要求必须和 Lakehouse 所在的存储位置在同一云平台。例如，如果 Lakehouse 在 AWS，则 Databricks 存储须在 S3。

# 创建Hive Catalog语法

```SQL
CREATE CATALOG CONNECTION if not exists connection_name
    type hms
    hive_metastore_uris='metastore_uris'
    storage_connection='storage_connection';
```

**参数说明**

* **connection\_name**: 连接的名称，需保证唯一性。
* **type**: 连接类型，此处为 `hms`（Hive Metastore Service）。
* **hive\_metastore\_uris**: Hive Metastore 的服务地址，格式为 `host:port`。port（端口）通常是 9083。
* **storage\_connection**: 已创建的存储连接名称，用于访问对象存储或者hdfs服务。具体参考[CREATE STORAGE CONNECTION](create-storage-connection.md)

## 创建Hive Catalog Connection 的步骤

1. **创建存储连接**：首先需要创建一个存储连接，用于访问对象存储服务。用户需指定 Hive 数据存储的位置，目前只支持对象存储 OSS、COS、S3。
2. **创建 Catalog Connection**：使用存储连接信息和 Hive Metastore 地址创建 Catalog Connection。

### 创建存储连接

```SQL
CREATE STORAGE CONNECTION if not exists catalog_storage_oss    type OSS    ACCESS_ID='LTAIxxxxxxxxxxxx'    ACCESS_KEY='T8Gexxxxxxmtxxxxxx'    ENDPOINT='oss-cn-hangzhou-internal.aliyuncs.com';
```

### 创建 Catalog Connection

```SQL
CREATE CATALOG CONNECTION if not exists catalog_api_connection    type hms    hive_metastore_uris='47.95.221.23:9083'    storage_connection='catalog_storage_oss';
```

### 案例

案例一：Hive ON OSS

* 创建存储连接

```SQL
CREATE STORAGE CONNECTION if not exists catalog_storage_oss   
 type OSS    
 ACCESS_ID='LTAIxxxxxxxxxxxx'    
 ACCESS_KEY='T8Gexxxxxxmtxxxxxx'   
 ENDPOINT='oss-cn-hangzhou-internal.aliyuncs.com';
```

* 创建 Catalog Connection
  请确保和HMS所在服务器网络和Lakehouse打通。具体打通方式可以参考[创建阿里云终端节点服务](creating_alicloud_privatelinkservice.md)

```SQL
CREATE CATALOG CONNECTION if not exists catalog_api_connection    
type hms    
hive_metastore_uris='xxxx:9083'    
storage_connection='catalog_storage_oss';
```

案例二：Hive ON COS

* 创建存储连接

```sql
CREATE STORAGE CONNECTION catalog_storage_cos 
  TYPE COS
  ACCESS_KEY = '<access_key>'
  SECRET_KEY = '<secret_key>'
  REGION = 'ap-shanghai'
  APP_ID = '1310000503';
```

**参数**：
* **TYPE**：为对象存储类型，腾讯云应填写 `COS`（大小写不限）
\* **ACCESS\_KEY / SECRET\_KEY**：为腾讯云的访问密钥，获取方式参考：[访问密钥](https://cloud.tencent.com/document/product/598/40488)
\* **REGION**：指腾讯云对象存储 COS 的数据中心所在的地域。相同地域内云器Lakehouse访问腾讯云COS时，COS服务将自动路由至内网访问。具体取值请参考腾讯云文档：[地域和访问域名](https://cloud.tencent.com/document/product/436/6224)。

* 创建 Catalog Connection
  请确保和HMS所在服务器网络和Lakehouse打通。具体打通方式可以参考[创建腾讯云终端节点服务](creating_tencentcloud_privatelinkservice.md)

```SQL
CREATE CATALOG CONNECTION if not exists catalog_api_connection    
type hms    
hive_metastore_uris='xxxx:9083'    
storage_connection='catalog_storage_cos';
```

案例三：Hive ON S3

* 创建存储连接

```
CREATE STORAGE CONNECTION catalog_storage_s3
    TYPE S3
    ACCESS_KEY = 'AKIAQNBSBP6EIJE33***'
    SECRET_KEY = '7kfheDrmq***************************'
    ENDPOINT = 's3.cn-north-1.amazonaws.com.cn'
    REGION = 'cn-north-1';
```

**参数**：

* **TYPE**：为对象存储类型，AWS 应填写 S3（大小写不限）
* **ACCESS_KEY / SECRET_KEY**：为 AWS 的访问密钥，获取方式参考：[访问密钥](https://docs.aws.amazon.com/zh_cn/IAM/latest/UserGuide/id_credentials_access-keys.html)
* **ENDPOINT**：S3 的服务地址。AWS 中国区分为北京区和宁夏区，北京区的 S3 服务地址为 `s3.cn-north-1.amazonaws.com.cn`，宁夏区为 `s3.cn-northwest-1.amazonaws.com.cn`。可参考：[中国区终端节点](https://docs.amazonaws.cn/aws/latest/userguide/endpoints-arns.html) 分别找到北京区域和宁夏区域的终端节点 -> Amazon S3 对应的终端节点。
* **REGION**：AWS 中国区分为北京区和宁夏区，区域值为：北京区 `cn-north-1`，宁夏区 `cn-northwest-1`。可参考：[中国区终端节点](https://docs.amazonaws.cn/aws/latest/userguide/endpoints-arns.html)
* 创建 Catalog Connection

```SQL
CREATE CATALOG CONNECTION if not exists catalog_api_connection    
type hms    
hive_metastore_uris='xxxx:9083'    
storage_connection='catalog_storage_s3';
```

# 创建 Databricks Unity Catalog 连接

***

## **概述**

本文档详细说明如何使用 SQL 语句创建 Databricks Unity Catalog 连接。通过该连接，用户可以将外部系统与 Databricks Unity Catalog 集成，实现数据管理和共享。本文档涵盖语法、参数说明及配置要求。

***

## **语法**

```SQL
CREATE CATALOG CONNECTION IF NOT EXISTS <CONNECTION_NAME>
    TYPE databricks
    HOST = 'host_value'
    CLIENT_ID = 'client_id_value'
    CLIENT_SECRET = 'client_secret_value'
    ACCESS_REGION = 'access_region_value';
```

**参数说明**

* `CONNECTION_NAME`：连接的名称，用于标识该 Databricks Unity Catalog 连接。名称需唯一且符合命名规范。
* `TYPE`：指定连接类型为 Databricks Unity Catalog。
* `HOST`： Databricks 工作区的 URL 地址。通常格式为 `https://<workspace-url>`。  示例：`https://dbc-12345678-9abc.cloud.databricks.com`
* `CLIENT_ID / CLIENT_SECRET`: 用于 OAuth 2.0 机器对机器（M2M）认证的客户端 ID。参考 [Databricks OAuth M2M 认证文档](https://docs.databricks.com/en/dev-tools/auth/oauth-m2m.html) 创建 OAuth 2.0 应用，并获取 `CLIENT_ID `和` CLIENT_SECRET`
* `ACCESS_REGION`：Databricks 工作区所在的区域（Region），例如 `us-west-2` 或 us-east-1。

## **示例**

**Step 1：Databricks 准备**

1. 创建 service principal 参考[Databricks文档](https://docs.databricks.com/en/dev-tools/auth/oauth-m2m.html#language-Java)获取 principal 及其 client id/client secret
2. Metastore 开启 external data access
   ![](.topwrite/assets/image_1739256232288.png)
   ![](.topwrite/assets/image_1739256275537.png)
3. 授权 service principal

```SQL
--使用 service principal 的 id
GRANT EXTERNAL USE SCHEMA ON SCHEMA quick_start.default TO `cf752cce-e2ca-4d03-8cdc-9f8f8aac43fc`;

```

以下是一个完整的示例，展示如何创建 Databricks Unity Catalog 连接：

```SQL
CREATE CATALOG CONNECTION IF NOT EXISTS my_databricks_conn
    TYPE databricks
    HOST = 'https://dbc-12345678-9abc.cloud.databricks.com'
    CLIENT_ID = '12345678-9abc-def0-1234-56789abcdef0'
    CLIENT_SECRET = 'abcdef1234567890abcdef1234567890'
    ACCESS_REGION = 'us-west-2';
```

**Step 2：Lakehouse**
以下是一个完整的示例，展示如何创建 Databricks Unity Catalog 连接：

```SQL
CREATE CATALOG CONNECTION IF NOT EXISTS my_databricks_conn    
 TYPE databricks   
 HOST = 'https://dbc-12345678-9abc.cloud.databricks.com'    
 CLIENT_ID = '12345678-9abc-def0-1234-56789abcdef0' 
 CLIENT_SECRET = 'abcdef1234567890abcdef1234567890' 
 ACCESS_REGION = 'us-west-2';
```

**常见问题**

Q1: 如何验证连接是否成功?

* 创建连接后，可通过查询 Catalog下的Schema 或表数据验证连接状态。
* 示例：

  ```SQL
    CREATE EXTERNAL CATALOG external_db_cat
    CONNECTION my_databricks_conn
    OPTIONS ('catalog'='quick_start');
    show schemas in external_db_cat;
    select * from external_db_cat.default.student;
  ```

Q2：连接失败的可能原因有哪些？

* `HOST` 地址错误或不可访问。
* `CLIENT_ID` 或 `CLIENT_SECRET` 无效或权限不足。
* `ACCESS_REGION` 与 Databricks 工作区区域不匹配。

Q3：如何更新连接配置？

* 删除现有连接后重新创建：
  ```SQL
  DROP CATALOG CONNECTION my_databricks_conn;
  ```

^
