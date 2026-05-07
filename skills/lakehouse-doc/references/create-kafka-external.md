# 创建DELTA和HUDI外部表

## 功能

外部表功能允许Lakehouse查询和分析存储在对象存储等外部存储系统中的数据。用户可以直接操作外部数据，而无需将数据导入Lakehouse内部存储，这提供了数据处理的灵活性和便利性。

**外部表的其他命令**：

* **删除外部表**：通过使用`DROP TABLE`语法，删除外部表。
* **查看外部表详情**：使用`DESC TABLE`语法，您可以快速查看外部表的结构和详细信息。
* **修改外部表**：修改外部表，`ALTER TABLE`
* **查看外部表建表语句**：`SHOW CREATE TABLE`语句
* **参考案例**: 具体如何操作外部表，可以参考[Delta Lake](delta-lake.md)的外部表使用指南。

## 支持的范围

* 支持阿里云对象存储oss、支持腾讯云对象存储cos、支持Aws对象存储S3

## **语法**

```SQL
CREATE EXTERNAL TABLE [ IF NOT EXISTS ] table_name
[(
  column_definition [, column_definition, ...]
)]
[PARTITIONED BY (col_name col_type [, col_name col_type, ...] )]
USING DELTA|HUDI
CONNECTION connection_name
LOCATION 'file_path'
[COMMENT 'table_comment']
```

## **参数说明**

**必选参数**:

* `CREATE EXTERNAL TABLE`: 声明创建一个外部表。

* `table_name`: 外部表的名称。

* `column_definition`: 列定义，指定列的名称和数据类型。要求必须和delta、hudi中的类型和名称保持一致。参考Lakehouse支持的[数据类型](data-type.md)。可选，Lakehouse支持自动推断列的名称和数据类型

* `USING DELTA|HUDI`: 指定文件格式目前支持Delta Lake和Hudi格式

* `CONNECTION connection_name`: 连接外部数据源的认证信息，`connection_name`是Lakehouse中定义的连接对象名称。用于认证连接信息，连接对象存储。具体创建文档参考[对象存储连接(STORAGE CONNECTION)](Datalake_StorageConnection.md)
  * 创建oss connection
  ```
  CREATE STORAGE CONNECTION my_conn 
    TYPE COS
    ACCESS_KEY = '<access_key>'
    SECRET_KEY = '<secret_key>'
    REGION = 'ap-shanghai'
    APP_ID = '1310000503';
  ```
  * 创建cos connection
  ```
  CREATE STORAGE CONNECTION my_conn 
    TYPE COS
    ACCESS_KEY = '<access_key>'
    SECRET_KEY = '<secret_key>'
    REGION = 'ap-shanghai'
    APP_ID = '1310000503';
  ```
  * 创建s3 connection
  ```
  CREATE STORAGE CONNECTION aws_bj_conn
      TYPE S3
      ACCESS_KEY = 'AKIAQNBSBP6EIJE33***'
      SECRET_KEY = '7kfheDrmq***************************'
      ENDPOINT = 's3.cn-north-1.amazonaws.com.cn'
      REGION = 'cn-north-1';
  ```

* `LOCATION 'file_path'`: 使用 `LOCATION 'file_path'` 指令可指定待读取的数据文件路径，支持多种云存储格式。对于 Delta Lake 表，外部表将扫描该位置中的事务日志文件（如 `_delta_log/00000000000000000000.json` 或 `_delta_log/00000000000000000010.checkpoint.parquet`），以确定最新的 Parquet 文件。
  * file\_path 是一个区分大小写的字符串，代表云存储中文件的位置或前缀（即文件夹），用于限定要加载的文件集。腾讯云对象存储 (COS): cos\://bucketname/path、阿里云对象存储 (OSS): oss//bucketname/path、AWS S3 对象存储: s3://bucketname/path

  * file\_path中指定的路径必须仅包含单个 Delta Lake 或 Hudi 表的数据文件和元数据。即，每个存储位置只能对应一个目录。

  * file\_path读取数据时会使用connection中的权限和认证信息。需要授权GetObject、ListObjects、PutObject、DeleteObject权限

  * 每次读取时都会重新解析 Delta Lake 事务日志，确保获取最新的元数据。因此，不会缓存元数据。

**可选参数**:

