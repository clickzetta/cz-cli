# TABLE STREAM 功能介绍

## 概述

Table Stream 是 Lakehouse 架构中的一种对象，它能够记录对表进行的数据操作语言（DML）的更改，包括插入、更新和删除操作。Table Stream 还提供有关每次更改的元数据信息，使得用户可以利用这些信息采取相应的操作。它可以记录表中两个事务时间点之间的行级别更改，类似于关系数据库的变更数据捕获（CDC）功能。下游系统可以通过 SQL 语句消费 Table Stream，当下游的 DML 操作包含 Table Stream 时，会导致 Table Stream 的位点自动偏移。支持在 Table、Dynamic Table、Materialized View、External Table(Kafka) 创建 Table Stream.

同时也支持在 External Volume 上创建 Volume Stream，用于监听外部对象存储（如 OSS）中的文件变更事件。

## Table、Dynamic Table 和 Materialized View 的 TABLE STREAM OFFSET

Table Stream Offset 是一种存储流的偏移量（即源对象的当前事务版本）的机制。偏移量决定了 Table Stream 返回的变化记录的范围。以下是 Table Stream Offset 的一些特点：

1. 当创建 Table Stream 时，会对源对象的每一行进行一个初始快照，以初始化一个偏移量。随后，Table Stream 会记录在此快照之后发生的 DML 变化的信息。
2. Table Stream 本身不包含任何表数据，只存储源对象的偏移量，并利用源对象的版本历史来返回变化记录。
3. Table Stream 的偏移量可以在创建时指定，也可以在消费时更新。指定偏移量的方法使用时间戳。
4. Table Stream 的偏移量位于源对象的两个表版本之间。查询 Table Stream 时，会返回在偏移量之后和当前时间之前提交的事务所造成的变化。

## Table、Dynamic Table和Materialized View的TABLE 版本控制

在 Lakehouse 中，每当对表进行插入、更新或删除操作时，都会生成一个新的表版本（也称为快照）。这些版本是不可变的，意味着一旦创建，它们就不能被修改。每个版本都包含了自上一版本以来所有数据变更的记录。Table Stream 是基于 TABLE 版本实现的。当创建一个 Stream 时，它会跟踪源表的所有后续版本，并允许用户查询自从创建 Table Stream 以来发生的变更。

![](.topwrite/assets/image_1704374346251.png)

上面的例子显示了一个源表在时间线上有10个已提交的版本。Table Stream的偏移目前在表版本v3和v4之间。当查询（或消费）流时，返回的记录包括从表版本v4开始，即表时间线中流偏移之后的版本，到v10结束，即时间线中最近提交的表版本，包括这两个版本之间的最小更改集。

## Table、Dynamic Table和Materialized View的TABLE STREAM支持的类型

1. STANDARD 模式：在此模式下，可以跟踪源对象的所有 DML 变化，包括插入、更新和删除（包括表截断）。这种模式提供行级别的变化，是通过将所有变化的 delta 数据进行连接加工来提供行级别增量。Table Stream 中的 delta 变化指的是在两个事务时间点之间发生的数据变化。
2. APPEND\_ONLY 模式：只记录对象的 INSERT 操作的数据。对于 UPDATE 和 DELETE 操作不会进行记录。

## Table、Dynamic Table和Materialized View的TABLE STREAM 记录数据的范围

这个时间范围取决于源对象的数据保留期和数据延长期（DATA\_RETENTION\_DAYS）。数据保留期是指源对象的历史数据可以通过 Time Travel 查询的时间长度。

## 消费 TABLE STREAM

Table Stream 的消费者是指下游 SQL 中含有 DML 语句则会消费 Table Stream 数据。当下游的 DML 操作包含 Table Stream 时，会使 Table Stream 的位点自动偏移。执行 DQL 操作不会使位点偏移，例如 SELECT 语句。一个源对象可以有多个 stream 同时跟踪它的变化。每个 Table Stream 都可以有不同的 offset，即不同的起始时间点。每个 Table Stream 都可以被不同的消费者（consumer）使用，例如不同的任务、脚本或其他机制。消费者可以通过执行 DML 事务来消费 Table Stream 中的变化数据，从而更新 Table Stream 的 offset。

## TABLE STREAM 中的元数据字段

当查询 Table Stream 时，返回的结果集中包含附加的元数据列，包含变化的类型、提交的版本、和提交的时间。具体字段如下：

