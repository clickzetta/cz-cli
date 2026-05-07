## 功能概述

>【**预览发布】本功能当前处于公开预览发布阶段**。

本文主要介绍如何在 SQL 中创建与 Kafka 消息队列系统连接的外部表。通过定义外部表，可以方便地从 Kafka 中读取数据流，并将这些数据流作为表进行查询和分析。

## 创建存储连接

首先，需要创建一个存储连接，用于连接到 Kafka 服务器。目前连接需要证书的方式不支持

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
* **SECURITY\_PROTOCOL**: 安全协议，可以是 `PLAINTEXT` 等。

### 示例

```SQL
CREATE STORAGE CONNECTION test_kafka_conn
    TYPE kafka
    BOOTSTRAP_SERVERS = ['47.99.48.62:9092']
    SECURITY_PROTOCOL = 'PLAINTEXT';
```

## 创建外部表

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
CONNECTION connection_name
OPTIONS (
    'group_id' = 'consumer_group',
    'topics' = 'topic_name',
    'starting_offset' = 'earliest' -- 可选，默认值 earliest
) ;
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
* **CONNECTION**: 指定之前创建的存储连接名称。

### 示例

```SQL
CREATE EXTERNAL TABLE IF NOT EXISTS test_kafka_table (key binary, value binary NOT NULL)
USING kafka
OPTIONS (
    'group_id' = 'test_consumer',
    'topics' = 'commit_log_all_bj_env'
) CONNECTION test_kafka_conn;
select cast(key as string) , cast ( value as string) from test_kafka_table limit 10;
--转成json提取其中多 某个字段
select cast(key as string) , 
parse_json(cast ( value as string))['id'] as id,
parse_json(cast ( value as string))['name'] as name
from test_kafka_table limit 10;
```