* `IF NOT EXISTS`: 如果外部表不存在，则创建它；如果已存在，则不执行任何操作。
* `PARTITIONED BY (col_name col_type [, col_name col_type, ...])`: 指定分区列及其数据类型，用于数据分区。如果DELTA和HUID是分区表则必须指定
* `COMMENT 'table_comment'`: 为外部表提供描述性注释。

## 用法说明

* 外部表无法访问归档类型的文件，这些数据需要先还原才能检索
* 外部表不支持TIME TRAVEL.
* 删除外部表时只会删除外部表的定义，不会删除对象存储中的文件

## **示例**

1.oss上创建delta外部表
步骤一：需要创建oss connection。具体文档参考[腾讯云存储连接创建](cos_storage_connection.md)
步骤二：创建外部表，指定外部表的位置

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
USING DELTA
CONNECTION oss_delta
LOCATION 'oss://my-bucket/data/sales'
COMMENT 'External table for sales data stored in OSS';
```

2.cos上创建delta外部表
步骤一：需要创建cos connection。具体文档参考[阿里云存储连接创建](aliyun_storage_connection.md)
步骤二：创建外部表，指定外部表的位置

```SQL
--创建connection
CREATE STORAGE CONNECTION my_conn
  TYPE COS
  ACCESS_KEY = '<access_key>'
  SECRET_KEY = '<secret_key>'
  REGION = 'ap-shanghai'
  APP_ID = '1310000503';

--创建外部表,使用上面的连接信息
CREATE EXTERNAL TABLE IF NOT EXISTS sales_data
USING DELTA
CONNECTION oss_delta
LOCATION 'cos://cz-volume-sh-1311343935/sales';
```

3.s3上创建delta外部表
步骤一：需要创建cos connection。具体文档参考[亚马逊云存储连接创建](aws_storage_connection.md)
步骤二：创建外部表，指定外部表的位置

```
--创建connection
CREATE STORAGE CONNECTION aws_bj_conn
    TYPE S3
    ACCESS_KEY = 'AKIAQNBSBP6EIJE33***'
    SECRET_KEY = '7kfheDrmq***************************'
    ENDPOINT = 's3.cn-north-1.amazonaws.com.cn'
    REGION = 'cn-north-1';


--创建外部表,使用上面的连接信息
CREATE EXTERNAL TABLE IF NOT EXISTS sales_data
(
  order_id INT,
  product_id STRING,
  sale_amount DOUBLE
)
PARTITIONED BY (dt STRING)
USING DELTA
CONNECTION aws_bj_conn
LOCATION 's3://cz-udf-user/sales'
COMMENT 'External table for sales data stored in OSS';

```



# 创建Kafka外部表

首先，需要创建一个存储连接，用于连接到 Kafka 服务器，连接前需要保证您的Kafka和Lakehouse网络打通，网络打通方式可以参考[私网连接](private_link.md)。本文介绍创建Kafka存储连接和Kafka外部表。

**外部表的其他命令**：

* **删除外部表**：通过使用`DROP TABLE`语法，删除外部表。
* **查看外部表详情**：使用`DESC TABLE`语法，您可以快速查看外部表的结构和详细信息。
* **修改外部表**：修改外部表，`ALTER TABLE`
* **查看外部表建表语句**：`SHOW CREATE TABLE`语句
* **参考案例**: 具体如何操作外部表，可以参考[Delta Lake](delta-lake.md)的外部表使用指南。

## 创建Kafka存储连接

### 语法

```SQL
CREATE STORAGE CONNECTION connection_name
    TYPE kafka
    BOOTSTRAP_SERVERS = ['server1:port1', 'server2:port2', ...]
    SECURITY_PROTOCOL = 'PLAINTEXT';
```

### 参数说明

* **connection\_name**: 连接的名称，用于后续引用。
* **TYPE**: 连接类型，此处为 `kafka`。
* **BOOTSTRAP\_SERVERS**: Kafka 集群的地址列表，格式为 `['host1:port1', 'host2:port2', ...]`。
* **SECURITY\_PROTOCOL**: 安全协议，目前只支持 `PLAINTEXT`。不支持**SSL**或者**SASL\_SSL**

### 示例

```SQL
CREATE STORAGE CONNECTION test_kafka_conn
    TYPE kafka
    BOOTSTRAP_SERVERS = ['47.99.48.62:9092']
    SECURITY_PROTOCOL = 'PLAINTEXT';
