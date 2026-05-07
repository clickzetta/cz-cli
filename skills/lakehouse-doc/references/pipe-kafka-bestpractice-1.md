# 最佳实践：使用 Pipe 高效接入 kafka 数据
# 快速验证 kafka 参数

在云器 Lakehouse 中，使用 Kafka pipe 可以非常容易构建分钟级近实时数据集成链路。在开始之前，需要确认三件事：

1. 网络连通性
2. Kafka bootstrap 地址、端口和 topic
3. （可选）认证方式及相关参数

上述目的可以通过直接运行形如 `select * from read_kafka()` 查询的方式来快速验证。

这里是一个无认证的 kafka 接入样例：

```SQL
SELECT *
FROM read_kafka(
  'kafka-bootstrap-1:9092,kafka-bootstrap-2:9092,kafka-bootstrap-3:9092', -- bootstrap
  'topic-name',   -- topic
  '',             -- reserved
  'test',         -- kafka group id, for keeping read position
  '', '', '', '', -- reserved
  'raw',          -- key format, can only be raw
  'raw',          -- value format, can only be raw
  0,
  MAP(
    'kafka.security.protocol','PLAINTEXT',
    'kafka.auto.offset.reset','latest'
  )
)
LIMIT 10;
```

> read\_kafka 函数参数众多，但是实际需要填写的只有 bootstrap 地址、topic 和 group id。探查阶段我们使用 test 作为 group id

这是一个读取 SASL\_PLAINTEXT 认证方式的样例（pipe 仅支持 PLAINTEXT 和 SASL\_PLAINTEXT）：

```SQL
SELECT *
FROM read_kafka(
  'kafka-bootstrap-1:9092,kafka-bootstrap-2:9092,kafka-bootstrap-3:9092', -- bootstrap
  'topic-name',   -- topic
  '',             -- reserved
  'test',         -- kafka group id, for keeping read position
  '', '', '', '', -- reserved
  'raw',          -- key format, can only be raw
  'raw',          -- value format, can only be raw
  0,
  MAP(
    'kafka.security.protocol','SASL_PLAINTEXT',
    'kafka.sasl.mechanism','PLAIN',
    'kafka.sasl.username','<username>',
    'kafka.sasl.password','<password>',
    'kafka.auto.offset.reset','latest'
  )
)
LIMIT 10;
```

如果参数配置无误，执行上述 SQL 将获得 10 行样例数据

![](/.topwrite/assets/image_1760681545512.png)

# 小批量读取数据确认 schema 并创建目标表

kafka 数据中的 key 和 value 都是 binary 类型。通常我们更关心的是 value 的内容。如果其中本来存放就是字符串，可以在 select 的时候 cast 成 string 来快速探查其中内容。

```sql
SELECT key::string, value::string
FROM read_kafka(
  'kafka-bootstrap-1:9092,kafka-bootstrap-2:9092,kafka-bootstrap-3:9092', -- bootstrap
  'topic-name',   -- topic
  '',             -- reserved
  'test',         -- kafka group id, for keeping read position
  '', '', '', '', -- reserved
  'raw',          -- key format, can only be raw
  'raw',          -- value format, can only be raw
  0,
  MAP(
    'kafka.security.protocol','PLAINTEXT',
    'kafka.auto.offset.reset','latest'
  )
)
LIMIT 10;
```

![](/.topwrite/assets/image_1760681595348.png)

点击「复制」获取样例数据并探查，可见 value 大体是个 JSON，但是 JSON 中有些 string field 还是个完整的 JSON，看起来还不止一层，结构略复杂：

