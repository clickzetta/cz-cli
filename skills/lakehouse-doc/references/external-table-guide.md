# **外部表简介**

**功能概述：** 外部表是 Lakehouse 的一项特性，它使您能够查询存储在外部系统中的数据，就如同这些数据存储在 Lakehouse 内部一样。这些外部数据并不存储或管理在 Lakehouse 中。

**性能提示：** 由于外部表中的数据存储在 Lakehouse 外部，查询外部表可能比查询存储在本地的表稍慢。为了提升查询效率，建议使用 `INSERT INTO internal_table_name SELECT * FROM external_table_name` 语句或 `COPY INTO` 命令将数据导入到 Lakehouse 中。

## 支持的外部表数据源
- Kafka 外部表
- Delta Lake 外部表
- Hudi 外部表
## **外部表与 External Schema 的区别**

* **External Schema：** 直接与 Hive 元数据服务（HMS）交互，通过 HMS 接口直接获取 Hive 的元数据信息。
* **外部表：** 允许用户自定义创建表，指定列内容和表名。
* **External Schema 限制：** 由于是直接映射 HMS，无法在 External Schema 下直接创建、删除表或重命名表。
* **外部表优势：** 支持重命名和修改注释等操作，因为它们是在内部 schema 下创建的。
## 具体案例

### 连接阿里云 OSS

```SQL
--创建connection,用于连接对象存储
CREATE STORAGE CONNECTION  oss_delta
    TYPE oss
    ENDPOINT = 'oss-cn-hangzhou-internal.aliyuncs.com'
    access_id = 'xxxxxx'
    access_key = 'xxxxxx'
    comments = 'delta'
    ;
--使用上面的链接信息，创建外部表
CREATE    EXTERNAL TABLE pepole_delta (id int, name string,dt string) 
USING DELTA 
CONNECTION oss_delta 
PARTITIONED BY (dt ) 
LOCATION 'oss://bucketmy/delta-format/uploaddelta/' 
COMMENT 'edelta-external';
```

### 连接 Google GCS

Lakehouse 连接 Google Cloud Storage (GCS) 时，将使用服务账号密钥进行身份验证。请按照以下步骤操作：

1. **获取服务账号密钥**：
   1. 登录 Google Cloud 控制台。
   2. 按照 *[Google Cloud 文档](https://cloud.google.com/docs/authentication/getting-started)* 的指导，创建并下载服务账号的 JSON 密钥文件。

2. **配置 `private_key` 参数**：
   1. 打开下载的 JSON 密钥文件，将文件中的私钥内容完整复制。

3. **注意**：
   1. 在配置 `private_key` 时，在 `private_key` 添加 `r`，表示转义字符不会被转义。

```SQL
--创建connection,用于连接对象存储
CREATE STORAGE CONNECTION  oss_delta
    TYPE gcs
    private_key=r'{
  "type": "service_account",
  "project_id": "PROJECT_ID",
  "private_key_id": "KEY_ID",
  "private_key": "-----BEGIN PRIVATE KEY-----\nPRIVATE_KEY\n-----END PRIVATE KEY-----\n",
  "client_email": "SERVICE_ACCOUNT_EMAIL",
  "client_id": "CLIENT_ID",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://accounts.google.com/o/oauth2/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/SERVICE_ACCOUNT_EMAIL"
}';
--使用上面的链接信息，创建外部表
CREATE    EXTERNAL TABLE pepole_delta (id int, name string,dt string) 
USING DELTA 
CONNECTION oss_delta 
PARTITIONED BY (dt ) 
LOCATION 'gs://bucketmy/delta-format/uploaddelta/' 
COMMENT 'edelta-external';
```



## **外部表计费**

* **存储费用：** 外部表不产生存储费用，因为数据不存储在 Lakehouse 中。
* **计算费用：** 使用外部表进行计算会消耗计算资源，因此会产生计算费用。

## **外部表权限**

外部表和内部表的权限点相同。由于外部表无法执行 INSERT、UPDATE、TRUNCATE、DELETE、UNDROP 等操作，因此没有对应的操作权限点。

* **创建权限：** 需要具有创建表（create table）的权限。
* **删除权限：** 需要具有删除（drop）权限。
* **读取权限：** 需要具有选择（select）权限。

## **使用注意事项**

* **连接配置：** 创建 Connection 时，确保 Endpoint 配置正确，以便 Lakehouse 能够成功连接。如果 Lakehouse 和对象存储位于同一云服务且在同一区域，通常使用内网地址即可实现网络互通。如果不在同一网络环境，建议使用对象存储的公网地址。

