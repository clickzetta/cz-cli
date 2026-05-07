# HUDI外部表
>**【预览发布】本功能当前处于公开预览发布阶段。**

HUDI为数据湖中的数据引入了结构化存储层，极大地提升了数据湖的易用性，使其操作体验接近于数据仓库。通过Lakehouse支持的外部表功能，用户能够便捷地访问和操作这些结构化数据。

## 创建HUDI格式外部表

\[创建外部表语法]\(create-external-table.md)

**示例**

```SQL
--创建conneciton
CREATE STORAGE CONNECTION if not exists oss_hudi
    TYPE oss
    ENDPOINT = 'oss-cn-beijing.aliyuncs.com'
    access_id = 'xxx'
    access_key = 'xxxx'
    comments = 'hudi';
--创建外部表,使用上面的连接信息
CREATE EXTERNAL TABLE IF NOT EXISTS sales_data
(
  order_id INT,
  product_id STRING,
  sale_amount DOUBLE
)
PARTITIONED BY (dt STRING)
USING HUDI
CONNECTION oss_hudi
LOCATION 'oss://my-bucket/data/sales'
COMMENT 'External table for sales data stored in OSS';
```

## 删除外部表

```SQL
DROP TABLE [ IF EXISTS ] [schema_name.]<table_name
```

**参数说明**

* `IF EXISTS`：可选，如果指定的表不存在，系统不会报错。
* `schema_name`：可选，指定 schema 的名称。如果未指定，默认使用当前用户的 schema。
* `table_name`：要删除的表名称。

**说明**

* 删除外部表并不会删除数据，因为数据存储在外部系统中，删除操作只会删除表的映射信息。

**示例**

```SQL
--删除已经创建的外部表
DROP TABLE sales_data;
--删除名为 sales_data 的表，如果表不存在，不报错：
DROP TABLE IF EXISTS sales_data;
--删除名为 my_schema 下的 sales_data表
DROP TABLE my_schema.my_table;
```

## 查看外部表详情

```SQL
DESC[RIBE] [TABLE] [EXTENDED] table_name;
```

**参数说明**

* **DESC\\\[RIBE]**：DESC和DESCRIBE可以互换使用，都表示描述表结构的命令。
* **TABLE**：可选参数，用于指定查看表结构的类型，如BASE TABLE或VIEW等。
* **EXTENDED**：可选参数，加入此关键字后，可以展示更多扩展信息，如表的创建语句和Location信息等。
* **table\\\_name**：指定需要查看结构的表名。

## 修改外部表

### 重命名表

通过ALTER TABLE命令，您可以将现有的表重命名为新的表名。

**语法**

```SQL
ALTER TABLE name RENAME TO new_table_name;
```

**示例**

```SQL
ALTER TABLE old_table_name RENAME TO new_table_name;
```

### 修改表注释

通过ALTER TABLE命令，您可以为表添加或修改注释。

**语法**

```SQL
ALTER TABLE tbname SET COMMENT '';
```

**示例**

```SQL
ALTER TABLE scores SET COMMENT '这是一个成绩表';
```

## **外部表计费**

* **存储费用**：外部表不产生存储费用，因为数据不存储在 Lakehouse 中。
* **计算费用**：使用外部表进行计算会消耗计算资源，因此会产生计算费用。

## **外部表权限**

外部表和内部表权限点相同。由于外部表无法执行 INSERT、UPDATE、TRUNCATE、DELETE、UNDROP 等操作，因此没有对应的操作权限点。

* **创建权限**：需要具有创建表（create table）的权限。
* **删除权限**：需要具有删除（DROP）权限。
* **读取权限**：需要具有选择（select）权限。

## **使用注意事项**

* **连接配置**： 创建 connection 时，确保 endpoint 配置正确，以便 Lakehouse 能够成功连接。如果 Lakehouse 和对象存储位于同一云服务且在同一区域，通常使用内网地址即可实现网络互通。如果不在同一网络环境，建议使用对象存储的公网地址。

## 具体案例

### 连接阿里云Oss

```SQL
--创建connection,用于连接对象存储
CREATE STORAGE CONNECTION  oss_hudi
    TYPE oss
    ENDPOINT = 'oss-cn-hangzhou-internal.aliyuncs.com'
    access_id = 'xxxxxx'
    access_key = 'xxxxxx'
    comments = 'hudi'
    ;
--使用上面的链接信息，创建外部表
CREATE    EXTERNAL TABLE pepole_hudi (id int, name string,dt string) 
USING HUDI 
CONNECTION oss_hudi 
PARTITIONED BY (dt ) 
LOCATION 'oss://bucketmy/hudi-format/uploadhudi/' 
COMMENT 'external';
```

### 连接Google GCS

Lakehouse 连接 Google Cloud Storage (GCS) 时，将使用服务账号密钥进行身份验证。请按照以下步骤操作：

1. **获取服务账号密钥**：

* 登录 Google Cloud 控制台。
* 按照 *[Google Cloud 文档](https://cloud.google.com/docs/authentication/getting-started)* 的指导，创建并下载服务账号的 JSON 密钥文件。

2. **配置 ****`private_key`**** 参数**：

* 打开下载的 JSON 密钥文件，将文件中的私钥内容完整复制

3. **注意**：

* 在配置 `private_key` 时，必须前面添加r,r代表区分大小写，殊字符和 unicode 字符都不会被转义。

```SQL
--创建connection,用于连接对象存储
CREATE STORAGE CONNECTION  oss_hudi
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
CREATE    EXTERNAL TABLE pepole_hudi (id int, name string,dt string) 
USING HUDI 
CONNECTION oss_hudi 
PARTITIONED BY (dt ) 
LOCATION 'gs://bucketmy/hudi-format/uploadhudi/' 
COMMENT 'external';
```
