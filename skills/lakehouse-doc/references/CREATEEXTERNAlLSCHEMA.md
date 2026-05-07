Lakehouse 引入了一项强大的功能，即通过 `EXTERNAL SCHEMA` 将外部数据库映射到 Lakehouse，使得用户能够在不迁移数据的情况下，直接在 Lakehouse 中查询外部数据。这一功能极大地提升了跨数据源操作和查询的便利性，为用户提供了更加灵活的数据集成解决方案。

# 使用限制

* 目前，云器 Lakehouse 的外部模式映射功能支持以下外部数据源：
  * Hive on OSS（阿里云对象存储服务，支持读取和写入）
  * Hive on COS（腾讯云对象存储服务，支持读取和写入）
  * Hive on S3（AWS 对象存储服务，支持读取和写入）
  * Hive on HDFS（Preview，请联系 Lakehouse 支持，仅支持读取）
  * Databricks Unity Catalog
* 同时支持写入和读取。写入格式支持 Parquet、ORC、Text 文件格式。

# 创建 Hive External Schema

## 语法

### 创建存储连接

首先，您需要创建一个存储连接，以连接到外部对象存储服务。

```SQL
CREATE STORAGE CONNECTION if not exists catalog_storage_oss
    type OSS
    ACCESS_ID='LTAIxxxxxxxxxxxx'
    ACCESS_KEY='T8Gexxxxxxmtxxxxxx'
    ENDPOINT='xxx';
```

### 创建 Hive Catalog 连接

接着，创建一个 Catalog 连接，指向 Hive 元数据存储服务（Hive Metastore）。

```SQL
CREATE CATALOG CONNECTION if not exists connection_name
    type hms
    hive_metastore_uris='metastore_uris'
    storage_connection='storage_connection';
```
### 创建 External Schema

最后，创建一个 External Schema，将外部数据源映射到 Lakehouse。

```SQL
CREATE EXTERNAL SCHEMA if not exists schema_name
    CONNECTION connection_name
    options(SCHEMA='hive_database_name');
```
* `connection`：必选参数，指定Catalog Connection的名称。
* `SCHEMA`：可选参数，用于映射 Hive 的数据库名称。如果未指定，Lakehouse 将默认使用创建的 `schema_name` 名称与 Hive 中的数据库进行自动映射。


### 案例

**案例一：Hive on OSS**

* 创建存储连接

```SQL
CREATE STORAGE CONNECTION if not exists catalog_storage_oss   
 type OSS    
 ACCESS_ID='LTAIxxxxxxxxxxxx'    
 ACCESS_KEY='T8Gexxxxxxmtxxxxxx'   
 ENDPOINT='oss-cn-hangzhou-internal.aliyuncs.com';
```

* 创建 Catalog Connection
  请确保 HMS 所在服务器网络与 Lakehouse 网络打通。具体打通方式可以参考 [创建阿里云终端节点服务](creating_alicloud_privatelinkservice.md)。

```SQL
CREATE CATALOG CONNECTION if not exists catalog_api_connection    
type hms    
hive_metastore_uris='xxxx:9083'    
storage_connection='catalog_storage_oss';
```

* 创建 External Schema

```SQL
CREATE EXTERNAL SCHEMA if not exists my_external_schema
    CONNECTION catalog_api_connection
    options(SCHEMA='default');
```

* 验证是否连通Hive Catalog

```SQL
--验证读取元数据
SHOW TABLES IN my_external_schema;


--验证读取数据，读取数据时会使用STORAGE CONNECTION权限读取
SELECT * FROM my_external_schema.my_table;
```