```JSON
{"event":"{\"instance_id\":1,\"workspace_id\":1057330101457946860,\"session_id\":0,\"job_id\":\"\",\"log_id\":8316782525667550489,\"operator_id\":0,\"operator_type\":\"PT_USER\",\"start_time\":1740590015608,\"end_time\":1740590015608,\"state\":1,\"properties\":\"[]\",\"statements\":\"{\\\"statements\\\":[{\\\"identifier\\\":{\\\"type\\\":\\\"VIRTUAL_CLUSTER\\\",\\\"instanceId\\\":\\\"1\\\",\\\"namespace\\\":[\\\"system_automv_warehouse\\\"],\\\"namespaceId\\\":[\\\"1057330101457946860\\\"],\\\"namespaceType\\\":[],\\\"name\\\":\\\"CZ_MV_DEFAULT\\\",\\\"id\\\":\\\"8013167251718801474\\\",\\\"version\\\":\\\"default_v2\\\",\\\"instanceName\\\":\\\"clickzetta\\\",\\\"accountId\\\":\\\"1\\\",\\\"accountName\\\":\\\"rwyaytaa\\\"},\\\"operations\\\":[{\\\"lsn\\\":0,\\\"type\\\":\\\"ALTER\\\",\\\"alterEntity\\\":{\\\"ifExists\\\":false,\\\"identifier\\\":{\\\"type\\\":\\\"VIRTUAL_CLUSTER\\\",\\\"instanceId\\\":\\\"1\\\",\\\"namespace\\\":[\\\"system_automv_warehouse\\\"],\\\"namespaceId\\\":[\\\"1057330101457946860\\\"],\\\"namespaceType\\\":[],\\\"name\\\":\\\"CZ_MV_DEFAULT\\\",\\\"id\\\":\\\"8013167251718801474\\\",\\\"version\\\":\\\"default_v2\\\",\\\"instanceName\\\":\\\"clickzetta\\\",\\\"accountId\\\":\\\"1\\\",\\\"accountName\\\":\\\"rwyaytaa\\\"},\\\"changeComment\\\":false,\\\"entity\\\":{\\\"identifier\\\":{\\\"type\\\":\\\"VIRTUAL_CLUSTER\\\",\\\"instanceId\\\":\\\"1\\\",\\\"namespace\\\":[\\\"system_automv_warehouse\\\"],\\\"namespaceId\\\":[\\\"1057330101457946860\\\"],\\\"namespaceType\\\":[],\\\"name\\\":\\\"CZ_MV_DEFAULT\\\",\\\"id\\\":\\\"8013167251718801474\\\",\\\"version\\\":\\\"\\\",\\\"instanceName\\\":\\\"clickzetta\\\",\\\"accountId\\\":\\\"1\\\",\\\"accountName\\\":\\\"rwyaytaa\\\"},\\\"creator\\\":\\\"101\\\",\\\"creatorType\\\":\\\"PT_USER\\\",\\\"properties\\\":[],\\\"createTime\\\":\\\"1698056353612\\\",\\\"lastModifyTime\\\":\\\"1740590015607\\\",\\\"state\\\":\\\"ONLINE\\\",\\\"category\\\":\\\"MANAGED\\\",\\\"basicSpecId\\\":0,\\\"flags\\\":\\\"0\\\",\\\"virtualCluster\\\":{\\\"clusterType\\\":\\\"GENERAL\\\",\\\"tag\\\":{},\\\"clusterSize\\\":\\\"SMALL\\\",\\\"autoStopLatencySec\\\":1,\\\"autoStartEnabled\\\":true,\\\"queryProcessTimeLimitSec\\\":259200,\\\"state\\\":\\\"RESUMING\\\",\\\"preState\\\":\\\"SUSPENDED\\\",\\\"errorMsg\\\":\\\"\\\",\\\"workspaceId\\\":\\\"1057330101457946860\\\",\\\"vcId\\\":\\\"8013167251718801474\\\",\\\"stateInfo\\\":\\\"{\\\\\\\"resourceVersion\\\\\\\":\\\\\\\"1740590006831\\\\\\\",\\\\\\\"resumeTaskState\\\\\\\":\\\\\\\"true\\\\\\\"}\\\",\\\"version\\\":\\\"default_v2\\\",\\\"computePoolId\\\":\\\"0\\\",\\\"deployMode\\\":\\\"SERVERLESS\\\"},\\\"comment\\\":\\\"\\\"},\\\"alterProperty\\\":[]}}]}]}\",\"sub_type\":\"\"}","op_type":"CREATE","datasource_id":"17319","database_name":"lakehouse_hz_uat_bak","schema_name":"lakehouse_hz_uat_bak","table_name":"cz_commit_logs_vc","event_ts":1740590015000,"event_seq":"3521832368","server_ts":1740590015924,"server_seq":138789}
```

