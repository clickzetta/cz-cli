# 批量从对象存储导入数据

本文档详细介绍了如何使用 Lakehouse 的 SQL 引擎从对象存储中导入数据。目前，Lakehouse 支持两种主要的数据导入模式：

1.  **使用 Volume 导入**：通过创建和管理对象存储上的 Volume 来导入数据。
2.  **使用 COPY 命令导入**：利用 SQL 的 COPY 命令直接从对象存储中加载数据。

# 参考文档

[数据湖查询](structure_data_analysis.md)

[COPY INTO](copy-into-table.md)

# 应用场景

*   利用 SQL 引擎的性能优势快速读取大量数据，高效处理大规模数据集。
*   支持在数据导入过程中使用 SQL 进行数据转换，实现 ETL（Extract, Transform, Load）流程。
*   建议在导入数据时选择通用型计算集群（GENERAL PURPOSE VIRTUAL CLUSTER），以适应批量作业和数据加载的需求。

# 使用限制

*   **对象存储支持**：目前 Volume 的目标对象存储仅支持阿里云 OSS 和腾讯云 COS。
*   **费用说明**：从外部 Volume 下载文件可能会产生云账号的对象存储下载费用，具体费用请参考相应云服务商的计费说明。如果 Lakehouse 与对象存储位于同一地域，使用内网 Endpoint 可以避免额外费用。
*   **跨云导入**：目前不支持跨云服务商导入数据（未来版本将支持）。

# 使用案例

## 使用Volume从OSS读取CSV数据导入