* `__change_type`：包含 DML 操作（INSERT、DELETE、UPDATE\_BEFORE、UPDATE\_AFTER）
* `__commit_version`：数据提交的版本
* `__commit_timestamp`：数据提交的时间

## 注意事项

* 创建 Table Stream 之前，必须在基表上执行以下操作开启变更跟踪：`ALTER TABLE table_name set PROPERTIES ('change_tracking' = 'true');`
* 通过[实时上传数据](java_reference/realtime-upload.md)写入的数据一分钟之后才可以读取，Table Stream 只能读取已经提交的数据。实时任务写入的数据需要等待 1 分钟才能确认，所以 Table Stream 也要等 1 分钟才能看到。

## 使用案例

### APPEND\_ONLY 模式案例

```SQL
-- 创建一个测试表
CREATE TABLE test_table (id INT, name VARCHAR, age INT);
--创建table stream时必须开启
ALTER table test_table set PROPERTIES ('change_tracking' = 'true');

--创建只追加流
CREATE table stream test_stream ON TABLE test_table
WITH
  PROPERTIES ('TABLE_STREAM_MODE' = 'APPEND_ONLY');

-- 插入一些数据到测试表
INSERT INTO test_table VALUES
  (1, 'Alice', 20),
  (2, 'Bob', 25),
  (3, 'Charlie', 30),
  (4, 'David', 35),
  (5, 'Eve', 40);

-- 查询测试流，应该返回插入的数据
SELECT * FROM test_stream;
+---------------+------------------+-------------------------+----+---------+-----+
| __change_type | __commit_version |   __commit_timestamp    | id |  name   | age |
+---------------+------------------+-------------------------+----+---------+-----+
| INSERT        | 3                | 2025-04-28 17:37:25.785 | 1  | Alice   | 20  |
| INSERT        | 3                | 2025-04-28 17:37:25.785 | 2  | Bob     | 25  |
| INSERT        | 3                | 2025-04-28 17:37:25.785 | 3  | Charlie | 30  |
| INSERT        | 3                | 2025-04-28 17:37:25.785 | 4  | David   | 35  |
| INSERT        | 3                | 2025-04-28 17:37:25.785 | 5  | Eve     | 40  |
+---------------+------------------+-------------------------+----+---------+-----+
-- 更新一些数据到测试表
UPDATE test_table SET age = age + 5 WHERE     id = 1 OR       id = 3;
-- 查询测试流，应该返回第一次追加的记录，只记录第一次insert的数据，update的数据不会记录
SELECT * FROM test_stream;
+---------------+------------------+-------------------------+----+---------+-----+
| __change_type | __commit_version |   __commit_timestamp    | id |  name   | age |
+---------------+------------------+-------------------------+----+---------+-----+
| INSERT        | 3                | 2025-04-28 17:37:25.785 | 1  | Alice   | 20  |
| INSERT        | 3                | 2025-04-28 17:37:25.785 | 2  | Bob     | 25  |
| INSERT        | 3                | 2025-04-28 17:37:25.785 | 3  | Charlie | 30  |
| INSERT        | 3                | 2025-04-28 17:37:25.785 | 4  | David   | 35  |
| INSERT        | 3                | 2025-04-28 17:37:25.785 | 5  | Eve     | 40  |
+---------------+------------------+-------------------------+----+---------+-----+
-- 删除一些数据到测试表
DELETE FROM test_table WHERE id = 2 OR id = 4;
-- 查询测试流，应该返回第一次追加的记录，只记录第一次insert的数据，delete不会记录
SELECT * FROM test_stream;
+---------------+------------------+-------------------------+----+---------+-----+
| __change_type | __commit_version |   __commit_timestamp    | id |  name   | age |
+---------------+------------------+-------------------------+----+---------+-----+
| INSERT        | 3                | 2025-04-28 17:37:25.785 | 1  | Alice   | 20  |
| INSERT        | 3                | 2025-04-28 17:37:25.785 | 2  | Bob     | 25  |
| INSERT        | 3                | 2025-04-28 17:37:25.785 | 3  | Charlie | 30  |
| INSERT        | 3                | 2025-04-28 17:37:25.785 | 4  | David   | 35  |
| INSERT        | 3                | 2025-04-28 17:37:25.785 | 5  | Eve     | 40  |
+---------------+------------------+-------------------------+----+---------+-----+
-- 删除原表
DELETE FROM test_table;
-- 查询测试流，应该返回第一次追加的记录，只记录第一次insert的数据，delete不会记录
SELECT * FROM test_stream;
+---------------+------------------+-------------------------+----+---------+-----+
| __change_type | __commit_version |   __commit_timestamp    | id |  name   | age |
+---------------+------------------+-------------------------+----+---------+-----+
| INSERT        | 3                | 2025-04-28 17:37:25.785 | 1  | Alice   | 20  |
| INSERT        | 3                | 2025-04-28 17:37:25.785 | 2  | Bob     | 25  |
| INSERT        | 3                | 2025-04-28 17:37:25.785 | 3  | Charlie | 30  |
| INSERT        | 3                | 2025-04-28 17:37:25.785 | 4  | David   | 35  |
| INSERT        | 3                | 2025-04-28 17:37:25.785 | 5  | Eve     | 40  |
+---------------+------------------+-------------------------+----+---------+-----+
```