调整 select 语句，使用 parse\_json 将 value 字段和其中的 event 展开：

```SQL
SELECT
    parse_json(j['event']::string) as event,
    j['op_type']::string as op_type,
    j['datasource_id']::string as datasource_id,
    j['database_name']::string as database_name,
    j['schema_name']::string as schema_name,
    j['table_name']::string as table_name,
    timestamp_millis(j['event_ts']::bigint) as event_ts,
    j['event_seq']::string as event_seq,
    timestamp_millis(j['server_ts']::bigint) as server_ts,
    j['server_seq']::bigint as server_seq
FROM (
    SELECT parse_json(value::string) as j
    FROM read_kafka(
    'kafka-bootstrap-1:9092,kafka-bootstrap-2:9092,kafka-bootstrap-3:9092', -- bootstrap
    'topic_name',   -- topic
    '',             -- reserved
    'test',         -- kafka group id, for keeping read position
    '', '', '', '', -- reserved
    'raw',          -- key format, can only be raw
    'raw',          -- value format, can only be raw
    0,
    MAP(
        'kafka.security.protocol','PLAINTEXT',
        'kafka.auto.offset.reset','latest'
    )
    )
    LIMIT 10
);

```

运行发现 event 中的 statements 仍然是 JSON。

![](/.topwrite/assets/image_1760681703861.png)

继续调整 select 语句，直到将所有内容为 JSON 的字符串 parse 完毕再落表，避免后续查询重复计算 parse\_json。

```SQL
SELECT
    parse_json(j['event']::string) as event,
    parse_json(parse_json(j['event']::string)['statements']::string) as statements,
    j['op_type']::string as op_type,
    j['datasource_id']::string as datasource_id,
    j['database_name']::string as database_name,
    j['schema_name']::string as schema_name,
    j['table_name']::string as table_name,
    timestamp_millis(j['event_ts']::bigint) as event_ts,
    j['event_seq']::string as event_seq,
    timestamp_millis(j['server_ts']::bigint) as server_ts,
    j['server_seq']::bigint as server_seq
FROM (
    SELECT parse_json(value::string) as j
    FROM read_kafka(
    'kafka-bootstrap-1:9092,kafka-bootstrap-2:9092,kafka-bootstrap-3:9092', -- bootstrap
    'topic_name',   -- topic
    '',             -- reserved
    'test',         -- kafka group id, for keeping read position
    '', '', '', '', -- reserved
    'raw',          -- key format, can only be raw
    'raw',          -- value format, can only be raw
    0,
    MAP(
        'kafka.security.protocol','PLAINTEXT',
        'kafka.auto.offset.reset','latest'
    )
    )
    LIMIT 10
);
```

根据 select 的探查结果，确定目标表结构，并建表：

```SQL
CREATE TABLE ods_commit_log (
    event json,
    statements json,
    op_type string,
    datasource_id string,
    database_name string,
    schema_name string,
    table_name string,
    event_ts timestamp,
    event_seq string,
    server_ts timestamp,
    server_seq bigint,
    __kafka_timestamp__ timestamp,
    pt_date string generated always as (date_format(`server_ts`, 'yyyyMMdd')) stored
) PARTITIONED BY (pt_date)
PROPERTIES(
    'data_lifecycle'='14'
); 
```

> 通常 kafka 流入的数据以 append only 的日志表居多，因此基于业务时间戳 server\_ts 增加了自动生成列 pt\_date 作为分区列，并配合 table properties 中的 data\_lifecycle 来对表数据量进行控制