**案例二：Hive on COS**

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
* **TYPE**：对象存储类型，腾讯云应填写 `COS`（大小写不限）。
* **ACCESS\_KEY / SECRET\_KEY**：腾讯云的访问密钥，获取方式参考：[访问密钥](https://cloud.tencent.com/document/product/598/40488)。
* **REGION**：腾讯云对象存储 COS 的数据中心所在的地域。相同地域内云器 Lakehouse 访问腾讯云 COS 时，COS 服务将自动路由至内网访问。具体取值请参考腾讯云文档：[地域和访问域名](https://cloud.tencent.com/document/product/436/6224)。

* 创建 Catalog Connection
  请确保 HMS 所在服务器网络与 Lakehouse 网络打通。具体打通方式可以参考 [创建腾讯云终端节点服务](creating_tencentcloud_privatelinkservice.md)。

```SQL
CREATE CATALOG CONNECTION if not exists catalog_api_connection    
type hms    
hive_metastore_uris='xxxx:9083'    
storage_connection='catalog_storage_cos';
```
```SQL
CREATE CATALOG CONNECTION if not exists catalog_api_connection    
type hms    
hive_metastore_uris='xxxx:9083'    
storage_connection='catalog_storage_oss';
```

* 创建 External Schema

```SQL
CREATE EXTERNAL SCHEMA if not exists my_external_schema
    CONNECTION catalog_api_connection
    options(SCHEMA='default');
```

* 验证是否连通Hive Catalog

```SQL
--验证读取元数据
SHOW TABLES IN my_external_schema;


--验证读取数据，读取数据时会使用STORAGE CONNECTION权限读取
SELECT * FROM my_external_schema.my_table;
```
**案例三：Hive on S3**

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

* **TYPE**：对象存储类型，AWS 应填写 S3（大小写不限）。
* **ACCESS\_KEY / SECRET\_KEY**：AWS 的访问密钥，获取方式参考：[访问密钥](https://docs.aws.amazon.com/zh_cn/IAM/latest/UserGuide/id_credentials_access-keys.html)。
* **ENDPOINT**：S3 的服务地址。AWS 中国区分为北京区和宁夏区，北京区的 S3 服务地址为 `s3.cn-north-1.amazonaws.com.cn`，宁夏区为 `s3.cn-northwest-1.amazonaws.com.cn`。可参考：[中国区终端节点](https://docs.amazonaws.cn/aws/latest/userguide/endpoints-arns.html) 分别找到北京区域和宁夏区域的终端节点 -> Amazon S3 对应的终端节点。
* **REGION**：AWS 中国区分为北京区和宁夏区，区域值为：北京区 `cn-north-1`，宁夏区 `cn-northwest-1`。可参考：[中国区终端节点](https://docs.amazonaws.cn/aws/latest/userguide/endpoints-arns.html)。
* 创建 Catalog Connection

```SQL
CREATE CATALOG CONNECTION if not exists catalog_api_connection    
type hms    
hive_metastore_uris='xxxx:9083'    
storage_connection='catalog_storage_s3';
```

* 创建 External Schema

```SQL
CREATE EXTERNAL SCHEMA if not exists my_external_schema
    CONNECTION catalog_api_connection
    options(SCHEMA='default');
```

* 验证是否连通Hive Catalog

```SQL
--验证读取元数据
SHOW TABLES IN my_external_schema;


--验证读取数据，读取数据时会使用STORAGE CONNECTION权限读取
SELECT * FROM my_external_schema.my_table;
```
**案例四：Hive on HDFS（支持读取）**

* 创建存储连接
```SQL
  CREATE STORAGE CONNECTION hdfs_conn
  TYPE HDFS
  NAME_NODE='zetta-cluster'
  NAME_NODE_RPC_ADDRESSES=['11.110.239.148:8020'];
  ```
* `TYPE HDFS`：指定连接类型为 HDFS。
    * `NAME_NODE`：对应 [HDFS 配置](https://hadoop.apache.org/docs/stable/hadoop-project-dist/hadoop-hdfs/HDFSHighAvailabilityWithNFS.html) 中的 `dfs.nameservices`，是 HDFS 集群的逻辑名称，例如 `zetta-cluster`。
    * `NAME_NODE_RPC_ADDRESSES`：对应 [HDFS 配置](https://hadoop.apache.org/docs/stable/hadoop-project-dist/hadoop-hdfs/HDFSHighAvailabilityWithNFS.html) 中的 `dfs.namenode.rpc-address`，是 NameNode 的 RPC 地址，格式为 `[<host>:<port>]`，例如 `['11.110.239.148:8020']`。
* 创建 Catalog Connection

```SQL
CREATE CATALOG CONNECTION if not exists catalog_api_connection    
type hms    
hive_metastore_uris='xxxx:9083'    
storage_connection='hdfs_conn';
```
* 创建 External Schema

```SQL
CREATE EXTERNAL SCHEMA if not exists my_external_schema
    CONNECTION catalog_api_connection
    options(SCHEMA='default');
```

* 验证是否连通Hive Catalog

```SQL
--验证读取元数据
SHOW TABLES IN my_external_schema;


--验证读取数据，读取数据时会使用STORAGE CONNECTION权限读取
SELECT * FROM my_external_schema.my_table;
```

# 创建 Databricks External Schema

## 语法

### 创建 Databricks Catalog 连接

创建一个 Catalog 连接，指向 Databricks 元数据存储服务。具体使用参考 [创建 Databricks Catalog](<create-catalog-connection.md>)。
```SQL
CREATE CATALOG CONNECTION IF NOT EXISTS connection_name
    TYPE databricks
    HOST = 'host_value'
    CLIENT_ID = 'client_id_value'
    CLIENT_SECRET = 'client_secret_value'
    ACCESS_REGION = 'access_region_value';
```
**参数说明**
* **`connection_name`**：连接的名称，用于标识该 Databricks Unity Catalog 连接。名称需唯一且符合命名规范。 
- **`TYPE databricks`**：指定连接类型为 Databricks Unity Catalog。
- **`HOST`**：Databricks 工作区的 URL 地址。通常格式为 `https://<workspace-url>`。示例：`https://dbc-12345678-9abc.cloud.databricks.com`
- **`CLIENT_ID`**：用于 OAuth 2.0 机器对机器（M2M）认证的客户端 ID。参考 [Databricks OAuth M2M 认证文档](https://docs.databricks.com/en/dev-tools/auth/oauth-m2m.html) 创建 OAuth 2.0 应用，并获取 `CLIENT_ID`。                      
- **`CLIENT_SECRET`**：用于 OAuth 2.0 机器对机器（M2M）认证的客户端密钥。参考 [Databricks OAuth M2M 认证文档](https://docs.databricks.com/en/dev-tools/auth/oauth-m2m.html) 创建 OAuth 2.0 应用，并获取 `CLIENT_SECRET`。                   
- **`ACCESS_REGION`**：Databricks 工作区所在的区域（Region），例如 `us-west-2` 或 `east-us`。 
### 创建 External Schema

```sql
CREATE EXTERNAL SCHEMA schema_name 
   CONNECTION connection_name    
OPTIONS ('catalog'='catalog_value', 'schema'='schema_value');
```
**参数说明**
- **`schema_name`**：外部模式的名称。该名称用于标识外部模式，需唯一且符合命名规范。                                                                                       
- **`CONNECTION connection_name`**：指定与外部模式的连接。`connection_name` 是预先创建的连接名称，用于访问外部模式。                                                                     
- **`OPTIONS`**：指定外部模式的配置选项。
    - `'catalog'='catalog_value'`：指定外部模式的 Catalog 名称。
    - `'schema'='schema_value'`：指定外部模式的 Schema 名称。
**示例**
```sql
CREATE EXTERNAL SCHEMA external_db_sch   
 CONNECTION conn_db    
 OPTIONS ('catalog'='quick_start', 'schema'='default');
```
**示例解析**：
* **`external_db_sch`**：创建的外部模式名称。
* **`conn_db`**：用于连接外部模式的连接名称。
* **`OPTIONS`**：
  * `catalog='quick_start'`：指定外部模式的 Catalog 名称。
  * `schema='default'`：指定外部模式的 Schema 名称。
* 验证是否连通 Databricks Unity Catalog

```
--验证读取元数据
SHOW TABLES IN external_db_sch;
```