**注意**

创建Table Stream，必须在基表上执行

```SQL
ALTER TABLE table_name set PROPERTIES ('change_tracking' = 'true');
```

### STANDARD模式案例

```SQL
-- 创建一个测试表
CREATE TABLE test_table_offset (id INT, name VARCHAR, age INT);
--创建table stream时必须开启
ALTER TABLE test_table_offset set PROPERTIES ('change_tracking' = 'true');
CREATE table stream test_table_offset_stream ON TABLE test_table_offset
WITH PROPERTIES ('TABLE_STREAM_MODE' = 'STANDARD');
-- 插入一些数据到测试表
INSERT INTO test_table_offset VALUES
  (1, 'Alice', 20),
  (2, 'Bob', 25),
  (3, 'Charlie', 30),
  (4, 'David', 35),
  (5, 'Eve', 40);

-- 查询测试流，应该返回插入的数据
CREATE TABLE test_table_offset_consume (id INT, name VARCHAR, age INT);
--把刚刚插入的数据也同步到目标表，保持一致
INSERT INTO test_table_offset_consume
SELECT id,name,age FROM test_table_offset_stream;
--查看strema是否有数据
SELECT * FROM test_table_offset_stream;
+---------------+------------------+--------------------+----+------+-----+
| __change_type | __commit_version | __commit_timestamp | id | name | age |
+---------------+------------------+--------------------+----+------+-----+
-- 更新一些数据到测试表
UPDATE test_table_offset SET age = age + 5 WHERE id = 1 OR id = 3;

-- 查询测试流，应该返回更新的数据，此时数据中会有两条更新前和更新后
SELECT * FROM test_table_offset_stream;
+---------------+------------------+-------------------------+----+---------+-----+
| __change_type | __commit_version |   __commit_timestamp    | id |  name   | age |
+---------------+------------------+-------------------------+----+---------+-----+
| UPDATE_AFTER  | 4                | 2025-04-28 17:41:18.507 | 1  | Alice   | 25  |
| UPDATE_AFTER  | 4                | 2025-04-28 17:41:18.507 | 3  | Charlie | 35  |
| UPDATE_BEFORE | 3                | 2025-04-28 17:40:54.626 | 1  | Alice   | 20  |
| UPDATE_BEFORE | 3                | 2025-04-28 17:40:54.626 | 3  | Charlie | 30  |
+---------------+------------------+-------------------------+----+---------+-----+
--将更新后的数据消费,使用stream的数据更新目标表
MERGE INTO test_table_offset_consume target USING test_table_offset_stream source_stream ON target.id = source_stream.id WHEN MATCHED
AND source_stream.__change_type = 'UPDATE_AFTER' THEN update set target.age = source_stream.age WHEN MATCHED
AND source_stream.__change_type = 'DELETE' THEN DELETE WHEN NOT MATCHED
AND source_stream.__change_type = 'INSERT' THEN
INSERT VALUES (target.id, target.name, target.age);

--查看更新后的表test_table_offset_consume数据是否正确
SELECT * FROM test_table_offset_consume;
+----+---------+-----+
| id |  name   | age |
+----+---------+-----+
| 1  | Alice   | 25  |
| 3  | Charlie | 35  |
| 2  | Bob     | 25  |
| 4  | David   | 35  |
| 5  | Eve     | 40  |
+----+---------+-----+
--查看table stream中是否还有数据，table stream的数据已经全部消费
SELECT * FROM test_table_offset_stream;
+---------------+------------------+--------------------+----+------+-----+
| __change_type | __commit_version | __commit_timestamp | id | name | age |
+---------------+------------------+--------------------+----+------+-----+
-- 删除一些数据到测试表
DELETE FROM test_table_offset WHERE id = 2 OR id = 4;
--查看table stream
SELECT * FROM test_table_offset_stream;
+---------------+------------------+-------------------------+----+-------+-----+
| __change_type | __commit_version |   __commit_timestamp    | id | name  | age |
+---------------+------------------+-------------------------+----+-------+-----+
| DELETE        | 3                | 2025-04-28 17:40:54.626 | 2  | Bob   | 25  |
| DELETE        | 3                | 2025-04-28 17:40:54.626 | 4  | David | 35  |
+---------------+------------------+-------------------------+----+-------+-----+
--将删除后的数据消费,使用table stream的数据更新目标表
MERGE INTO test_table_offset_consume target USING test_table_offset_stream source_stream ON target.id = source_stream.id WHEN MATCHED
AND source_stream.__change_type = 'UPDATE_AFTER' THEN update set target.age = source_stream.age WHEN MATCHED
AND source_stream.__change_type = 'DELETE' THEN DELETE WHEN NOT MATCHED
AND source_stream.__change_type = 'INSERT' THEN
INSERT VALUES (target.id, target.name, target.age);

----查看更新后的表test_table_offset_consume数据是否正确
SELECT * FROM test_table_offset_consume;
+----+---------+-----+
| id |  name   | age |
+----+---------+-----+
| 1  | Alice   | 25  |
| 3  | Charlie | 35  |
| 5  | Eve     | 40  |
+----+---------+-----+
--查看table stream中是否还有数据，table stream的数据已经全部消费
SELECT * FROM test_table_offset_stream;
+---------------+------------------+--------------------+----+------+-----+
| __change_type | __commit_version | __commit_timestamp | id | name | age |
+---------------+------------------+--------------------+----+------+-----+
```