> 表 DDL 中增加了 \_\_kafka\_timestamp\_\_ 字段，记录数据流过 kafka 的时间，这列在业务上鲜有价值，但是可以在数据延迟发生时用于原因诊断，我们建议保留

至此，我们已经完成了 kafka 数据和目标表结构的对齐。

# 正式创建 Pipe

接下来，从已有的探查 select 语句作为基础，构建 Pipe DDL。Pipe 对实际上是对 `COPY INTO <table> FROM (SELECT ... FROM READ_KAFKA(...))` 的封装，同时增加指定计算资源、调度频率等工程参数。

考虑到 Kafka 数据通常为流式进入，如果我们需要目标表的新鲜度为 1 分钟，即 pipe 每 60 秒调度一个 `COPY INTO` 作业，那么建议给 pipe 划分一个专用的 GP 集群。

```sql
CREATE VCLUSTER pipe_ods_commit_log 
    VCLUSTER_TYPE = GENERAL 
    VCLUSTER_SIZE = 1
;
```

>先不用纠结这个 GP vcluster 的大小，我们可以在后续的调整阶段根据作业实际执行情况再作调整。

>单独划分集群的原因之一是过高的数据新鲜度（比如小于 5 分钟）会使集群几乎没有空闲的可能，成为事实上的常驻资源消耗。因此通常不应该把 pipe 跑在很大的集群上导致资源浪费。但是反过来看，如果 kafka 流入的数据量较小，也没有必要给每个 pipe 都划分单独的集群。此时可以使一系列 pipe 共享一个常驻集群以节省资源。

Pipe DDL 如下:

1. 去掉 `select ... from read_kafka(...)` 字句里的 `limit 10`
2. group id 从 test 更换为线上准备正式使用的名字，如 sub2cz
3. （可选）使用 RESET\_KAFKA\_GROUP\_OFFSETS 参数指定读取 kafka 的时间点（否则会按照 kafka.auto.offset.reset 的设置从 latest 读起），需要使用毫秒单位的 epoch。

```sql
CREATE PIPE pipe_ods_commit_log 
    VIRTUAL_CLUSTER = 'pipe_ods_commit_log' 
    BATCH_INTERVAL_IN_SECONDS = '60'
    RESET_KAFKA_GROUP_OFFSETS = '1740931200000' -- epoch in millis of 2025-03-03 00:00:00
AS COPY INTO ods_commit_log FROM (
SELECT
    parse_json(j['event']::string) as event,
    parse_json(parse_json(j['event']::string)['statements']::string) as statements,
    j['op_type']::string as op_type,
    j['datasource_id']::string as datasource_id,
    j['database_name']::string as database_name,
    j['schema_name']::string as schema_name,
    j['table_name']::string as table_name,
    timestamp_millis(j['event_ts']::bigint) as event_ts,
    j['event_seq']::string as event_seq,
    timestamp_millis(j['server_ts']::bigint) as server_ts,
    j['server_seq']::bigint as server_seq,
    `timestamp` as __kafka_timestamp__
FROM (
    SELECT `timestamp`, parse_json(value::string) as j
    FROM read_kafka(
    'kafka-bootstrap-1:9092,kafka-bootstrap-2:9092,kafka-bootstrap-3:9092', -- bootstrap
    'topic_name',   -- topic
    '',             -- reserved
    'sub2cz',       -- kafka group id, for keeping read position
    '', '', '', '', -- reserved
    'raw',          -- key format, can only be raw
    'raw',          -- value format, can only be raw
    0,
    MAP(
        'kafka.security.protocol','PLAINTEXT',
        'cz.kafka.fetch.retry.enable','true', 
        'cz.kafka.fetch.retry.times','20',
        'cz.kafka.fetch.retry.intervalMs','2000'
    )
)));
```

>这里我们在 read\_kafka 的参数中补充了 cz.kafka.fetch.retry.enable、cz.kafka.fetch.retry.times、cz.kafka.fetch.retry.intervalMs 三个参数，指定函数在遇到读 kafka 失败时的重试策略。这样有助于减少生产作业的告警和人工介入次数。

