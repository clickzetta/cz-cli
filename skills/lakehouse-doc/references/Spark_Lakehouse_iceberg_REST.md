## 概述

Lakehouse 提供了标准的 Apache Iceberg Catalog REST API 接口，允许外部计算引擎（如 Apache Spark）通过统一的 REST 协议访问和查询存储在 Lakehouse 数据湖（如对象存储 OSS）中的 Iceberg 表。这使得在保持数据统一存储的同时，能够灵活选择不同的计算引擎进行数据分析。

## 核心特性

* **标准兼容**：兼容 Apache Iceberg REST Catalog 规范
* **引擎支持**：支持 Spark 计算引擎
* **权限委托**：通过 vended-credentials 模式管理存储访问权限
* **多云支持**：支持阿里云 OSS（后续版本支持 AWS S3、腾讯云 COS 等）

## 使用限制

**数据类型兼容性**

当通过 Spark 引擎访问 ClickZetta Lakehouse 表时，存在以下数据类型限制：

暂不支持的数据类型：

* **整数类型**：`SMALLINT`, `TINYINT`
* **半结构化类型**：`JSON`
* **向量类型**：`VECTOR`

## 快速开始

### 前置要求

1. 云器 Lakehouse 实例的账号和密码

2. 目标计算引擎环境：Spark 3.5+

3. 必要的依赖包：

   1. Apache Iceberg 库（Scala 2.12 / Spark 3.5.x）`：org.apache.iceberg:iceberg-spark-runtime-3.5_2.12:1.6.1`

   2. 对应云对象存储的 SDK（如阿里云 OSS：`com.aliyun.oss:aliyun-sdk-oss:3.18.1`）

### PySpark 集成示例

#### 环境准备

```Python
import os
import base64
from pyspark.sql import SparkSession
# 设置 SPARK_HOME 环境变量（根据实际安装路径调整）
os.environ['SPARK_HOME'] = '/path/to/pyspark'
```

连接云器 Lakehouse 的认证配置

```Python
# 配置认证信息
username = "your_username"
password = "your_password"

# 生成 Basic Authentication header
credentials = f"{username}:{password}"
encoded_bytes = base64.b64encode(credentials.encode("utf-8"))
encoded_str = encoded_bytes.decode("utf-8")
auth_header = f"Basic {encoded_str}"
```

创建 Spark Session

```Python
spark = SparkSession.builder \
    .appName('IcebergCatalogIntegration') \
    .config("spark.jars.packages", "org.apache.iceberg:iceberg-spark-runtime-3.5_2.12:1.6.1," + "com.aliyun.oss:aliyun-sdk-oss:3.18.1") \
    .config('spark.sql.extensions', 'org.apache.iceberg.spark.extensions.IcebergSparkSessionExtensions') \
    .config('spark.sql.defaultCatalog', 'clickzetta_catalog') \
    .config('spark.sql.catalog.clickzetta_catalog', 'org.apache.iceberg.spark.SparkCatalog') \
    .config('spark.sql.catalog.clickzetta_catalog.type', 'rest') \
    .config("spark.sql.catalog.clickzetta_catalog.header.instanceName", "your_instance_id") \
    .config("spark.sql.catalog.clickzetta_catalog.header.Workspace", "your_workspace") \
    .config('spark.sql.catalog.clickzetta_catalog.uri','https://api.clickzetta.com/api/v1/catalog/iceberg-rest') \
    .config("spark.sql.catalog.clickzetta_catalog.header.Authorization", auth_header) \
    .config("spark.sql.catalog.clickzetta_catalog.io-impl", "org.apache.iceberg.aliyun.oss.OSSFileIO") \
    .config("spark.sql.catalog.clickzetta_catalog.oss.endpoint", "oss-cn-hangzhou.aliyuncs.com") \
    .config('spark.sql.catalog.clickzetta_catalog.header.X-Iceberg-Access-Delegation','vended-credentials') \
    .config("spark.sql.catalog.clickzetta_catalog.default-namespace", "public") \
    .config("spark.sql.catalog.clickzetta_catalog.metrics-reporter-impl", "org.apache.iceberg.metrics.LoggingMetricsReporter") \
    .getOrCreate()
```

使用示例

```Python
# 查看所有命名空间（schemas）
spark.sql("SHOW NAMESPACES IN clickzetta_catalog").show()

# 查看指定命名空间中的表
spark.sql("SHOW TABLES IN clickzetta_catalog.public").show()

# 查看表结构
spark.sql("DESCRIBE TABLE clickzetta_catalog.public.your_table").show()

# 查询数据
df = spark.sql("SELECT * FROM clickzetta_catalog.public.your_table LIMIT 10")df.show()

# 使用 DataFrame API
table_df = spark.table("clickzetta_catalog.public.your_table")
table_df.filter("column_name > 100").select("col1", "col2").show()
```

## 配置参数详解

