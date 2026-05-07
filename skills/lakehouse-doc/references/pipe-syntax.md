# Pipe 语法

## 创建 Pipe 语法

使用以下语法创建一个Pipe对象，以便自动化地将数据从对象存储导入到Lakehouse。

# 创建Pipe对象以自动化数据导入Lakehouse

本文档提供了创建Pipe对象的详细语法，以便自动化地将数据从对象存储或Kafka导入到Lakehouse。Pipe对象是一种强大的工具，可以帮助用户简化数据导入流程，并确保数据的高效流动。

## 从对象存储导入数据

要创建一个Pipe对象以从对象存储导入数据，可以使用以下语法：

```SQL
-- 从对象存储创建Pipe的语法
CREATE PIPE [ IF NOT EXISTS ] <pipe_name>
    VIRTUAL_CLUSTER = 'virtual_cluster_name'
    INGEST_MODE='LIST_PURGE'|'EVENT_NOTIFICATION'
    [COPY_JOB_HINT='']
AS <copy_statement>;
```

* `<pipe_name>`：您要创建的Pipe对象的名称。
* `VIRTUAL_CLUSTER`：指定虚拟集群的名称。
* `INGEST_MODE`：设置为`LIST_PURGE`或`EVENT_NOTIFICATION`，以确定数据导入模式。
* `COPY_JOB_HINT`：可选，Lakehouse保留参数
- `IGNORE_TMP_FILE`:取值true|false,默认值true。支持过滤点开头和 _temporary 开头的文件或者目录文件参数。如 `s3://my_bucket/a/b/.SUCCESS，oss://my_bucket/a/b/_temporary/`或者`oss://my_bucket/a/b/_temporary_123/`
- copy_statement：`<copy_statement>` 支持 中的中的文件参数都支持。当设置 `ON_ERROR=CONTINUE|ABORT` 参数时，可控制数据加载过程中遇到错误时的处理策略，且添加该参数后会返回导入文件列表：
    * `CONTINUE`：跳过错误行，继续加载后续数据。适用于容忍部分错误，且要求最大限度完成数据加载的场景。目前，可忽略的错误仅限于文件不格式匹配的情况，例如命令中指定为 zip 压缩格式，而文件中存在 zstd 压缩格式。
    * `ABORT`：立即终止整个`COPY`操作。适用于数据质量要求严格，任何错误都需要人工介入检查的场景。
### 使用限制
* Pipe 中的 COPY 语句不支持 files、regexp、subdirectory 参数。
* **Pipe 与 Volume 对应关系**：每个 Pipe 需对应独立的 Volume，不可复用。



### 使用说明

* [使用Pipe持续导入对象存储数据](pipe-storage-object.md)

## 从Kafka导入数据

要创建一个Pipe对象以从Kafka导入数据，可以使用以下语法：

```SQL
-- 从Kafka创建Pipe的语法
CREATE PIPE [ IF NOT EXISTS ] <pipe_name>
    VIRTUAL_CLUSTER = 'virtual_cluster_name'
    [BATCH_INTERVAL_IN_SECONDS='']
   [ BATCH_SIZE_PER_KAFKA_PARTITION='']
    [MAX_SKIP_BATCH_COUNT_ON_ERROR='']
    [RESET_KAFKA_GROUP_OFFSETS='']
    [COPY_JOB_HINT='']
AS <copy_statement>;
```
- `<pipe_name>`：您要创建的Pipe对象的名称。
- `VIRTUAL_CLUSTER`：指定虚拟集群的名称。
- `INITIAL_DELAY_IN_SECONDS`:首个作业调度延迟，选填项（默认 0 秒）
- `BATCH_INTERVAL_IN_SECONDS`：（可选）设置批处理间隔时间，默认值为60秒。
- `BATCH_SIZE_PER_KAFKA_PARTITION`：（可选）设置每个Kafka分区的批处理大小，默认值为500,000条。
- `MAX_SKIP_BATCH_COUNT_ON_ERROR`：（可选）设置在出错时跳过的批次的最大重试次数，默认值为30。
- `RESET_KAFKA_GROUP_OFFSETS`：（可选）设置启动pipe时Kafka的初始点位，不支持使用Alter修改。可选值为`latest`、`earliest`、`none`、`valid`、`${TIMESTAMP\_MILLISECONDS}`
    - 'none'：默认无操作。
    - 'valid'：检查 group 中的当前点位是否过期，将过期的 partition 点位重置到当前的 earliest。
    - 'earliest'：重置到当前 earliest。
    - 'latest'：重置到当前 latest。
    - '${TIMESTAMP\_MILLISECONDS}'：重置到毫秒时间戳对应点位，例如 '1737789688000'（2025-01-25 15:21:28）。