Pipe 创建后，会自动开始运行。在 Studio 依次点击「计算」-「集群」-「PIPE\_ODS\_COMMIT\_LOG」-「作业」，我们可以通过这个页面快速检查由 pipe 提交作业的运行情况。

当多个 pipe 复用一个 VCluster 时，也可以用 query\_tag 在 studio 的「计算」-「作业历史」页面或 InformationSchema 的 job\_history 表快速查询指定 pipe 的作业运行情况。由 pipe 提交的作业，其 query\_tag 为 pipe.\<workspace\_name>.\<schema\_name>.\<pipe\_name> 的形式：

```sql
select query_tag, job_id, status, start_time, end_time, execution_time, input_bytes, output_bytes, rows_produced
from information_schema.job_history
where pt_date>='yyyy-MM-dd' -- eg. 2025-03-03
and query_tag = 'pipe.<workspace_name>.<schema_name>.<pipe_name>' -- eg. 'pipe.quick_start.public.pipe_ods_commit_log'
order by start_time desc;
```

# 大数据量及资源调优

优化 Kafka pipe 在生产环境稳定运行，就是在数据新鲜度要求的周期内（BATCH\_INTERVAL\_IN\_SECONDS ），用最小的资源配置（VCluster），恰好完成流入数据的计算和落盘（生产中应保留一定算力冗余，以确保在数据量波动、集群升级作业 failover 等情况发生时，pipe 能够较快追平数据，通常建议保留一倍的冗余度）。用本文的例子通俗的讲，就是至少要能够在 30 秒左右，处理完这 1 分钟由 kafka 流入的数据。

Pipe 的默认设置在大多数情况下工作良好。但如果接入的 kafka 数据量特别大，则应根据实际情况调整参数，如下图红色文字标注部分：

![](/.topwrite/assets/image_1760681949544.png)



确认当前的 pipe 是否积压，可以通过多次执行`desc pipe extended` 查看 pipe\_latency 行的 timeLag（kafka 点位和当前时间的差距，单位毫秒）是否在持续增加。当数据新鲜度为 60 秒，且算力冗余为一倍时，timeLag 应该在0\~90 秒之间波动（如果完全不做冗余，波动应该在 0\~120 秒之间），当 timeLag 会超过上限且在几个周期之后持续上涨，则 pipe 会产生积压。

## 确认 kafka 的消息峰值（增大 `BATCH_SIZE_PER_KAFKA_PARTITION` 参数）

为了防止 pipe 在启动时读取过多数据导致作业超大作业出现，pipe 会限制每次从 partition 中读取的数据条数，通过 `BATCH_SIZE_PER_KAFKA_PARTITION` 控制，默认 50000。当 kafka 每周期每 partition 的消息峰值超过此值时，应该在 CREATE PIPE 时人工指定该参数。通常建议设置该值为峰值的 2 倍。当 pipe 已经在运行中，也可以通过`alter pipe <pipe_name> set BATCH_SIZE_PER_KAFKA_PARTITION=<event_number>;` 来动态调整该值。

如图所示，虽然 pipe 的分钟作业只要不到 30 秒即可执行完成，但此时 desc pipe extended 指示 timeTag 可能在持续增大。

![](/.topwrite/assets/image_1760681973997.png)

点击作业进入作业详情页，可以看到这是一个 10 个 partition 的 kafka topic。即使设置 BATCH\_SIZE\_PER\_KAFKA\_PARTITION 为 100000，然没有完整读取一个周期所有数据，需要继续增大。

![](/.topwrite/assets/image_1760681981294.png)

最终，通过不断增大该值并持续观察 timeLag（生产使用时通常应该预先知晓 kafka per partition 的峰值，直接设置就好），确定该值为 500000 时，pipe 的消费速度较快可以追平 kafka。

