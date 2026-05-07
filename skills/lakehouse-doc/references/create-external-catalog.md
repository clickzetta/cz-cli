# 创建Hive External Catalog

创建 Hive External Catalog 的步骤如下：

1. [创建存储连接](create-storage-connection.md)：首先需要创建一个存储连接，用于访问对象存储服务。
2. [创建 Catalog Connection](create-catalog-connection.md)：使用存储连接信息和 Hive Metastore 地址创建 Catalog Connection。
3. 创建External Catalog：使用 Catalog Connection 创建外部 Catalog，以便在数据湖中访问外部数据。

## 语法

```SQL
CREATE EXTERNAL CATALOG catalog_name
    CONNECTION catalog_api_connection;
```

**参数说明**

* **catalog_api_connection**：Catalog Connection 名称。目前只支持 HIVE。[参考创建catalog conneciton](create-catalog-connection.md)

### 案例

**案例一：Hive ON OSS（支持读取和写入）**

* 创建存储连接

```SQL
CREATE STORAGE CONNECTION if not exists catalog_storage_oss   
 type OSS    
 ACCESS_ID='LTAIxxxxxxxxxxxx'    
 ACCESS_KEY='T8Gexxxxxxmtxxxxxx'   
 ENDPOINT='oss-cn-hangzhou-internal.aliyuncs.com';
```

* 创建 Catalog Connection
  请确保 HMS 所在服务器网络与 Lakehouse 打通。具体打通方式可以参考[创建阿里云终端节点服务](creating_alicloud_privatelinkservice.md)

```SQL
CREATE CATALOG CONNECTION if not exists catalog_api_connection    
type hms    
hive_metastore_uris='xxxx:9083'    
storage_connection='catalog_storage_oss';
```

* 创建 Catalog

```SQL
CREATE EXTERNAL CATALOG my_external_catalog
    CONNECTION catalog_api_connection;
```

* 验证是否连通Hive Catalog

```SQL
--验证读取元数据
SHOW SCHEMAS IN my_external_catalog;
+---------------------------------------------------------------------------+
|                                schema_name                                |
+---------------------------------------------------------------------------+
| air_travel                                                                |
| all_data                                                                  |
| automobile                                                                |
| automv_schema                                                             |
| bigquant                                                                  |
+---------------------------------------------------------------------------+

--验证读取数据，读取数据时会使用STORAGE CONNECTION权限读取
SELECT * FROM my_external_catalog.my_schema.my_table;
```

