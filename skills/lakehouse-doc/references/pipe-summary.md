# 使用Pipe持续导入数据

>【预览发布】本功能当前处于公开预览发布阶段。

## 概述

Pipe 管道是云器 Lakehouse 用于流式数据采集的对象类型。使用 Pipe 可以持续增量地采集流式数据（如来自 Kafka），简化流式数据导入流程。

Pipe 管道在定义时使用 COPY 命令表达读取外部数据源并写入目标表的语义。与单独的 COPY 命令的主要区别在于，Pipe 将自动持续调度 COPY 任务，维护和管理数据源的读取位置，持续不断地从数据源增量导入数据。

使用 Pipe 进行流式数据自动导入的总体逻辑示意如下：

![Pipe流式数据导入逻辑示意图](![](.topwrite/assets/image_1718767758845.png =541)

## 数据源支持

Pipe 管道提供了对数据源新变化数据的持续采集能力，当前数据源包括：

* Kafka 数据源
* 对象存储（如阿里云 OSS）

## 管理使用Pipe

Lakehouse 提供了一组操作命令用于管理 Pipe 管道：

* `CREATE PIPE`
* `DESC PIPE`
* `SHOW PIPES`
* `DROP PIPE`

### 创建Pipe对象

#### 创建Pipe对象读取Kafka数据源

可使用SQL命令创建Pipe对象，语法如下：

```SQL
CREATE PIPE [ IF NOT EXISTS ] <name>
  VIRTUAL_CLUSTER = '<virtual_cluster_name>'
  [ BATCH_INTERVAL_IN_SECONDS = '<number>' ]
  [ BATCH_SIZE_PER_KAFKA_PARTITION = '<number>' ]
  [ COMMENT '<string_literal>' ]
  AS <copy_statement>
```

参数说明：

* `VIRTUAL_CLUSTER`：Pipe 提交 COPY 作业所用的 VC。必填项。
* `BATCH_INTERVAL_IN_SECONDS`：作业生成周期。可选参数，默认 60 秒。
* `BATCH_SIZE_PER_KAFKA_PARTITION`：作业最大单分区消息数。可选参数，默认 50 万。
* `COMMENT`：添加注释。可选参数。
* `COPY_STATEMENT`：使用 `COPY INTO` <table> 将数据导入到目标表。

  * 对于 Kafka 数据源，在 SELECT 语句中将使用 `read_kafka` 表值函数读取 Kafka 消息数据。函数的参数说明请查看 `read_kafka` 函数说明。

#### 创建Pipe读取对象存储数据源

读取对象存储需要创建 VOLUME，同时需要开通阿里云消息服务。消息服务用于向 Pipe 发送对象存储事件，以触发 Pipe 执行。

```SQL
--创建pipe,其中ALICLOUD_MNS_QUEUE使用，刚刚创建的云消息服务mns队列lakehouse-oss-event-queue
CREATE PIPE [ IF NOT EXISTS ] <name>
  VIRTUAL_CLUSTER = '<virtual_cluster_name>'
ALICLOUD_MNS_QUEUE = 'MNSQUEUE'
as
AS <copy_statement>
```

参数说明：

* VIRTUAL_CLUSTER：Pipe 提交 COPY 作业所用的 VC。必填项。
* `ALICLOUD_MNS_QUEUE`：消息队列名称。消息服务 MNS 可以将对象存储指定资源上产生的事件以消息的方式主动推送到指定的接收端。Pipe 接收到消息队列事件后触发执行，获取哪些文件是新增文件，然后触发 `COPY` 命令将数据导入到表中。

### 查看Pipe列表及对象详情

当前您可以使用 SQL 命令查看 Pipe 列表及对象详情。

* 使用 `SHOW PIPES` 命令查看 Pipe 对象列表

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

* 使用 `DESC PIPE` 命令查看指定 Pipe 对象详细信息

```SQL
DESC PIPE <name>;
```

### 删除Pipe对象

您可以使用 SQL 命令删除 Pipe 对象。

```SQL
DROP PIPE <name>;
```

## 约束与限制

* 数据源是 Kafka 时：一个 Pipe 中只能有一个 `read_kafka` 函数。
* 数据源是对象存储时：一个 Pipe 中只能有一个 Volume 对象。

^