>与直接 `select ... read_kafka(...)` 不同，通过 pipe 生成的 `copy into`作业，可以看到由 pipe 管理的，记录在 kafka group id 中的点位信息，很容易识别读取的 kafka topic 有多少个 partition，以及各个 partition 的实际点位值。

## 调整 VCluster Size

默认情况下，Pipe 启动的 `copy into` 作业，task 数量和 kafka topic partition 数量一致，即每个 task 读取一个 partition。当 VCluster Size 较小时，作业的 task 可能需要多轮才能完全运行结束，从而显著拉长作业运行时间。

因此，当需要作业尽快结束时，应保证 VCluster 的允许的 task 并发度 >= partition 数，使所有 task 一轮运行完。

下图一个使用 128CRU VCluster（1024core）的 pipe 作业，消费 1200 个 partition 的 kafka topic， 需要运行两轮，第一轮 1024 个 task，剩余的 176 个 task 第二轮，显著拉长了运行时间。此时将 VCluster 设置为 150CRU 为宜（1200core）。

![](/.topwrite/assets/image_1760681994525.png)

## 切分 kafka 数据以利用更多计算资源（设置 COPY\_JOB\_HINT）

当 kafka 数据量很大但 partition 数较少，或 pipe 落表前的计算逻辑较为复杂使得单个 task 不足以在周期要求内完成单个 partition 数据量计算时，可以考虑通过设置 COPY\_JOB\_HINT 来对 task 进行进一步拆分，并配合更多计算资源来实现加速的效果。

COPY\_JOB\_HINT 是一个 JSON 形式表达的复合参数，人工切分 kafka 数据需要联合使用一下两个 key：

1. "cz.sql.split.kafka.strategy":"size"默认为 "simple"，即每个 partition 划分一个 task。须更改为 "size"，意为按照条数来切分 task。
2. "cz.mapper.kafka.message.size":"200000"指示 pipe 多少 event 划分一个 task，默认值 1000000，当 "cz.sql.split.kafka.strategy" 为 "size" 时生效。

可以通过 `alter pipe pipe_ods_commit_log set COPY_JOB_HINT = '{"cz.sql.split.kafka.strategy":"size","cz.mapper.kafka.message.size":"200000"}';` 随时调整 pipe 的切分 task 策略。

>COPY\_JOB\_HINT 是 JSON 形式的复合参数，通过 alter pipe 设置时是覆盖行为，需要小心设置某些 key 时意外丢失了之前设置的其他 key。此时可以通过 desc pipe extended 在 properties 行的 copy\_job\_hint 中获取完整设置，并基于此进行修改。

在对参数调整完毕之后，我们建议将同步改动对应的 Pipe DDL，防止后续流程重建/迁移导致参数遗漏。

```SQL
CREATE VCLUSTER pipe_ods_commit_log 
    VCLUSTER_TYPE = GENERAL 
    VCLUSTER_SIZE = 150
;

CREATE PIPE pipe_ods_commit_log
    VIRTUAL_CLUSTER = 'PIPE_ODS_COMMIT_LOG' 
    BATCH_INTERVAL_IN_SECONDS = '60'
    BATCH_SIZE_PER_KAFKA_PARTITION = 2000000
    RESET_KAFKA_GROUP_OFFSETS = '1740931200000' -- epoch in millis of 2025-03-03 00:00:00
    COPY_JOB_HINT = '{"cz.sql.split.kafka.strategy":"size","cz.mapper.kafka.message.size":"200000"}' -- to accelerate load
AS COPY INTO ods_commit_log FROM 
...
```

# 更改 Pipe SQL 逻辑

Pipe 允许在 `copy into` 和 `read_kafka` 之间做比较复杂的计算。当计算逻辑发生变化，或目标表 schema 发生变化时（典型场景是增加列），需要对已有的 pipe 定义进行修改。

简言之，pipe ddl 的修改，是保持 read\_kafka 参数不变的情况下，删除并重建 pipe。

例如我们需要修改 pipe\_ods\_commit\_log，在目标表 event 字段中去掉 statments 的内容（因为和 statments 字段冗余了一份存储），则可以按照如下步骤进行操作：