## Volume Stream 功能介绍

Volume Stream 是 Table Stream 的一种特殊形式，它构建在 External Volume 的 Directory Table 之上。Directory Table 是 External Volume 开启目录功能（DIRECTORY = (ENABLE = TRUE)）后自动维护的一张元数据表，记录了 Volume 中所有文件的路径、大小、修改时间等信息。Volume Stream 通过追踪 Directory Table 的数据变化，来感知外部存储（如对象存储 OSS、S3 等）中文件的新增与删除事件。

与普通 Table Stream 追踪用户表的 DML 变更不同，Volume Stream 追踪的是文件层面的变化。Directory Table 的更新依赖云厂商的消息队列服务（如阿里云 MNS、AWS SQS 等）将对象存储的事件通知实时推送至系统，从而驱动 Directory Table 刷新，进而使 Volume Stream 感知到文件的新增与删除。

典型使用场景包括：应用日志分析、IoT 设备数据接入、图片/音视频元数据提取、多源文件归档等。通过 Volume Stream 作为增量驱动器，配合调度任务实现"只处理新增/变更文件"的高效增量模式，避免全量扫描带来的性能与成本开销。

***

## 前置准备

在创建 Volume Stream 之前，需要完成以下云服务及数据库对象的准备工作（以阿里云-杭州 region 为例）。

> 注意：当前版本(2026.03)仅支持阿里云和 AWS

### STEP-1：创建 MNS 队列

