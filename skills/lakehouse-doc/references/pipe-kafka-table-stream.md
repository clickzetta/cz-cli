# 使用 Table Stream 和 Pipe 将 Kafka 数据导入 Lakehouse

## 一、背景介绍

在大数据处理领域，将 Kafka 中的流数据高效地导入 Lakehouse（数据湖仓）是一个常见的需求。云器科技提供了强大的 Table Stream 和 Pipe 功能，使得这一过程变得更加简便和高效。本文将详细介绍如何使用 Table Stream 和 Pipe 将 Kafka 数据导入 Lakehouse，包括创建 Kafka 外部表和 Kafka Table Stream 的完整过程。

## 二、操作步骤

### 创建 Kafka 外部表

在使用 Table Stream 和 Pipe 之前，我们需要先创建一个与[ Kafka 集成的外部表](create-kafka-external.md)，用于访问 Kafka 中的数据。

```sql
CREATE STORAGE CONNECTION pipe_kafka
 TYPE kafka 
BOOTSTRAP_SERVERS = ['47.00.08.62:9092'] 
SECURITY_PROTOCOL = 'PLAINTEXT';

CREATE EXTERNAL TABLE external_table_kafka (   
 key_column binary,   
 value_column binary NOT NULL)
USING kafka
OPTIONS (   'group_id' = 'external_table_lh',    'topics' = 'my_topic')
CONNECTION pipe_kafka;
```



### 创建 Table Stream

在 Kafka 外部表上[创建一个 Table Stream](create-table-stream.md)，以便能够实时地捕获 Kafka 中的数据变化。

```sql
CREATE TABLE STREAM kafka_table_stream_pipe1 
ON TABLE external_table_kafka
WITH PROPERTIES (
    'table_stream_mode' = 'append_only'

);
```

* `kafka_table_stream_pipe1`：Table Stream 的名称。
* `ON TABLE external_table_kafka`：指定基于之前创建的 Kafka 外部表创建 Table Stream。
* `table_stream_mode='append_only'`：指定 Table Stream 的模式为仅追加，意味着只会捕获新增的数据行。



创建完成后，可以通过以下查询来验证 Table Stream 中的数据：

```sql
SELECT CAST(value AS STRING) FROM kafka_table_stream_pipe1;
```

此查询将 Table Stream 中的 `value` 字段转换为字符串类型并返回，方便后续处理。

### 创建目标表

接下来，我们需要创建一个目标表，用于存储从 Kafka 导入的数据。

```sql
CREATE TABLE kafka_sink_table_1 (
    a TIMESTAMP,
    b STRING
);
```

* `kafka_sink_table_1`：目标表的名称。
* `a TIMESTAMP`：第一个字段，用于存储时间戳类型的数据。
* `b STRING`：第二个字段，用于存储字符串类型的数据。

### 创建 Pipe

最后，使用 Pipe 将 Table Stream 中的数据持续导入到目标表中。

```sql
CREATE PIPE kafka_pipe_stream
VIRTUAL_CLUSTER = 'test_alter'
AS
COPY INTO kafka_sink_table_1
FROM (
    SELECT CURRENT_TIMESTAMP(), CAST(value AS STRING) FROM kafka_table_stream_pipe1
);
```

* `kafka_pipe_stream`：Pipe 的名称。
* `VIRTUAL_CLUSTER = 'test_alter'`：指定使用的虚拟集群为 名称，
* `COPY INTO kafka_sink_table_1`：将数据复制到目标表 `kafka_sink_table_1` 中。
* `SELECT CURRENT_TIMESTAMP(), CAST(value AS STRING) FROM kafka_table_stream_pipe1`：从 Table Stream 中选择数据，将当前时间戳和转换为字符串的 `value` 字段作为目标表的两列数据。

其他可设置的属性
- `INITIAL_DELAY_IN_SECONDS`:首个作业调度延迟，选填项（默认 0 秒）
- `BATCH_INTERVAL_IN_SECONDS`：（可选）设置批处理间隔时间，默认值为60秒。
- `BATCH_SIZE_PER_KAFKA_PARTITION`：（可选）设置每个Kafka分区的批处理大小，默认值为500,000条。
- `MAX_SKIP_BATCH_COUNT_ON_ERROR`：（可选）设置在出错时跳过的批次的最大重试次数，默认值为30。
- `RESET_KAFKA_GROUP_OFFSETS`：（可选）设置启动pipe时Kafka的初始点位,不支持修改。可选值为`latest`、`earliest`、`none`、`valid`、`${TIMESTAMP\_MILLISECONDS}`
    - 'none' 默认无操作
    - 'valid' 检查 group 中的当前点位是否过期，将过期的 partition 点位重置到当前的 earliest 
    - 'earliest' 重置到当前 earliest
    - 'latest' 重置到当前 latest    
    - '${TIMESTAMP\_MILLISECONDS}' 重置到毫秒时间戳对应点位，如 '1737789688000'（2025-01-25 15:21:28）

