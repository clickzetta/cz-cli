## READ\_KAFKA

## 功能描述

`READ_KAFKA` 函数用于从 Apache Kafka 集群**一次性读取**数据并以表格形式返回。该函数主要用于**数据探查、测试和临时查询**场景，直接SELECT查询不会在 Kafka 中创建持久的消费者组。

**语法**

```SQL
SELECT ... FROM READ_KAFKA(
 'bootstrap',
 'topic',
'topic_pattern',
 'group_id', 
'STARTING_OFFSETS', 'ENDING_OFFSETS', 'STARTING_OFFSETS_TIMESTAMP', 'ENDING_OFFSETS_TIMESTAMP', 
'KEY_FORMAT', 
'VALUE_FORMAT', 
   0,
MAP()      
)
```

`read_kafka` 函数用于从Kafka读取数据。它支持以下参数：

* **bootstrap**: Kafka服务器地址，如 `1.2.3.1:9092,1.2.3.2:9092`。
* **topic**: Kafka主题名称，多个主题用逗号分隔，如 `topicA,topicB`。
* **topic\_patternt**\*：topic正则，暂不支持，默认留空。如：''。\*
* **group\_id**: Kafka消费者组ID。临时消费者组 ID，仅用于函数执行期间**不会在 Kafka 中创建持久消费者组**
* **STARTING\_OFFSETS**: 指定读取的起始点位，默认为 `earliest`，在读取时推荐填写。
* **ENDING\_OFFSETS**: 指定结束点位，默认为 `latest`，在读取时推荐填写。
* **STARTING\_OFFSETS\_TIMESTAMP**: 指定起始点位的时间戳。
* **ENDING\_OFFSETS\_TIMESTAMP**: 指定结束点位的时间戳。
* **KEY\_FORMAT**:指定读取key的格式,类型是STRING类型忽略大小写。目前只支持raw格式
* **VALUE\_FORMAT**：指定读取value的格式，类型是STRING类型忽略大小写。目前只支持raw格式
* **MAX\_ERROR\_NUMBER**：读取窗口内，允许的最大错误行数。必须大于等于0。默认是 0，即不允许有错误行，取值范围0-100000
* **MAP**()：需要传入到Kafka的参数，以kafka.开头，直接使用kafka的参数即可,可以在Kafka中找到这种选项。,格式如MAP('kafka.security.protocol', 'PLAINTEXT')，取值参考，[kafka文档](https://kafka.apache.org/documentation/#consumerconfigs)

`read_kafka` 结果返回值：

|                 |                     |                      |
| --------------- | ------------------- | -------------------- |
| 字段            | 含义                | 类型                 |
| topic           | Kafka主题名称       | STRING               |
| partition       | 数据分区ID          | INT                  |
| offset          | Kafka分区中的偏移量 | BIGINT               |
| timestamp       | Kafka消息时间戳     | TIMESTAMP\_LTZ       |
| timestamp\_type | Kafka消息时间戳类型 | STRING               |
| headers         | Kafka消息头         | MAP\<STRING, BINARY> |
| key             | Kafka的key值        | BINARY               |
| value           | Kafka的value值      | BINARY               |

**注意事项**

* 使用read\_kafka时请确保和Lakehouse网络打通

**具体案例**

```SQL
-- 读取指定时间范围内的数据
SELECT 
    topic, 
    partition, 
    offset, 
    timestamp,
    CAST(key AS STRING) AS key_str,
    CAST(value AS STRING) AS value_str
FROM READ_KAFKA(
    'kafka-broker:9092',
    'order_events',
    '',
    'temp_analysis_group',
    'earliest',                               -- 从最早开始
    'latest',                                 -- 读取到最新
    '1640995200000',                          -- 2022-01-01 00:00:00
    '1641081600000',                          -- 2022-01-02 00:00:00
    'raw',
    'raw',
     0,
MAP() 

)
LIMIT 10；
```

^