1. 进入 [阿里云 MNS 控制台](https://mns.console.aliyun.com/region/cn-hangzhou/queues)。
2. 创建队列，输入名称（例如 `volume-stream-20251203`），选择**普通队列**，其他配置保持默认。

### STEP-2：创建 OSS 事件通知

1. 打开 OSS Bucket 管理页，选择 **数据处理 → 事件通知**。
2. 创建规则：
   * 根据需要选择事件类型（建议勾选 `ObjectCreate:*`、`ObjectRemoved:*`）。
   * 根据需要配置对象匹配前缀/后缀。
   * 通知目标选择 STEP-1 中创建的 MNS 队列。

### STEP-3：创建 RAM 策略和角色

**a. 创建权限策略**（[策略管理页](https://ram.console.aliyun.com/policies)），参考配置如下：

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "oss:GetObject",
        "oss:HeadBucket",
        "oss:PutObject",
        "oss:DeleteObject",
        "oss:ListObjects"
      ],
      "Resource": [
        "acs:oss:oss-cn-hangzhou:<账号ID>:<bucket名称>",
        "acs:oss:oss-cn-hangzhou:<账号ID>:<bucket名称>/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "mns:GetQueueAttributes",
        "mns:SetQueueAttributes"
      ],
      "Resource": "acs:mns:cn-hangzhou:<账号ID>:/queues/<队列名称>"
    },
    {
      "Effect": "Allow",
      "Action": [
        "mns:DeleteMessage",
        "mns:ReceiveMessage",
        "mns:PeekMessage",
        "mns:BatchPeekMessage"
      ],
      "Resource": "acs:mns:cn-hangzhou:<账号ID>:/queues/<队列名称>/messages"
    }
  ]
}
```

**b. 创建角色**（[角色管理页](https://ram.console.aliyun.com/roles)）：

1. **信任主体类型**：选择"云账号"。
2. **信任主体名称**：选择"其他云账号"，输入 Lakehouse 平台的账号 ID（`1384322691904283`）。
3. **角色名称**：例如 `CzVolumeStreamRole`。
4. 将 STEP-3a 中创建的权限策略授予该角色。

### STEP-4：创建 Storage Connection

**a. 创建连接**：

```sql
CREATE STORAGE CONNECTION conn_hz
    TYPE OSS
    REGION = 'cn-hangzhou'
    ROLE_ARN = 'acs:ram::<账号ID>:role/<角色名称>'
    ENDPOINT = 'oss-cn-hangzhou-internal.aliyuncs.com';
```

**b. 获取 External ID，用于后续配置信任策略**：

```sql
DESCRIBE CONNECTION conn_hz;
```

记录返回结果中的 `externalId` 字段值。

**c. 更新角色信任策略**（将 `externalId` 填入）：

```json
{
  "Statement": [
    {
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": {
          "sts:ExternalId": "<describe connection 返回的 externalId>"
        }
      },
      "Effect": "Allow",
      "Principal": {
        "RAM": [
          "acs:ram::1384322691904283:root"
        ]
      }
    }
  ],
  "Version": "1"
}
```

***

## Volume Stream 语法

### 创建 External Volume

在创建 Volume Stream 之前，必须先创建一个带有消息通知配置的 External Volume：

```sql
CREATE [OR REPLACE] EXTERNAL VOLUME <volume_name>
  LOCATION '<oss://bucket/path/>'
  USING CONNECTION <connection_name>
  NOTIFICATION = (
    QUEUE_TYPE = 'ALICLOUD_MNS',
    QUEUE_NAME = '<volume-stream-20251203>', -- STEP-1 创建的队列名称
    VIRTUAL_CLUSTER = 'DEFAULT'
  )
  DIRECTORY = (ENABLE = TRUE)
  RECURSIVE = TRUE;
```

**参数说明**：

* `<volume_name>`：External Volume 的名称。
* `LOCATION`：OSS 存储路径，格式为 `oss://<bucket>/<prefix>/`。
* `USING CONNECTION <connection_name>`：关联 STEP-4 中创建的 Storage Connection。
* `NOTIFICATION`：消息通知配置块。
  * `QUEUE_TYPE`：消息队列类型，当前支持 `ALICLOUD_MNS`。
  * `QUEUE_NAME`：STEP-1 中确认的 MNS 队列名称。
  * `VIRTUAL_CLUSTER`：虚拟集群名称，默认填写 `DEFAULT`。
* `DIRECTORY = (ENABLE = TRUE)`：开启目录模式，Volume Stream 依赖此配置。
* `RECURSIVE = TRUE`：递归监听路径下所有子目录的文件变更。

### 创建 Volume Stream

```sql
CREATE [OR REPLACE] STREAM <name>
  ON VOLUME <volume_name>;
```

**参数说明**：

* `<name>`：Volume Stream 的名称。
* `<volume_name>`：要监听的 External Volume 名称。

***

## 注意事项

* 当前版本(2026.03) 仅支持阿里云和 AWS。
* RAM 角色的信任策略中必须正确配置 `sts:ExternalId`，否则 Lakehouse 平台无法代入该角色读取 MNS 消息和 OSS 文件。
* Volume Stream 只能读取已完成上传的文件。由于事件通知存在一定的传递延迟（通常约 1 分钟），文件上传后需等待约 1 分钟才能在 Volume Stream 中查询到对应的变更记录。
* 与 Table Stream 类似，Volume Stream 通过消费点位（offset）记录已处理的事件位置，消费行为通常是一个 DML 操作（非 SELECT），每次消费后点位会向前推进，避免重复消费。