### 使用说明

* [使用read_kafka持续导入Kafka数据](pipe-kafka.md)
* [使用Kafka Table Stream持续导入Kafka数据](pipe-kafka-table-stream.md)

#### 暂停和启动 Pipe

您可以控制 Pipe 的执行状态，以便于管理数据同步过程。

* **暂停PIPE**：

```SQL
ALTER PIPE pipe_name SET PIPE_EXECUTION_PAUSED = true
```

* **启动PIPE**：

```SQL
ALTER PIPE pipe_name SET PIPE_EXECUTION_PAUSED = false
```

# 查看Pipe详情

查看特定Pipe对象的详细信息。

```SQL
DESC PIPE [EXTENDED] <name>;
```

## 案例

````
DESC PIPE EXTENDED kafka_pipe_stream;
+--------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
|     info_name      |                                                                                                               info_value                                                            |
+--------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| name               | kafka_pipe_stream                                                                                                                                                                   |
| creator            | UAT_TEST                                                                                                                                                                            |
| created_time       | 2025-03-05 10:40:55.405                                                                                                                                                             |
| last_modified_time | 2025-03-05 10:40:55.405                                                                                                                                                             |
| comment            |                                                                                                                                                                                     |
| properties         | ((virtual_cluster,test_alter))                                                                                                                                                      |
| copy_statement     | COPY INTO TABLE qingyun.pipe_schema.kafak_sink_table_1 FROM (SELECT `current_timestamp`() AS ```current_timestamp``()`, CAST(kafka_table_stream_pipe1.`value` AS string) AS `value` |
| pipe_status        | RUNNING                                                                                                                                                                             |
| output_name        | xxxxxxx.pipe_schema.kafak_sink_table_1                                                                                                                                              |
| input_name         | kafka_table_stream:xxxxxxx.pipe_schema.kafka_table_stream_pipe1                                                                                                                     |
| invalid_reason     |                                                                                                                                                                                     |
| pipe_latency       | {"kafka":{"lags":{"0":0,"1":0,"2":0,"3":0},"lastConsumeTimestamp":-1,"offsetLag":0,"timeLag":-1}}                                                                                   |
+--------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
````

# 查看 Pipe 列表及对象详情

列出指定范围内的所有 Pipe 对象。

```
列出当前 Schema 下的所有 Pipe
SHOW PIPES;
-- 列出指定 Schema 下的所有 Pipe
SHOW PIPES IN SCHEMA schema_name;
-- 列出指定 Workspace 下的所有 Pipe
SHOW PIPES IN WORKSPACE workspace_name;
```
**说明**

* `SHOW PIPES`：默认列出当前 Schema 下的 Pipe 对象。
* `SHOW PIPES IN SCHEMA schema_name`：列出指定 Schema 中的所有 Pipe 对象。
* `SHOW PIPES IN WORKSPACE workspace_name`：列出指定 Workspace 中的所有 Pipe 对象。

# 删除Pipe对象

当不再需要某个Pipe对象时，可以使用以下命令删除它。

```SQL
DROP PIPE <name>;
```

# 查看Pipe创建语句

```SQL
SHOW CREATE  PIPE <name>;
```

# 修改Pipe属性

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

#### load_history 函数

**功能描述**：load_history 函数用于查看表的 COPY 作业导入文件历史，保留期为 7 天。同时，Pipe 在执行时会根据 load_history 避免重复导入已有的文件，确保数据的唯一性。

**函数语法**：

```SQL
load_history('schema_name.table_name')
```

* **schema\_name.table\_name**：指定要查看导入历史的表名。

**使用案例**：

```SQL
SELECT * FROM load_history('myschema.mytable');
```

# 约束与限制

* 数据源是 Kafka 时：一个 Pipe 中只能有一个 `read_kafka` 函数。
* 数据源是对象存储时：一个 Pipe 中只能有一个 Volume 对象。