本文详细介绍了如何利用 Lakehouse 的 Volume 和 COPY 命令从阿里云对象存储服务（OSS）导入[巴西电子商务](https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce?select=olist_customers_dataset.csv)的公共数据集。或者，您也可以直接通过[链接](https://czsampledata.oss-cn-shanghai.aliyuncs.com/eCommerce/BrazilianECommerce/olist_customers_dataset.csv?Expires=1713960305\&OSSAccessKeyId=TMP.3Kj9FumEnKg87NyAXLcgdBykW427fGRqHzTyiLfNtki6Vagmg1zMHEfVcqov1PXETvKM7DKauBXyah4YNWhfdgHNufoq2j\&Signature=afXWkoRTi%2BercYhvlsPKdrpv0Fg%3D\&x-oss-request-payer=requester)下载本次案例的数据集，然后上传到 OSS 中。该过程包括数据表的创建、对象存储连接的配置、Volume 的管理以及数据的加载和状态检查。

### 前置条件

*   确保已创建目标表 `brazilian_customer`：

```SQL
create table brazilian_customer( 
  customer_id STRING,
  customer_unique_id STRING,
  customer_zip_code_prefix INT,
  customer_city STRING,
  customer_state STRING
  );
```

*   对目标表具有 INSERT 权限。

### 创建CONNECTION和VOLUME用于连接对象存储

*   创建一个 STORAGE CONNECTION 以存储和脱敏对象存储的连接信息，便于在 Lakehouse 中复用和管理。
*   创建一个 EXTERNAL VOLUME 来管理 OSS 上的数据。

```SQL
--存储对象存储的连接信息，在Lakhouse会对ak进行脱敏。同时connection可以方便多处复用
--endpoint使用的是oss内网因为和Lakehouse同时都在上海，所以内网可以直接连通
CREATE STORAGE CONNECTION  braziliandata_conn
    TYPE oss
    ENDPOINT = 'oss-cn-shanghai-internal.aliyuncs.com'
    access_id = 'xxxx'
    access_key = 'xxxx'
    comments = 'OSS public endpoint';
 --查看创建的conneciton
 SHOW CONNECTIONS;
--创建Volume用于管理对象存储上面的数据
CREATE EXTERNAL VOLUME braziliandata_csv
    location 'oss://yourbucketname/eCommerce/BrazilianECommerce/'
    using connection braziliandata_conn
    directory = (
        enable=true,
        auto_refresh=true
    );
  SHOW VOLUMES;
```

### **使用Volume加载数据**

*   指定 Volume 中需要读取的文件，可以在 `files` 参数中指定。
*   在 `options` 中可以设置 CSV 文件的参数，如分隔符等，具体设置可参考文档。
*   本案例中，将在数据加载时进行转换，排除掉城市为 ‘curitiba’ 的记录。

```SQL
--加载数据的时候做转化排除掉城市是‘curitiba’
insert into brazilian_customer
select * from volume braziliandata_csv (
  customer_id STRING,
  customer_unique_id STRING,
  customer_zip_code_prefix INT,
  customer_city STRING,
  customer_state STRING
)using csv 
 options(
    'header'='true',
    'sep'=','
 ) files('olist_customers_dataset.csv') 
 where customer_city !='curitiba';
```

### 查看导入数据的状态

在 Lakehouse 的作业运行历史中查看作业的执行状态，以确认数据导入是否成功。

![](.topwrite/assets/image_1714292176194.png)

## 使用COPY命令从OSS导入数据

本文介绍了如何使用 Lakehouse 的 COPY 命令从阿里云对象存储服务（OSS）导入[巴西电子商务](https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce?select=olist_customers_dataset.csv)的公共数据集，或者您也可以直接通过[链接](https://czsampledata.oss-cn-shanghai.aliyuncs.com/eCommerce/BrazilianECommerce/olist_geolocation_dataset.csv?Expires=1713960430\&OSSAccessKeyId=TMP.3Kj9FumEnKg87NyAXLcgdBykW427fGRqHzTyiLfNtki6Vagmg1zMHEfVcqov1PXETvKM7DKauBXyah4YNWhfdgHNufoq2j\&Signature=2bCPx2sokSkMGpwfkipZqfmoWlE%3D\&x-oss-request-payer=requester)下载本次案例的数据集，然后上传到 OSS 中。该过程涉及数据表的创建、连接和 Volume 的配置，以及数据的加载和状态检查。

### 前置条件

*   确保已创建目标表 `brazilian_geolocation`：

```SQL
create table brazilian_geolocation( 
  geolocation_zip_code_prefix INT,
  geolocation_lat DECIMAL(10,8),
  geolocation_lng DECIMAL(11,8),
  geolocation_city STRING,
  geolocation_state STRING
  );
```

*   对目标表具有 INSERT 权限。

### 创建CONNECTION和VOLUME用于连接对象存储

*   创建一个 STORAGE CONNECTION 来存储和脱敏对象存储的连接信息，以便在 Lakehouse 中多次复用和管理。
*   创建一个 EXTERNAL VOLUME 来管理 OSS 上的数据。

```SQL
    --存储对象存储的连接信息，在Lakhouse会对ak进行脱敏。同时connection可以方便多处复用和管理
    --endpoint使用的是oss内网因为和Lakehouse同时都在上海，所以内网可以直接连通
    CREATE STORAGE CONNECTION  braziliandata_conn
        TYPE oss
        ENDPOINT = 'oss-cn-shanghai-internal.aliyuncs.com'
        access_id = 'xxxx'
        access_key = 'xxxx'
        comments = 'OSS public endpoint';
     --查看创建的conneciton
     SHOW CONNECTIONS;
    --创建Volume用于管理对象存储上面的数据
    CREATE EXTERNAL VOLUME braziliandata_csv
        location 'oss://czsampledata/eCommerce/BrazilianECommerce/'
        using connection braziliandata_conn
        directory = (
            enable=true,
            auto_refresh=true
        );
      SHOW VOLUMES;
    ```

### 使用COPY命令加载数据到表中

使用 COPY 命令将数据从 OSS 的 Volume 加载到 `brazilian_customer` 表中。

```SQL
COPY  INTO brazilian_customer FROM VOLUME  
braziliandata_csv (
  customer_id STRING,
  customer_unique_id STRING,
  customer_zip_code_prefix INT,
  customer_city STRING,
  customer_state STRING
)using csv 
 options(
    'header'='true',
    'sep'=','
 ) files('olist_geolocation_dataset.csv') ;
```

### 查看导入数据的状态

在 Lakehouse 的作业运行历史中查看作业的执行状态，以确认数据导入是否成功。

![](.topwrite/assets/image_1714292217461.png)