***

## 示例：增量解析 OSS 图片

以下示例展示了一个 Volume Stream 配置流程，用于监听 `sh-oss-derek` bucket 下 `dish-images/` 目录中的文件新增与删除事件。利用图像识别函数只消费 `INSERT` 和 `UPDATE_AFTER` 两种事件（新增图片 + 替换图片），跳过 DELETE 和 UPDATE\_BEFORE，调用 AI 函数识别后写入结果表，DML 执行完自动推进消费点位。

> 注意：此案例中用到的云厂商角色 ARN，图像识别函数等需要自定义，系统并未默认提供。

### 1. 创建 Storage Connection

```sql
CREATE STORAGE CONNECTION conn_sh_oss
  TYPE OSS
  REGION = 'cn-shanghai'
  ROLE_ARN = 'acs:ram::1450476637304722:role/czvolumestreamrole' -- 需替换成自己的 RoleARN
  ENDPOINT = 'oss-cn-shanghai.aliyuncs.com';
```

### 2. 获取 External ID 并更新信任策略

```sql
DESCRIBE CONNECTION conn_sh_oss;
```

将返回的 `externalId`（例如 `EOKskml6SMldYOb9`）填入角色的信任策略后保存。

### 3. 创建基础对象

```sql
-- 1. 创建 External Volume（OSS 图片桶，开启 MNS 事件通知）
CREATE EXTERNAL VOLUME vol_dish_images
  LOCATION 'oss://sh-oss-derek/dish-images/'
  USING CONNECTION conn_sh_oss
  NOTIFICATION = (
    QUEUE_TYPE    = 'ALICLOUD_MNS',
    QUEUE_NAME    = 'cz-queue-mns-ossevent',
    VIRTUAL_CLUSTER = 'DEFAULT'
  )
  DIRECTORY = (ENABLE = TRUE)
  RECURSIVE = TRUE;

-- 2. 创建识别结果表
CREATE TABLE IF NOT EXISTS dish_recognition_results (
    file_path          VARCHAR        COMMENT '图片相对路径',
    file_url           VARCHAR        COMMENT '图片完整 OSS 地址',
    file_size          BIGINT         COMMENT '文件大小（字节）',
    last_modified_time TIMESTAMP      COMMENT '文件最后修改时间',
    recognized_content VARCHAR        COMMENT 'AI 识别结果',
    change_type        VARCHAR        COMMENT '触发事件类型 INSERT/UPDATE_AFTER',
    commit_version     BIGINT         COMMENT 'Stream 消费版本号',
    processed_at       TIMESTAMP      COMMENT '处理时间'
);

-- 3. 创建 Volume Stream（STANDARD 模式，可感知新增和替换）
CREATE STREAM IF NOT EXISTS str_dish_images
  ON VOLUME vol_dish_images
  WITH PROPERTIES ('TABLE_STREAM_MODE' = 'STANDARD');
```

### 4. 增量消费

```
-- 增量识别节点：只处理 INSERT（新图）和 UPDATE_AFTER（替换图），自动推进 offset
INSERT INTO dish_recognition_results
SELECT
    relative_path   AS file_path,
    url   AS file_url,
    size   AS file_size,
    last_modified_time,
    public.fc_image_to_text('dish_recognition', url) AS recognized_content,
    __change_type  AS change_type,
    __commit_version  AS commit_version,
    current_timestamp() AS processed_at
FROM str_dish_images
WHERE __change_type IN ('INSERT', 'UPDATE_AFTER')  -- 只处理新增和替换，跳过 DELETE / UPDATE_BEFORE
  AND (
       lower(relative_path) LIKE '%.jpg'
    OR lower(relative_path) LIKE '%.jpeg'
    OR lower(relative_path) LIKE '%.png'
    OR lower(relative_path) LIKE '%.webp'
  );                       
```

### 5. 查询识别结果

```
-- 查看最新识别结果
SELECT
    file_path,
    recognized_content,
    change_type,
    processed_at
FROM dish_recognition_results
ORDER BY processed_at DESC
LIMIT 20;

-- 统计每类菜品识别数量
SELECT
    recognized_content,
    COUNT(*) AS cnt
FROM dish_recognition_results
GROUP BY recognized_content
ORDER BY cnt DESC;

```

^
