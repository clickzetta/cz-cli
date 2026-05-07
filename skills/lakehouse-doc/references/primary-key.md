# lakehouse 主键使用说明

## 主键约束概述

**主键（PRIMARY KEY**） 用于确保表中每条记录的唯一性。在大数据场景下，由于数据量通常非常庞大，为了保证数据的唯一性而对所有 key 进行逐一检查是不现实且低效的，因此一般不推荐在大数据环境中使用主键约束。然而，Lakehouse 仍提供了对主键的支持，以便在特定场景下满足数据完整性的需求。在Lakehouse架构中，定义了主键的表在进行实时数据写入时，系统将自动根据主键值进行数据去重，这对于变更数据捕获（CDC）场景尤为重要。例如，您可以实时地将MySQL数据库的binlog日志同步到Lakehouse，确保数据的一致性。设置完主键需要通过[实时数据接口](java_reference/realtime-upload.md)来处理数据。在CDC实时写入过程中，系统将依据主键自动进行数据去重，以维护数据的准确性和完整性。

## lakehouse 主键支持及默认行为

lakehouse 支持两种直接指定 primary key 的方式，且在默认情况下，其行为设置为 `ENABLE VALIDATE RELY`。这意味着，当您在创建表时指定了主键，并且没有特别指定其他行为时，系统会自动启用对主键的验证和依赖关系。

在这种默认行为下，无论是实时写入操作还是通过 SQL 进行的数据写入，系统都会依据所定义的主键进行去重处理。如果尝试插入与现有主键值重复的记录，系统将拒绝执行该插入操作，以确保主键的唯一性。例如：

```sql
create table test_primary(id int primary key,name string);
desc extended test_primary;
-- 此时插入成功，因为主键值 1 和 2 均未重复
insert into test_primary values(1,"1");
insert into test_primary values(2,"1");
-- 插入失败，因为主键值 1 已存在
insert into test_primary values(1,"1");
select * from test_primary;
```

从上述示例可以看出，在默认的 `ENABLE VALIDATE RELY` 模式下，系统严格维护主键的唯一性，无论是单条记录插入还是批量插入，都会进行主键冲突检查。

## 自定义主键行为

如果您根据实际业务需求，希望在插入数据时仅由实时写入机制进行主键去重，而通过 SQL 写入时则不执行去重操作，可以通过将主键行为设置为 `DISABLE NOVALIDATE RELY` 来实现。以下是具体的操作示例：

```sql
create table test_primary_di(id int primary key DISABLE NOVALIDATE RELY ,name string);
insert into test_primary_di values(1,"1");
insert into test_primary_di values(2,"1");

insert into test_primary_di values(1,"1");
-- 插入成功，因为在 DISABLE NOVALIDATE RELY 模式下，SQL 写入不进行主键去重
```

需要注意的是，在 `DISABLE NOVALIDATE RELY` 模式下，虽然实时写入仍会依据主键进行去重，但通过 SQL 进行的写入操作将不会受到主键唯一性约束的限制，这可能导致数据中出现主键重复的情况。因此，在选择此种模式时，您需要对数据的写入来源和写入方式进行考虑和管理，以避免潜在的数据质量问题。

# 主键表创建语法

* 不带分区或分桶的主键表

```
CREATE TABLE pk_table
(
    id int,
    col string,
PRIMARY KEY (id)
);
CREATE TABLE pk_table
(
    id int PRIMARY KEY,
    col string
);
```

* 带分桶的主键表。
  1. **未指定 DISABLE NOVALIDATE RELY 时**：

     * Cluster Key 必须包含主键列
     * 排序键必须包含主键
  2. **指定 DISABLE NOVALIDATE RELY 时**：

     * Cluster Key 可不包含主键列
     * 排序键可不包含主键

```
--指定DISABLE NOVALIDATE RELY
CREATE TABLE pk_table
(
    id int,
    col string,
    cluster_key string,
    PRIMARY key (id) DISABLE NOVALIDATE RELY
) 
CLUSTERED BY ( cluster_key)  INTO 16 BUCKETS;
--不指定DISABLE NOVALIDATE RELY
CREATE TABLE pk_table
(
    id int,
    col string,
    cluster_key string,
    PRIMARY key (id)
) 
CLUSTERED BY (id, cluster_key) SORTED BY (id) INTO 16 BUCKETS;


```

* 带主键的分区表。
  1. **未指定 DISABLE NOVALIDATE RELY 时**：
     * Partition Key 必须包含主键列
  2. **指定 DISABLE NOVALIDATE RELY 时**：
     * Partition Key 可不包含主键列

```
--指定DISABLE NOVALIDATE RELY
CREATE TABLE pk_table
(
    id int,
    col string,
    pt string,
    PRIMARY key (id)DISABLE NOVALIDATE RELY
) PARTITIONED BY (pt);
--不指定DISABLE NOVALIDATE RELY
CREATE TABLE pk_table
(
    id int,
    col string,
    pt string,
    PRIMARY key (id, pt)
) PARTITIONED BY (pt);
```

# 使用注意事项

**类型选择建议**

* 优先使用数值类型（如 int/bigint 等）
* 避免使用变长类型（如 string/varchar），以减少索引空间占用
* 禁止使用浮点数类型（float/double）
* 禁止使用嵌套类型
  **约束条件**
* 主键列必须定义为 NOT NULL
* 不支持 Schema Evolution（表结构变更后主键不可修改）

# 使用案例

## 创建表

在创建Lakehouse表时，需要指定主键。CDC写入会根据主键进行数据去重，以确保数据的准确性。创建的主键表不支持SQL操作，只能通过实时写入流进行数据写入。创建的主键表不支持也不支持使用SQL添加列和修改列。以下是一个创建表的示例：

```sql
CREATE TABLE igs_test_upsert (
    id int PRIMARY KEY,
    event varchar(100),
    event_time STRING
);
```

## SDK实时写入流

### 创建实时写入流

使用SDK创建实时写入流，需要指定操作类型（CDC）和相关选项。以下是一个创建实时写入流的示例：

```java
RowStream stream = client.newRealtimeStreamBuilder()
    .operate(RowStream.RealtimeOperate.CDC)
    .options(options)
    .schema(schema)
    .table(table)
    .build(); // 关闭流，释放流资源，必须调用
stream.close();
```

### 指定操作类型

根据需求，可以指定不同的操作类型：

* `Stream.Operator.UPSERT`：插入或更新行。如果目标行不存在，则插入；如果已存在，则更新。
* `Stream.Operator.DELETE_IGNORE`：删除行。如果目标行不存在，则自动忽略。

### 使用原生Java Sdk写入

```java
Row row = stream.createRow(Stream.Operator.UPSERT); // 插入或更新行
Row rowToDelete = stream.createRow(Stream.Operator.DELETE_IGNORE); // 删除行
```

## 使用Lakehouse实时同步功能写入

参考文档[多表实时同步](<multitable_realtime_sync.md>)

## 使用FLINK CONNECTOR写入

Flink connector是基于RealtimeStream SDK封装的，用于实现实时数据同步。查看[Flink Connector](<flink-write-connector.md>)

## 参考

[Java实时编程接口](java_reference/realtime-upload.md)

[使用Java SDK读取Kafka数据实时上传数据](use-java-sdk-releatime-uploaddata.md)

[云器Lakehouse多表实时同步实现CDC](czguide-intro-to-cdc-using-clickzetta-rtsync-dynamic-tables.md)
