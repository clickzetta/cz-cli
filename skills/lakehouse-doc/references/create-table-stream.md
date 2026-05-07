# Table Stream 功能

Table Stream是一种实时数据流，用于记录对表所做的数据操作语言（DML）更改，包括插入、更新和删除操作。同时，Table Stream还提供有关每次更改的元数据，以便您可以根据更改的数据采取相应操作。支持在Table、Dynamic Table、Materialized View、External Table(Kafka)创建Table Stream，同时也支持在 External Volume 上创建 Volume Stream，用于监听外部对象存储（如 OSS）中的文件变更事件。

## Table Stream 语法

**Table、Dynamic Table、Materialized View 创建 Table Stream 语法**

```SQL
CREATE [OR REPLACE] TABLE STREAM [IF NOT EXISTS]
  <name>
  ON TABLE <table_name>
  [TIMESTAMP AS OF timestamp_expression]
  [COMMENT = '<string_literal>']
  WITH PROPERTIES ('TABLE_STREAM_MODE' = 'APPEND_ONLY|STANDARD','SHOW_INITIAL_ROWS'='TRUE|FALSE');
```

* `<name>`：Table Stream的名称。

* `<table_name>`：要获取增量的基表。不支持view。

* `TIMESTAMP AS OF timestamp_expression`：（可选）指定Table Stream应从底层表开始接收更新的时间戳表达式。如果省略此参数，Table Stream将从当前时间开始接收更新。

  * `timestamp_expression`返回结果是一个标准的时间戳类型的表达式，TIMESTAMP AS OF指定的最早时间戳取决[TIME TRAVEL](TIMETRAVEL.md)(data\_retention\_days)参数，如果指定的版本不存在则会报错。如果未指定则使用当前时间戳的版本数据，例如：
    * `'2023-11-07 14:49:18'`，即可以强制转换为时间戳的字符串。
    * `cast('2023-11-07 14:49:18 Asia/Shanghai' as timestamp)`。
    * `current_timestamp() - interval '12' hours`。
    * 本身就是时间戳或可强制转换为时间戳的任何其他表达式。

* `COMMENT`：（可选）Table Stream的注释。

* `'TABLE_STREAM_MODE' = 'APPEND_ONLY|STANDARD'`：（必选）值二选一，APPEND\_ONLY和STANDARD。

  * APPEND\_ONLY只记录对象的INSERT操作的数据。Update和delete操作不会记录。例如，最初在表中插入了10行，然后在点位没有移动的时候执行delete操作删除5行，Table Stream仍然记录10行操作。
  * STANDARD模式：STANDARD模式下可以跟踪源对象的所有DML变化，包括插入、更新和删除（包括表截断）。这种提供行级别的变化是通过将所有变化的delta数据进行连接加工来提供行级别增量。Table Stream中的delta变化指的是在两个事务时间点之间发生的数据变化。例如，如果在Table Stream的offset之后，有一个行被插入，然后被更新，那么delta变化就是一个新的行。如果在stream的offset之后，有一个行被插入，然后被删除，那么delta变化就是没有这个行。换句话说，delta变化会反映源对象的最新状态，而不是历史变化。

* SHOW\_INITIAL\_ROWS:可选参数，指定为TRUE时，创建stream时候记录下table当时的版本，第一次消费该stream，永远拿的是创建时的那个版本，同时第一次消费时，所有数据都是insert模式，第一次消费结束后，后续的行为就和之前行为一样，从某个版本到下次版本之间的Delta数据。

### 注意事项

* 在创建Table Stream之前，必须在基表上执行以下操作：

```SQL
ALTER TABLE table_name set PROPERTIES ('change_tracking' = 'true');
```

* TIMESTAMP AS OF指定的最早时间戳取决[TIME TRAVEL](TIMETRAVEL.md)(data\_retention\_days)参数，如果指定的版本不存在则会报错。此参数定义了在被删除数据被保留的时间长度，Lakehouse默认保留数据一天。根据您的业务需求，您可以通过调整 `data_retention_days` 参数来延长或缩短数据的保留周期。请注意，调整数据保留周期可能会影响存储成本。延长保留周期会增加存储需求，从而可能增加相关的费用。
* 通过实时上传数据写入的数据一分钟之后才可以读取，Table Stream 只能读取已经提交的数据。实时任务写入的数据需要等待 1 分钟才能确认，所以 Table Stream 也要等 1 分钟才能看到。

### 使用案例

案例1：创建APPEND\_ONLY模式的Table Stream

```SQL
-- 清理环境
DROP      TABLE IF EXISTS data_change_test;

DROP      TABLE STREAM IF EXISTS data_change_test_stream;

-- 创建测试表
CREATE    TABLE data_change_test (id int, name string);

INSERT    INTO data_change_test
VALUES    (1, 'apple');

-- 在data_change_test上创建TABLE stream，获取从当前时间开始插入的增量记录
ALTER     TABLE data_change_test set PROPERTIES ('change_tracking' = 'true');

CREATE    TABLE STREAM data_change_test_stream ON TABLE data_change_test
WITH      PROPERTIES ('TABLE_STREAM_MODE' = 'APPEND_ONLY');

-- 插入测试数据
INSERT    INTO data_change_test
VALUES    (2, 'banana');

-- 查看STREAM数据
SELECT    *
FROM      data_change_test_stream;
```

案例2：创建STANDARD模式的Table Stream