| 参数 (Parameter)                                                           | 描述 (Description)                                                                                                                                          | 示例值 (Example Value)                                                                                                                                              | 是否必需 (Required?) |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Spark与Iceberg基础配置                                                        |                                                                                                                                                           |                                                                                                                                                                  |                  |
| spark.jars.packages                                                      | 用于指定 Spark 会话在启动时需要从 Maven 中央仓库自动下载的依赖包。这里包含了 Iceberg 的 Spark 运行时和与阿里云 OSS 交互所需的 SDK。                                                                     | org.apache.iceberg\:iceberg-spark-runtime-3.5\_2.12:1.6.1,com.aliyun.oss\:aliyun-sdk-oss:3.18.1                                                                  | 是                |
| spark.sql.extensions                                                     | 用于向 Spark SQL 注入 Iceberg 的扩展功能。这使得 Spark 能够解析和执行 Iceberg 特有的 DDL 和 DML 语句（例如 CREATE TABLE ... USING iceberg）。                                             | org.apache.iceberg.spark.extensions.IcebergSparkSessionExtensions                                                                                                | 是                |
| Lakehouse REST Catalog 核心配置                                              |                                                                                                                                                           |                                                                                                                                                                  |                  |
| spark.sql.catalog.clickzetta\_catalog                                    | 固定值。注册一个名为 clickzetta\_catalog 的新目录，并指定其实现类为 Iceberg 的 SparkCatalog。这是定义一个 Iceberg Catalog 的入口点。                                                          | org.apache.iceberg.spark.SparkCatalog                                                                                                                            | 是                |
| spark.sql.catalog.clickzetta\_catalog.type                               | 固定值。指定 clickzetta\_catalog 的类型为 rest。这告诉 Iceberg 该 Catalog 是一个通过 REST API 进行通信的远程服务。                                                                      | rest                                                                                                                                                             | 是                |
| spark.sql.catalog.clickzetta\_catalog.uri                                | REST Catalog 服务的 API 端点地址。Spark 将向此 URL 发送所有元数据管理请求（如创建表、获取表信息等）。                                                                                         | https://{endpoint}/api/v1/catalog/iceberg-rest。endpoint 取值请参考[文档](https://www.yunqi.tech/documents/Supported_Cloud_Platforms)                                    | 是                |
| spark.sql.catalog.clickzetta\_catalog.header.instanceName                | 发送到 REST Catalog 的自定义 HTTP 请求头。用于向 ClickZetta 服务标识您的特定实例。                                                                                                 | your\_instance\_id (请替换为您的实例 ID)                                                                                                                                  | 是                |
| spark.sql.catalog.clickzetta\_catalog.header.Workspace                   | 发送到 REST Catalog 的自定义 HTTP 请求头。用于在您的 ClickZetta 实例中指定要操作的工作空间。                                                                                            | your\_workspace (请替换为您的工作空间名称)                                                                                                                                   | 是                |
| spark.sql.catalog.clickzetta\_catalog.header.Authorization               | 用于 API 认证的授权令牌。通常是一个 Bearer 令牌，用于验证客户端身份。此值应通过安全的方式获取和传递。                                                                                                 | auth\_header (一个包含认证信息的变量)，如："Basic VUFUX1RFU1Q6QWJjZDEyMzQ1Ng=="                                                                                                | 是                |
| spark.sql.catalog.clickzetta\_catalog.header.X-Iceberg-Access-Delegation | 这是一个特殊的请求头，用于启用凭证代理（Vended Credentials）模式。设置为 vended-credentials 表示客户端（Spark）期望 Catalog 服务返回用于访问底层存储（OSS）的临时安全凭证。这是一种更安全的访问模式，避免了在客户端暴露长期有效的云存储密钥。        | vended-credentials                                                                                                                                               | 是                |
| 数据存储 (OSS) 配置                                                            |                                                                                                                                                           |                                                                                                                                                                  |                  |
| spark.sql.catalog.clickzetta\_catalog.io-impl                            | 指定用于读写数据文件（如 Parquet, ORC）的 FileIO 实现。这里使用 OSSFileIO 来与阿里云 OSS 进行交互。                                                                                      | org.apache.iceberg.aliyun.oss.OSSFileIO                                                                                                                          | 是                |
| spark.sql.catalog.clickzetta\_catalog.oss.endpoint                       | 阿里云对象存储服务 (OSS) 的区域端点。客户端将通过此地址访问 OSS 存储桶。                                                                                                                | [oss-cn-hangzhou.aliyuncs.com](http://oss-cn-hangzhou.aliyuncs.com) (可根据您的 OSS 存储桶所在区域修改，请参考[文档](https://help.aliyun.com/zh/oss/user-guide/regions-and-endpoints)) | 是                |
| 可选/辅助配置                                                                  |                                                                                                                                                           |                                                                                                                                                                  |                  |
| spark.sql.defaultCatalog                                                 | 设置 Spark SQL 的默认 Catalog。设置后，执行 SQL 查询时无需在表名前显式指定 Catalog 名称（例如，可以直接使用 `SELECT * FROM my_table` 而不是 `SELECT * FROM clickzetta_catalog.public.my_table`）。 | clickzetta\_catalog                                                                                                                                              | 否                |
| spark.sql.catalog.clickzetta\_catalog.default-namespace                  | 设置 clickzetta\_catalog 内部的默认命名空间（或称为数据库/Schema）。如果设置了此项，在未指定命名空间时，表操作将默认在此命名空间下进行。                                                                        | public                                                                                                                                                           | 否 (但推荐)          |
| spark.sql.catalog.clickzetta\_catalog.metrics-reporter-impl              | 配置 Iceberg 指标（Metrics）的报告器实现。LoggingMetricsReporter 会将操作指标（如扫描耗时、文件数量等）输出到 Spark 的日志中，便于调试和性能分析。                                                          | org.apache.iceberg.metrics.LoggingMetricsReporter                                                                                                                | 否                |

## 故障排查

### 常见问题及解决方案

1. **认证失败**

   1. 检查用户名和密码是否正确。
   2. 确认 Base64 编码是否正确。
   3. 验证账号是否有相应权限。

2. **连接超时**

   1. 检查网络连接。
   2. 确认 API 端点地址是否正确。
   3. 调整超时参数。

3. **表不存在**

   1. 确认 workspace 和 namespace 设置正确。
   2. 使用 `SHOW TABLES` 确认表名。
   3. 检查用户权限。

^