1. 删除当前运行的 pipe

```SQL
drop pipe pipe_ods_commit_log;
```

>对已有 pipe  drop pipe 和 alter pipe，会被 pipe 当前正在运行的作业阻塞，直到作业结束后才会返回，可能会需要些时间。

2. 重建 pipe（注意去掉 RESET\_KAFKA\_GROUP\_OFFSETS 参数）

```sql
CREATE PIPE pipe_ods_commit_log 
    VIRTUAL_CLUSTER = 'pipe_ods_commit_log' 
    BATCH_INTERVAL_IN_SECONDS = '60'
    BATCH_SIZE_PER_KAFKA_PARTITION = 2000000
    -- RESET_KAFKA_GROUP_OFFSETS = '1740931200000' -- epoch in millis of 2025-03-03 00:00:00
    COPY_JOB_HINT = '{"cz.sql.split.kafka.strategy":"size","cz.mapper.kafka.message.size":"200000"}' -- to accelerate load
AS COPY INTO ods_commit_log FROM (
SELECT
    remove_json(parse_json(j['event']::string), '$.statements') as event,
    parse_json(parse_json(j['event']::string)['statements']::string) as statements,
    j['op_type']::string as op_type,
    j['datasource_id']::string as datasource_id,
    j['database_name']::string as database_name,
    j['schema_name']::string as schema_name,
    j['table_name']::string as table_name,
    timestamp_millis(j['event_ts']::bigint) as event_ts,
    j['event_seq']::string as event_seq,
    timestamp_millis(j['server_ts']::bigint) as server_ts,
    j['server_seq']::bigint as server_seq,
    `timestamp` as __kafka_timestamp__
FROM (
    SELECT `timestamp`, parse_json(value::string) as j
    FROM read_kafka(
    'kafka-bootstrap-1:9092,kafka-bootstrap-2:9092,kafka-bootstrap-3:9092', -- bootstrap
    'topic_name',   -- topic
    '',             -- reserved
    'sub2cz',       -- kafka group id, for keeping read position
    '', '', '', '', -- reserved
    'raw',          -- key format, can only be raw
    'raw',          -- value format, can only be raw
    0,
    MAP(
        'kafka.security.protocol','PLAINTEXT',
        'cz.kafka.fetch.retry.enable','true', 
        'cz.kafka.fetch.retry.times','20',
        'cz.kafka.fetch.retry.intervalMs','2000'
    )
)));
```

>Pipe 使用 kafka group 来记录读取的点位，因此只要使用相同的 kafka 集群、topic 及 group id，即使重建 pipe，点位也不会丢失，可以实现「断点续传」的效果。

但是 RESET\_KAFKA\_GROUP\_OFFSETS 会强制改写 group id 中记录的点位，需要谨慎使用。

# Pipe 生产运行的监控及告警

## 监控 pipe 本身

Studio 数据质量模块提供了对 pipe 的延迟监控能力。

![](/.topwrite/assets/image_1760682100684.png)

## 监控产出表

在前文中，我们在 pipe 的产出表 ods\_commit\_log 中增加了 \_\_kafka\_timestamp\_\_ 字段，可以使用这个字段配合 studio 的数据质量功能进行端到端的延迟监控，用 SQL 表达如下：

```SQL
select DATEDIFF(second, max(`__kafka_timestamp__`), now())from ods_commit_logwhere pt_date='${today}';
```

在 studio 中依次点击「数据」-「数据质量」-「质量规则」-「新建规则」

![](/.topwrite/assets/image_1760682111260.png)

配置参数 today，值为 `$[yyyyMMdd]`，选择自定义 SQL，填写前文的 SQL 查询，其他必要参数如图所示，点击保存。

在 studio 中依次点击「运维监控」-「监控告警」-「监控规则」-「新建规则」

填写必要的项如图所示并保存

![](/.topwrite/assets/image_1760682120092.png)