```

## 创建Kafka外部表

在创建了存储连接之后，可以定义外部表来读取 Kafka 中的数据。

### 语法

```SQL
CREATE EXTERNAL TABLE IF NOT EXISTS external_table_name (
 `topic` string,
 `partition` int,
 `offset` bigint,
 `timestamp` timestamp_ltz,
 `timestamp_type` string,
`headers` map<string, string>,
 `key` binary, `value` binary)
USING kafka
CONNECTION connection_name;
OPTIONS (
    'group_id' = 'consumer_group',
    'topics' = 'topic_name',
    'starting_offset' = 'earliest',  -- 可选，默认值 earliest
    'ending_offset' = 'latest',      -- 可选，默认值 latest
    'cz.kafka.seek.timeout.ms' = '2000', -- Kafka 默认值
    'cz.kafka.request.retry.times' = '1', -- Kafka 默认值
    'cz.kafka.request.retry.intervalMs' = '2000' -- Kafka 默认值
) 
```

### 参数说明

* **external\_table\_name**: 外部表的名称。
* **字段说明**

| 字段              | 含义                                                                              | 类型                   |
| --------------- | ------------------------------------------------------------------------------- | -------------------- |
| topic           | Kafka主题名称                                                                       | STRING               |
| partition       | 数据分区ID                                                                          | INT                  |
| offset          | Kafka分区中的偏移量                                                                    | BIGINT               |
| timestamp       | Kafka消息时间戳                                                                      | TIMESTAMP\_LTZ       |
| timestamp\_type | Kafka消息时间戳类型                                                                    | STRING               |
| headers         | Kafka消息头                                                                        | MAP\<STRING, BINARY> |
| key             | 消息键的列名，类型为 `binary`。您可以通过类型转化方式如`cast(key_column as string)`将binary类型转化为可读的字符串  | BINARY               |
| value           | ，消息体的列名，类型为 `binary`。您可以通过类型转化方式如`cast(key_column as string)`将binary类型转化为可读的字符串 | BINARY               |

* **USING kafka**: 指定使用 Kafka 作为数据源。
* **OPTIONS**:
  * **group\_id**: Kafka 消费者组 ID。
  * **topics**: Kafka 主题名称。
  * **starting\_offset**: 起始偏移量，默认值是earliest，可以是 `earliest` 或 `latest`。
  * **ending\_offset**: 结束偏移量，默认值是`latest`，可以是 `earliest` 或 `latest`。
  * **cz.kafka.seek.timeout.ms**: Kafka 寻址超时时间（毫秒）。
  * **cz.kafka.request.retry.times**: Kafka 请求重试次数。
  * **cz.kafka.request.retry.intervalMs**: Kafka 请求重试间隔时间（毫秒）。
    * kafka_parameters: 需要传入到Kafka的参数，以kafka.开头，直接使用kafka的参数即可,可以在Kafka中找到这种选项。,格式如'kafka.security.protocol'='PLAINTEXT', 'kafka.auto.offset.reset'='latest')取值参考，[kafka文档](https://kafka.apache.org/documentation/#consumerconfigs)
* **CONNECTION**: 指定之前创建的存储连接名称。

## 使用具体案例

```
CREATE storage connection test_kafka_conn 
TYPE kafka 
bootstrap_servers = [
'1.1.1.1:9092,1.1.1.1:9092,1.1.1.1:9092'
];

CREATE    EXTERNAL TABLE IF NOT EXISTS test_kafka_table (
          `topic` string,
          `partition` int,
          `offset` bigint,
          `timestamp` timestamp_ltz,
          `timestamp_type` string,
          `headers` map < string,string >,
          `key` binary,
          `value` binary
          ) USING kafka OPTIONS (
          'topics' = 'topic_test_kafka_pipe_loading',
          'group_id' = 'group_test_kafka_pipe_loading'
          ) connection test_kafka_conn;

--查询数据
SELECT    cast(key AS string),
          cast(value AS string)
FROM      test_kafka_table
LIMIT     10;

--转成json提取其中多 某个字段
SELECT    cast(key AS string),
          parse_json (cast(value AS string)) ['id'] AS id,
          parse_json (cast(value AS string)) ['name'] AS name
FROM      test_kafka_table
LIMIT     10;
```