**案例二：Hive ON COS（支持读取和写入）**

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
* **ACCESS_KEY / SECRET_KEY**：为腾讯云的访问密钥，获取方式参考：[访问密钥](https://cloud.tencent.com/document/product/598/40488)
* **REGION**：指腾讯云对象存储 COS 的数据中心所在的地域。相同地域内云器Lakehouse访问腾讯云COS时，COS服务将自动路由至内网访问。具体取值请参考腾讯云文档：[地域和访问域名](https://cloud.tencent.com/document/product/436/6224)。

* 创建 Catalog Connection
  请确保 HMS 所在服务器网络与 Lakehouse 打通。具体打通方式可以参考[创建腾讯云终端节点服务](creating_tencentcloud_privatelinkservice.md)

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

* 创建 Catalog

```SQL
CREATE EXTERNAL CATALOG my_external_catalog
    CONNECTION catalog_api_connection;
```

* 验证是否连通Hive Catalog

```SQL
--验证读取元数据
SHOW SCHEMAS IN my_external_catalog;
+---------------------------------------------------------------------------+
|                                schema_name                                |
+---------------------------------------------------------------------------+
| air_travel                                                                |
| all_data                                                                  |
| automobile                                                                |
| automv_schema                                                             |
| bigquant                                                                  |
+---------------------------------------------------------------------------+

--验证读取数据，读取数据时会使用STORAGE CONNECTION权限读取
SELECT * FROM my_external_catalog.my_schema.my_table;
```

**案例三：Hive ON S3（支持读取和写入）**

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
* **ACCESS_KEY / SECRET_KEY**：AWS 的访问密钥，获取方式参考：[访问密钥](https://docs.aws.amazon.com/zh_cn/IAM/latest/UserGuide/id_credentials_access-keys.html)
* **ENDPOINT**：S3 的服务地址。AWS 中国区分为北京区和宁夏区，北京区的 S3 服务地址为 `s3.cn-north-1.amazonaws.com.cn`，宁夏区为 `s3.cn-northwest-1.amazonaws.com.cn`。可参考：[中国区终端节点](https://docs.amazonaws.cn/aws/latest/userguide/endpoints-arns.html) 分别找到北京区域和宁夏区域的终端节点（Endpoint）中 Amazon S3 对应的值。
* **REGION**：AWS 中国区分为北京区和宁夏区，区域值为：北京区 `cn-north-1`，宁夏区 `cn-northwest-1`。可参考：[中国区终端节点](https://docs.amazonaws.cn/aws/latest/userguide/endpoints-arns.html)。
* 创建 Catalog Connection
  ```SQL
CREATE CATALOG CONNECTION if not exists catalog_api_connection    
type hms    
hive_metastore_uris='xxxx:9083'    
storage_connection='catalog_storage_s3';
```

* 创建 Catalog

```SQL
CREATE EXTERNAL CATALOG my_external_catalog
    CONNECTION catalog_api_connection;
```

* 验证是否连通Hive Catalog

```SQL
--验证读取元数据
SHOW SCHEMAS IN my_external_catalog;
+---------------------------------------------------------------------------+
|                                schema_name                                |
+---------------------------------------------------------------------------+
| air_travel                                                                |
| all_data                                                                  |
| automobile                                                                |
| automv_schema                                                             |
| bigquant                                                                  |
+---------------------------------------------------------------------------+

--验证读取数据，读取数据时会使用STORAGE CONNECTION权限读取
SELECT * FROM my_external_catalog.my_schema.my_table;
```

**案例四：Hive ON HDFS（支持读取）**

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

* 创建 Catalog

```SQL
CREATE EXTERNAL CATALOG my_external_catalog
    CONNECTION catalog_api_connection;
```

* 验证是否连通Hive Catalog

```SQL
--验证读取元数据
SHOW SCHEMAS IN my_external_catalog;
--验证读取数据，读取数据时会使用STORAGE CONNECTION权限读取
SELECT * FROM my_external_catalog.my_schema.my_table;
```

> Lakehouse 支持通过 Kerberos 认证连接到启用了安全认证的 Hive Metastore 和 HDFS 集群。
>
> **Step 0：前置条件**
>
> 1. **Kerberos 环境**：确保您的 Hive Metastore 和 HDFS 集群已启用 Kerberos 认证。
> 2. **认证文件**：准备以下必需的 Kerberos 认证文件：
>
>   * `krb5.conf`：Kerberos 配置文件
>   * `hive.keytab`：服务主体的 keytab 文件
>
> 3. **网络连通性**：确保 ClickZetta 可以访问 Kerberos KDC 和 Hive Metastore 服务。
>
> **Step 1**：通过 [客户端工具](comprehensive_guide_to_ingesting_dbv_sql_put.md) 将 Kerberos 配置文件和 keytab 文件上传到 Volume 中：
>
> ```
> -- upload krb5.conf
> PUT '/etc/krb5.conf' TO USER VOLUME FILE 'krb5.conf';
>
> -- upload keytab 
> PUT '/path/to/hive.keytab' TO USER VOLUME FILE 'hive.keytab';
> ```
>
> **Step 2**：使用以下语法创建支持 Kerberos 认证的 catalog connection：
>
> ```
> CREATE CATALOG CONNECTION conn_hms_kerberos_auth
> TYPE HMS
> AUTH_TYPE = 'kerberos'
> KERBEROS_CLIENT_PRINCIPAL = 'hive/localhost@YOUR-REALM.COM'
> KERBEROS_SERVICE_PRINCIPAL = 'hive/localhost@YOUR-REALM.COM'
> KERBEROS_KRB5_CONFIG_PATH = 'volume:user//~/krb5.conf'
> KERBEROS_KEYTAB_PATH = 'volume:user//~/hive.keytab'
> HIVE_METASTORE_URIS = 'thrift://your-hms-host:9083'
> STORAGE_CONNECTION = 'oss_conn_hz';
> ```
>
> | 参数名称                         | 必需 | 描述                  | 示例                               |
> | ---------------------------- | -- | ------------------- | -------------------------------- |
> | AUTH_TYPE                   | 是  | 认证类型，设置为 'kerberos' | 'kerberos'                       |
> | KERBEROS\_CLIENT\_PRINCIPAL  | 是  | Kerberos 客户端主体      | 'hive/localhost\@CZ.COM'         |
> | KERBEROS\_SERVICE\_PRINCIPAL | 是  | Kerberos 服务主体       | 'hive/localhost\@CZ.COM'         |
> | KERBEROS\_KRB5\_CONFIG\_PATH | 是  | krb5.conf 文件路径      | 'volume://vol\_name/krb5.conf'   |
> | KERBEROS\_KEYTAB\_PATH       | 是  | keytab 文件路径         | 'volume://vol\_name/hive.keytab' |
>
> 连接参数：
>
> `TYPE：`是连接类型，设置为 `HMS`
>
> `HIVE_METASTORE_URIS：`是Hive Metastore 服务地址 `'thrift://host:9083'`
>
> `STORAGE_CONNECTION：`关联的存储连接名称 `'your_storage_conn'`
>
> ^
>
> **Step 3**：基于 Kerberos 认证的 catalog connection 创建外部 schema
>
> ```
> CREATE EXTERNAL SCHEMA ext_kerberos_hms_sch 
> CONNECTION conn_hms_kerberos_auth 
> OPTIONS ('schema'='default');
> ```

^

# 创建 Databricks External Catalog

创建 Databricks External Catalog 的步骤如下：

1. [创建 Catalog Connection](create-catalog-connection.md)：存储 Databricks 的 Unity Catalog 连接认证信息。
2. 创建 External Catalog：使用 Catalog Connection 创建外部 Catalog，以便在数据湖中访问外部数据。

## 语法

```SQL
CREATE EXTERNAL CATALOG catalog_name
    CONNECTION catalog_api_connection;
    OPTIONS ('catalog'='catalog_name');
```

**参数说明**

* **catalog_name**：外部 Catalog 的名称。该名称用于标识 Catalog，需唯一且符合命名规范。
* **catalog_api_connection**：指定与外部 Catalog 的连接。`catalog_api_connection` 是预先创建的连接名称，用于访问外部 Catalog。
* **OPTIONS**：指定外部 Catalog 的配置选项。`'catalog'='catalog_name'`：表示外部 Catalog 的名称，`catalog_name` 是目标 Catalog 的名称。

^
