# 创建外部表

## **功能**

外部表功能允许Lakehouse查询和分析存储在对象存储等外部存储系统中的数据。用户可以直接操作外部数据，而无需将数据导入Lakehouse内部存储，这提供了数据处理的灵活性和便利性。

## 支持的范围

* 支持阿里云对象存储oss、支持腾讯云对象存储cos、支持Google云对象存储gcs、支持Aws对象存储S3
* 目前只支持Delta Lake格式

## **语法**

```SQL
CREATE EXTERNAL TABLE [ IF NOT EXISTS ] table_name
(
  column_definition [, column_definition, ...]
)
[PARTITIONED BY (col_name col_type [, col_name col_type, ...] )]
USING DELTA
CONNECTION connection_name
LOCATION 'file_path'
[COMMENT 'table_comment']
```

## **参数说明**

**必选参数**:

* `CREATE EXTERNAL TABLE`: 声明创建一个外部表。

* `table_name`: 外部表的名称。

* `column_definition`: 列定义，指定列的名称和数据类型。

* `USING DELTA`: 指定使用Delta格式，目前仅支持此格式。

* `CONNECTION connection_name`: 连接外部数据源的认证信息，`connection_name`是Lakehouse中定义的连接对象名称。用于认证连接信息，连接对象存储。

* `LOCATION 'file_path'`: 指定要读取的数据文件的路径，支持多种云存储路径格式。

  * google云对象存储：格式gs\://bucketname/path
  * 腾讯云对象存储格式：cos\://bucketname/path
  * 阿里云对象存储格式：oss\://bucketname/path
  * aws对象存储支持阿里云对象存储格式：s3://bucketname/path

**可选参数**:

* `IF NOT EXISTS`: 如果外部表不存在，则创建它；如果已存在，则不执行任何操作。
* `PARTITIONED BY (col_name col_type [, col_name col_type, ...])`: 指定分区列及其数据类型，用于数据分区。
* `COMMENT 'table_comment'`: 为外部表提供描述性注释。

## **示例**

```SQL
--创建connection
CREATE STORAGE CONNECTION if not exists oss_delta
    TYPE oss
    ENDPOINT = 'oss-cn-beijing.aliyuncs.com'
    access_id = 'xxx'
    access_key = 'xxxx'
    comments = 'delta';

--创建外部表,使用上面的连接信息
CREATE EXTERNAL TABLE IF NOT EXISTS sales_data
(
  order_id INT,
  product_id STRING,
  sale_amount DOUBLE
)
PARTITIONED BY (dt STRING)
USING DELTA
CONNECTION oss_delta
LOCATION 'oss://my-bucket/data/sales'
COMMENT 'External table for sales data stored in OSS';
```

^