```SQL
-- 清理环境
DROP      TABLE IF EXISTS data_change_test;

DROP      TABLE STREAM IF EXISTS data_change_test_stream;

-- 创建测试表
CREATE    TABLE data_change_test (id int, name string);

INSERT    INTO data_change_test
VALUES    (1, 'apple');

-- 在data_change_test上启用change_tracking
ALTER     TABLE data_change_test set PROPERTIES ('change_tracking' = 'true');

-- 创建STANDARD模式的Table Stream
CREATE    TABLE STREAM data_change_test_stream ON TABLE data_change_test
WITH      PROPERTIES ('TABLE_STREAM_MODE' = 'STANDARD');

-- 插入测试数据
INSERT    INTO data_change_test
VALUES    (2, 'banana');

-- 更新测试数据
update data_change_test set name = 'orange'
WHERE     id = 2;

-- 删除测试数据
DELETE
FROM      data_change_test
WHERE     id = 1;

-- 查看stream数据
SELECT    *
FROM      data_change_test_stream;
```

## Kafka Table Stream

支持在Kafka外部表上创建表流（Table Stream），实现实时消费Topic数据.

#### 语法

```sql
CREATE TABLE STREAM [IF NOT EXISTS] stream_name 
ON TABLE external_kafka_table 
[TIMESTAMP AS OF timestamp_expression]  -- 可选，指定消费起始时间点位
WITH PROPERTIES (
  'table_stream_mode' = 'append_only',  -- 仅支持追加模式
  'show_initial_rows' = 'true'|'false'
);
```

### 参数说明

* `TIMESTAMP AS OF`   :指定消费起始时间点（可选），支持格式：
  * **明确时间戳**：`'2023-01-01 12:00:00'`
  * **时间函数**：`CURRENT_TIMESTAMP() - INTERVAL '1' HOUR`
* `show_initial_rows`  :控制初始数据加载行为：
  * `true`：加载从外部表创建时指定的点位到Table Stream指定的点位之间的历史数据
  * `false`：从最新点位（`latest`）开始消费，不加载历史数据（默认值）
* `table_stream_mode`  : 固定为`append_only`，仅处理Kafka新增数据（不支持更新/删除操作）

#### 示例

1. Kafka 外部表创建
   首先，您需要创建一个 [Kafka 外部表](kafka-external-table.md)。这是创建 Table Stream 的基础。以下是创建 Kafka 外部表的语法：

创建Kafka Connection

```SQL
CREATE STORAGE CONNECTION pipe_kafka
    TYPE kafka
    BOOTSTRAP_SERVERS = ['47.99.48.62:9092']
    SECURITY_PROTOCOL = 'PLAINTEXT';
```

创建Kafka外部表

```SQL
CREATE EXTERNAL TABLE external_table_kafka (   
 key_column binary,   
 value_column binary NOT NULL)
USING kafka
OPTIONS (    'group_id' = 'external_table_lh',    'topics' = 'test_long')
CONNECTION pipe_kafka;
```

* `external_table_kafka` 是外部表的名称。
* `key_column` 和 `value_column` 分别代表 Kafka 消息的键和值，其中 `value_column` 是必需的。
* `USING kafka` 指定了使用 Kafka 作为数据源。
* `OPTIONS` 部分包含了 Kafka 消费者配置，如消费者组 ID (`group_id`) 和要订阅的主题 (`topics`)。
* `CONNECTION pipe_kafka` 指定了与 Kafka 的连接配置，这通常包括 Kafka 集群的地址和其他连接参数。

2. 创建 Table Stream

在 Kafka 外部表的基础上，您可以创建一个 Table Stream，用于实时处理 Kafka 数据流。以下是创建 Table Stream 的语法：

```
CREATE TABLE STREAM kafka_table_stream_pipe1
 ON TABLE external_table_kafka
WITH PROPERTIES (
    'table_stream_mode' = 'append_only',
    'show_initial_rows' = 'true');
```

^

## Volume Stream

**CREATE VOLUME STREAM 语法**

用于在 External Volume 的 Directory Table 上创建 Volume Stream，以监听外部对象存储中文件的新增与删除事件。

```
CREATE [OR REPLACE] STREAM [IF NOT EXISTS] <name>
  ON VOLUME <volume_name>;
```

**参数说明**

`<name>`：Volume Stream 的名称。

`<volume_name>`：要监听的 External Volume 名称。该 Volume 必须满足以下条件：

* 已开启目录功能，即建表时指定 DIRECTORY = (ENABLE = TRUE)；
* 已开启递归监听，即建表时指定 RECURSIVE = TRUE。

**示例**

```
-- 创建Volume Stream，追踪文件新增和删除
CREATE OR REPLACE STREAM str_app_log
  ON VOLUME vol_app_log;

```

**注意事项**

* 创建 Volume Stream 之前，须开启 DIRECTORY = (ENABLE = TRUE) 和 RECURSIVE = TRUE 。
* Volume Stream 本质上是构建在 Directory Table 之上的 Table Stream，消费机制与 Table Stream 完全一致：仅 DML 语句（如 INSERT INTO ... SELECT FROM stream）会推进消费点位，纯 SELECT 查询不会推进。
* 由于对象存储事件通过消息队列传递存在约 1 分钟的延迟，文件上传后需等待约 1 分钟才能在 Volume Stream 中查询到对应的变更记录。

^