## 三、验证结果

可以通过查询目标表来验证数据是否成功导入：

```sql
SELECT * FROM kafka_sink_table_1;
```

同时，可以查看 Pipe 的运行状态，确保其正常工作：

```sql
SHOW PIPES;
```

此命令将列出所有已创建的 Pipe 及其状态信息，包括是否在运行、上次运行时间等。
## 四、状态监控与管理
### 查看Kafka消费延迟
通过 DESC PIPE 命令。如下面的pipe_latency中的json字符串。
    - lastConsumeTimestamp：上一次消费的点位
    - offsetLag：Kafka数据得堆积量
    - timeLag：消费延迟，计算为当前时间减去上一次消费的点位。当Kafka消费异常时值为-1


````
DESC PIPE EXTENDED kafka_pipe_stream
+--------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
|     info_name      |                                                                                                               info_value                                                            |
+--------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| name               | kafka_pipe_stream                                                                                                                                                                   |
| creator            | UAT_TEST                                                                                                                                                                            |
| created_time       | 2025-03-05 10:40:55.405                                                                                                                                                             |
| last_modified_time | 2025-03-05 10:40:55.405                                                                                                                                                             |
| comment            |                                                                                                                                                                                     |
| properties         | ((virtual_cluster,test_alter))                                                                                                                                                      |
| copy_statement     | COPY INTO TABLE qingyun.pipe_schema.kafka_sink_table_1 FROM (SELECT `current_timestamp`() AS ```current_timestamp``()`, CAST(kafka_table_stream_pipe1.`value` AS string) AS `value` |
| pipe_status        | RUNNING                                                                                                                                                                             |
| output_name        | xxxxxxx.pipe_schema.kafka_sink_table_1                                                                                                                                              |
| input_name         | kafka_table_stream:xxxxxxx.pipe_schema.kafka_table_stream_pipe1                                                                                                                     |
| invalid_reason     |                                                                                                                                                                                     |
| pipe_latency       | {"kafka":{"lags":{"0":0,"1":0,"2":0,"3":0},"lastConsumeTimestamp":-1,"offsetLag":0,"timeLag":-1}}                                                                                   |
+--------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+

````

### 查看Pipe运行历史
由于每次都是Pipe下发copy执行，你可以在作业历史中查看所有操作。通过[作业历史](<web-job-history.md>)中的query_tag来筛选，所有的pipe执行的copy作业都会在query_tag打上标签，格式为`pipe.``workspace_name``.schema_name.pipe_name`，方便追踪和管理。

### 停止和启动Pipe
- 暂停Pipe
```
ALTER PIPE pipe_name SET PIPE_EXECUTION_PAUSED = true;
```
- 启动Pipe
```
ALTER PIPE pipe_name SET PIPE_EXECUTION_PAUSED = false;
```

### 修改Pipe属性
您可以修改 PIPE 的属性，但每次只能修改一个属性。如果需要修改多个属性，则需要多次执行 `ALTER` 命令。以下是可修改的属性及其语法：

```SQL
ALTER PIPE pipe_name SET 
    [VIRTUAL_CLUSTER = 'virtual_cluster_name'],
    [BATCH_INTERVAL_IN_SECONDS=''],
    [BATCH_SIZE_PER_KAFKA_PARTITION=''],
    [MAX_SKIP_BATCH_COUNT_ON_ERROR=''],
    [COPY_JOB_HINT='']
```
案例
```
--修改计算集群
ALTER PIPE pipe_name SET VIRTUAL_CLUSTER = 'default'
--设置COPY_JOB_HINT
ALTER PIPE pipe_name SET COPY_JOB_HINT='{"cz.mapper.kafka.message.size": "2000000"}'

```
**注意**
- 不支持修改COPY语句逻辑，如果您需要修改请删除Pipe重新创建
- 当你修改 Pipe 的 `COPY_JOB_HINT` 时，新的设置会覆盖原有的 hints。因此，如果你的 Pipe 中已经存在某些 hints，例如 `{"cz.sql.split.kafka.strategy":"size"}`，当你再次添加新的 hints 时，必须将所有需要的 hints 一起设置，否则原有的 hints 会被新设置的 hints 覆盖。多个参数之间使用逗号分隔
