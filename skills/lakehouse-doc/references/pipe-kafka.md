# 使用Pipe自动采集Kafka数据

## 概述

Pipe 是 Lakehouse 提供的**持续数据摄取**解决方案，专门用于从 Kafka 自动、持续地将数据导入到 Lakehouse 表中。Pipe 会创建持久的消费者组，保持消费位置，并按照设定的调度策略持续运行。

## Kafka Pipe语法

```SQL
-- 从Kafka创建Pipe的语法
CREATE PIPE [ IF NOT EXISTS ] <pipe_name>
    VIRTUAL_CLUSTER = 'virtual_cluster_name'
    [INITIAL_DELAY_IN_SECONDS='']
    [BATCH_INTERVAL_IN_SECONDS='']
    [BATCH_SIZE_PER_KAFKA_PARTITION='']
    [MAX_SKIP_BATCH_COUNT_ON_ERROR='']
    [RESET_KAFKA_GROUP_OFFSETS='']
    [COPY_JOB_HINT='']
AS <copy_statement>;
```

* `<pipe_name>`：Pipe 对象的名称，用于管理和监控
* `VIRTUAL_CLUSTER`：指定执行 Pipe 任务的虚拟集群名称
* `INITIAL_DELAY_IN_SECONDS`:首个作业调度延迟，选填项（默认 0 秒）
* `BATCH_INTERVAL_IN_SECONDS`：（可选）设置批处理间隔时间，默认值为60秒。
* `BATCH_SIZE_PER_KAFKA_PARTITION`：（可选）设置每个Kafka分区的批处理大小，默认值为500,000条。
* `MAX_SKIP_BATCH_COUNT_ON_ERROR`：（可选）设置在出错时跳过的批次的最大重试次数，默认值为30。
* `RESET_KAFKA_GROUP_OFFSETS`：（可选）控制 Pipe 启动时从 Kafka 的哪个位置开始消费数据只支持启动时设置，如果不设置此参数且消费者组无历史位置信息，将使用 Kafka 的 [auto.offset.reset](https://kafka.apache.org/documentation/#consumerconfigs_auto.offset.reset) 配置（默认为 `latest`）。支持的可选值如下
  * 'none'无操作，如果设置为none则会使用[auto.offset.reset](https://kafka.apache.org/documentation/#consumerconfigs_auto.offset.reset)
  * 'valid' 检查 group 中的当前点位是否过期，将过期的 partition 点位重置到当前的 earliest
  * 'earliest' 重置到当前 earliest
  * 'latest' 重置到当前 latest
  * '${TIMESTAMP\_MILLISECONDS}' 重置到毫秒时间戳对应点位，如 '1737789688000'（2025-01-25 15:21:28）

## 在 Pipe 中使用 READ\_KAFKA

如果您想临时探查则可以使READ_KAFKA函数参考文档[READ_KAFKA函数](<sql_functions/table_functions/read_kafka.md>)，在 Pipe 的 COPY 语句中使用 `READ_KAFKA` 时，有以下**重要差异**：

### 参数传递规则

```sql
-- Pipe 中的 READ_KAFKA 语法
read_kafka (
    'bootstrap_servers',     -- 必填：Kafka 集群地址
    'topic',                 -- 必填：Topic 名称
    '',                      -- 必填：Topic 模式（暂不支持，填空字符串）
    'group_id',              -- 必填：持久消费者组 ID
    '',                      -- 留空：起始位置由 Pipe 自动管理
    '',                      -- 留空：结束位置由 Pipe 自动管理  
    '',                      -- 留空：起始时间戳由 Pipe 自动管理
    '',                      -- 留空：结束时间戳由 Pipe 自动管理
    'raw',                   -- Key 格式
    'raw',                   -- Value 格式
    0,                       -- 最大错误数
    map()                    -- Kafka 配置参数
)
```
### 关键区别

| 特性     | READ\_KAFKA 函数（独立使用）     | READ\_KAFKA（在 Pipe 中） |
| ------ | ------------------------ | --------------------- |
| 消费者组   | 临时，执行完即销毁                | 持久，保持消费位置状态           |
| 位置管理   | 手动指定 starting\_offsets 等 | Pipe 自动管理，位置参数必须留空    |
| 执行方式   | 一次性查询                    | 持续调度执行                |
| 默认起始位置 | earliest（探查历史数据）         | latest（处理新数据）         |

### 最佳实践
参考使用 [Pipe 高效接入 kafka 数据](<pipe-kafka-bestpractice-1.md>)

## 使用实例

```SQL
/*使用Lakehouse Pipe任务对象持续导入Kafka数据到目标表*/
---Step01: 创建Kafka写入的目标表
create table kafka_raw(value string);

---Step02: 创建PIPE任务，从Kafka读取并写入目标表
CREATE PIPE  load_kafka01
VIRTUAL_CLUSTER = 'DEFAULT' 
BATCH_INTERVAL_IN_SECONDS = '10'
AS
COPY INTO kafka_raw
FROM (
        SELECT
                CAST(value AS string) as value
        FROM 
        read_kafka (
        'host01:9092,host02:9092,host03:9092',-- bootstrap
        'test',-- topic name
        '', -- topic prefix 暂不支持
        'pipe_kafka_group',-- group id
        '',-- 点位相关参数，在 pipe ddl 中留空
        '',-- 点位相关参数，在 pipe ddl 中留空
        '',-- 点位相关参数，在 pipe ddl 中留空
        '',-- 点位相关参数，在 pipe ddl 中留空
        'raw',-- key  的 format，目前只支持 binary
        'raw',-- value 的 format，目前只支持 binary
        0,
        map()
        )
);
---Step03：查看与管理PIPE对象
--查看pipe列表
show pipes;

pipe_name    copy_statement                                                                                                                                                                                                                                                                                                                                                                                                                                                                         
-----             ------ 
load_kafka01 COPY INTO TABLE ur_ws.public.kafka_raw FROM (SELECT CAST(read_kafka.`value` AS string) AS `value` FROM READ_KAFKA('host01:9092,host02:9092,host03:9092', 'mytopic', '', 'pipe_kafka_group', '', '', '', '', 'raw', 'raw', 0) read_kafka) 

--查看pipe对象详情
desc pipe load_kafka01;
info_name          info_value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             
--                        ------- 
name               load_kafka01                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           
creator            czuser                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 
created_time       2024-06-08 23:11:16.079                                                                                                                                                                                                                                                                                                                                                                                                                                                                                
last_modified_time 2024-06-08 23:11:16.079                                                                                                                                                                                                                                                                                                                                                                                                                                                                                
comment            my first pipe                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          
properties         ((batch_interval_in_seconds,10),(virtual_cluster,DEFAULT))                                                                                                                                                                                                                                                                                                                                                                                                                                             
copy_statement     COPY INTO TABLE ql_ws.rc5_l.kafka_raw FROM (SELECT CAST(read_kafka.`value` AS string) AS `value` FROM READ_KAFKA('host01:9092,host02:9092,host03:9092', 'mytopic', '', 'pipe_kafka_group', '', '', '', '', 'raw', 'raw', 0) read_kafka)                 
copy_template      PCF1______::COPY INTO TABLE ql_ws.rc5_l.kafka_raw FROM (SELECT CAST(read_kafka.`value` AS string) AS `value` FROM READ_KAFKA('host01:9092,host02:9092,host03:9092', 'mytopic', '', 'pipe_kafka_group', PCF1______, '', '', 'raw', 'raw', 0) read_kafka) 
pipe_status        PTS_RUNNING                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            
invalid_reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            

--查看导入数据
SELECT * FROM kafka_raw LIMIT 100;

--删除PIPE任务对象
DROP PIPE load_kafka01;
```



## 状态监控与管理

### 查看Kafka消费延迟

通过 DESC PIPE 命令。如下面的pipe\_latency中的json字符串。
\- lastConsumeTimestamp：上一次消费的点位
\- offsetLag：Kafka数据得堆积量
\- timeLag：消费延迟，计算为当前时间减去上一次消费的点位。当Kafka消费异常时值为-1

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

由于每次都是Pipe下发copy执行，你可以在作业历史中查看所有操作。通过[作业历史](web-job-history.md)中的query\_tag来筛选，所有的pipe执行的copy作业都会在query\_tag打上标签，格式为`pipe.``workspace_name``.schema_name.pipe_name`，方便追踪和管理。

### 停止和启动Pipe

* 暂停Pipe

```
ALTER PIPE pipe_name SET PIPE_EXECUTION_PAUSED = true;
```

* 启动Pipe

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

* 不支持修改 COPY 语句逻辑，如果您需要修改，请删除 Pipe 后重新创建。
* 当你修改 Pipe 的 `COPY_JOB_HINT` 时，新的设置会覆盖原有的 hints。因此，如果你的 Pipe 中已经存在某些 hints，例如 `{"cz.sql.split.kafka.strategy":"size"}`，当你再次添加新的 hints 时，必须将所有需要的 hints 一起设置，否则原有的 hints 会被新设置的 hints 覆盖。多个参数之间使用逗号分隔


