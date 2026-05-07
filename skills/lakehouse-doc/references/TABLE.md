# Table（表）

在云器Lakehouse中，Table（表）是存储数据的基本单位，它是数据库中组织数据的核心结构。Lakehouse 的表设计为列式存储，这种存储方式在处理分析型查询时表现出极高的效率，因为它允许查询只读取需要的列数据，而不是整行数据。这种存储结构特别适合于数据仓库和大数据分析场景，可以显著提高数据处理的速度。

## 表的约束

表的约束用于确保表中数据的完整性和准确性。在Lakehouse中，支持多种类型的约束，包括但不限于：

### NOT NULL

**NOT NULL** 约束确保列中的值不能为NULL。这是在创建表时设置的，一旦设置，该约束将不可去除，以确保列中始终有有效数据。

### PRIMARY KEY

**主键（PRIMARY KEY）** 用于确保表中每条记录的唯一性。在大数据场景下，由于数据量通常非常庞大，为了保证数据的唯一性而对所有 key 进行逐一检查是不现实且低效的，因此一般不推荐在大数据环境中使用主键约束。然而，Lakehouse 仍提供了对主键的支持，以便在特定场景下满足数据完整性的需求。在 Lakehouse 架构中，定义了主键的表在进行实时数据写入时，系统将自动根据主键值进行数据去重，这对于变更数据捕获（CDC）场景尤为重要。例如，您可以实时地将MySQL数据库的binlog日志同步到Lakehouse，确保数据的一致性。设置完主键后，需要通过 [实时数据接口](java_reference/realtime-upload.md) 来处理数据。在 CDC 实时写入过程中，系统将依据主键自动进行数据去重，以维护数据的准确性和完整性。

#### Lakehouse 主键支持及默认行为

Lakehouse 支持两种直接指定主键（primary key）的方式，且在默认情况下，其行为设置为 `ENABLE VALIDATE RELY`。这意味着，当您在创建表时指定了主键，并且没有特别指定其他行为时，系统会自动启用对主键的验证和依赖关系。

在这种默认行为下，无论是实时写入操作还是通过 SQL 进行的数据写入，系统都会依据所定义的主键进行去重处理。如果尝试插入与现有主键值重复的记录，系统将拒绝执行该插入操作，以确保主键的唯一性。例如：

```sql
create table test_primary(id int primary key,name string);
desc extended test_primary;
insert into test_primary values(1,"1");
insert into test_primary values(2,"1");
-- 此时插入成功，因为主键值 1 和 2 均未重复
insert into test_primary values(1,"1");
-- 插入失败，因为主键值 1 已存在
select * from test_primary;
```

从上述示例可以看出，在默认的 `ENABLE VALIDATE RELY` 模式下，系统严格维护主键的唯一性，无论是单条记录插入还是批量插入，都会进行主键冲突检查。

#### 自定义主键行为

如果您根据实际业务需求，希望在插入数据时仅由实时写入机制进行主键去重，而通过 SQL 写入时则不执行去重操作，可以通过将主键行为设置为 `disable NOVALIDATE RELY` 来实现。以下是具体的操作示例：

```sql
create table test_primary_di(id int primary key disable NOVALIDATE RELY ,name string);
insert into test_primary_di values(1,"1");
insert into test_primary_di values(2,"1");
-- 此时插入成功，主键检查按预期执行
insert into test_primary_di values(1,"1");
-- 插入成功，因为在 disable NOVALIDATE RELY 模式下，SQL 写入不进行主键去重
```

需要注意的是，在 `disable NOVALIDATE RELY` 模式下，虽然实时写入仍会依据主键进行去重，但通过 SQL 进行的写入操作将不会受到主键唯一性约束的限制，这可能导致数据中出现主键重复的情况。因此，在选择此模式时，您需要对数据的写入来源和写入方式进行审慎的考虑和管理，以避免潜在的数据质量问题。
