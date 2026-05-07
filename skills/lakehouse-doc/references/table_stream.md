## Table Stream 变化数据捕获

Table Stream 是云器 Lakehouse 的一种功能，用于捕获表对象的变化数据。通过定义 Table Stream 对象，您可以基于现有表来记录和追踪数据的变化。该对象利用 Lakehouse Table 的多历史版本功能，在创建时会记录源表的指定版本（或最新版本）作为初始读取位置。当您使用 SQL 查询 Table Stream 时，它将返回从初始位点到当前最新版本的所有变化记录。

以下是 Table Stream 的工作原理示意图：

![Table Stream工作原理](.topwrite/assets/image_1699855189257.png)

Table Stream 不会存储实际数据，仅记录和维护源表的数据版本位点。仅当使用 INSERT、DELETE、UPDATE、MERGE 等 DML 语句操作 Table Stream 时，其位点才会更新至最新的数据版本。

### 应用场景

1. **SQL ETL 任务**：使用 Table Stream 可以简化增量数据的识别，提高 ETL 任务的处理效率。传统 ETL 任务需要通过分区过滤或 WHERE 条件过滤增量数据，这在实时化场景下可能会产生额外的系统压力和资源消耗。Table Stream 基于数据版本识别变化数据，无需额外操作和计算即可捕获增量数据，从而提高 ETL 作业的效率，节省计算开销。
2. **实时数据提供**：类似于数据库的CDC（变更数据捕获），Lakehouse数据平台的Table Stream可以捕获变化数据，并将这些数据以明细记录的形式持续同步给下游系统。

## Table Stream类型

Table Stream 有两种类型：

1. **STANDARD 类型**：跟踪源对象的所有 DML 变化，包括插入、更新和删除（包括表截断）。这种类型提供行级别的变化，通过连接加工所有变化的 delta 数据来提供行级别增量。Table Stream 中的 delta 变化指的是在两个事务时间点之间发生的数据变化。例如，如果在 Table Stream 的 offset 之后，有一行被插入，然后被更新，那么 delta 变化就是一个新的行。如果在 Table Stream 的 offset 之后，有一行被插入，然后被删除，那么 delta 变化就是没有这一行。换句话说，delta 变化会反映源对象的最新状态，而不是历史变化。
2. **APPEND_ONLY 类型**：仅记录对象的 INSERT 操作的数据。update 和 delete 操作不会记录。例如，最初在表中插入了 10 行，然后在点位没有移动的时候执行 delete 操作删除 5 行，Table Stream 仍然记录 10 行操作。

## 使用Table Stream

### 创建Table Stream

您可以使用 `CREATE TABLE STREAM` 命令来创建 Table Stream。以下是一个示例：

```SQL
-- 创建测试表
CREATE TABLE data_change_test (id INT, name STRING);
INSERT INTO data_change_test VALUES (1, 'apple');
ALTER TABLE data_change_test SET PROPERTIES ('change_tracking' = 'true');
-- 在data_change_test上创建table stream，获取从当前时间开始插入的增量记录
CREATE TABLE STREAM data_change_test_stream ON TABLE data_change_test
WITH PROPERTIES('TABLE_STREAM_MODE' = 'APPEND_ONLY');

-- 插入测试数据
INSERT INTO data_change_test VALUES (2, 'banana');
SELECT * FROM data_change_test; -- 可以查到两条记录
SELECT * FROM data_change_test_stream; -- 查看stream可以查到一条记录，因为创建stream时指定的时间在id为1的记录之后
-- 使用dml语句消费记录
CREATE TABLE data_change_test_offset (id INT, name STRING);
INSERT INTO data_change_test_offset SELECT id, name FROM data_change_test_stream; -- 写入到表中
SELECT id, name FROM data_change_test_stream; -- 查询stream数据已经被消费
```

### 删除Table Stream

您可以使用 `DROP TABLE STREAM` 命令来删除 Table Stream。以下是一个示例：

```SQL
DROP TABLE STREAM IF EXISTS data_change_test_stream;
```

### Table Stream 捕获数据变化的时效性

Table Stream 根据对象的元数据修改提交时间来感知变化数据。具体时效性如下：

- **DML 方式修改数据**：在 DML 任务成功结束后，变化数据即可在 Table Stream 对象中可见。
- **批量导入（Bulkload）**：在批量导入任务成功结束后，变化数据即可在 Table Stream 对象中可见。
- **流式导入**：通过 Ingestion Service 流式 API 写入数据，默认 1 分钟提交变化，变化数据即可在 Table Stream 对象中可见。注：对于流式写入的目标表本身进行 SQL 查询时是实时可见的，这里仅约束了基于该目标表的 Table Stream 可见性的时效。
## 动态表与 Table Stream 的关系详解

在云器 Lakehouse 中，动态表（Dynamic Table）与 Table Stream 是两种相互关联且至关重要的功能，均聚焦于增量数据处理领域，但它们在具体用途及工作模式上存在显著差异。

### 一、动态表的定义与特点

动态表是云器 Lakehouse 特有的数据对象，具备以下关键特性：

* **增量计算能力**：能精准处理增量变化数据，拥有高效的增量刷新优化机制。
* **自动化处理**：用户仅需定义业务逻辑，无需明确指定增量处理细节（例如按分区对齐或使用最大时间戳等），系统将自动完成增量计算优化工作。
* **定期刷新**：支持设置刷新间隔，依据预设时间周期，从基表（Base Table）获取增量数据并执行计算任务。
* **工作原理**：以“基于历史 T0 时刻已算结果，融合 T0 至 T1 时刻增量计算，同时为 T2 及后续时刻计算做铺垫”的增量形态开展计算。

### 二、Table Stream 的定义与特点

TABLE STREAM 专注于捕获表的数据变化，特点如下：

* **变化数据捕获**：类似于数据库的 CDC（Change Data Capture）功能，全面记录表的 DML 更改操作，涵盖插入、更新与删除行为。
* **版本跟踪**：借助 Lakehouse Table 的多历史版本特性，可指定记录源表的特定版本（或最新版本）作为初始读取起点。
* **两种模式**：STANDARD 模式追踪所有 DML 变化；APPEND_ONLY 模式仅记录 INSERT 操作数据。
* **位点更新**：仅记录和维护源表数据版本位点，不存储实际数据，执行 DML 语句操作 Stream 时同步更新位点信息。

### 三、两者的关系与区别

#### （一）功能层次

* Table Stream 属于底层机制，核心任务是捕获表的变化数据。
* 动态表则是建立在 Table Stream 之类的底层功能之上的高级特性，侧重于利用增量计算实现数据转换与加工。

#### （二）数据处理方式

* TABLE STREAM 仅聚焦于变化数据的捕获，不涉及数据计算环节。
* 动态表会对捕获到的增量数据执行计算与转换操作，生成具有业务价值的结果。

#### （三）支持关系

* 动态表可借助 Table Stream 机制达成增量计算目标。
* 在云器 Lakehouse 体系中，允许在动态表基础上创建 Table Stream，由此构建起复杂且高效的增量数据处理链路。

#### （四）应用场景

* **Table Stream**：适用于单纯的变化数据捕获场景以及实时数据同步任务，例如在需要快速感知源表数据变动并实时传递至其他系统的场景中发挥关键作用。
* **动态表**：适用于对增量数据进行深度加工与转换的业务场景，比如在数据仓库中对每日新增订单数据进行多维度聚合计算，生成报表所需指标数据。

#### （五）底层实现

两者均依托于云器 Lakehouse 的 MetaService（元数据服务），该服务负责记录每张表的历史数据版本信息，为动态表和 Table Stream 的正常运行提供基础支撑。

### 四、实际应用示例

在实际业务场景中，动态表与 Table Stream 经常协同工作，形成完整且强大的增量数据处理方案：

* **ETL 数据处理链**：先在源表创建 Table Stream 捕获变化数据，随后利用动态表对这些变化数据执行转换与聚合操作，最终将处理后的结果准确写入目标表。
* **多级增量计算**：搭建一系列动态表，让每个动态表依次处理前一个表产生的增量数据，构建起高效的增量数据处理流水线，实现数据的逐级加工与提炼。
* **实时数据分析**：借助 Table Stream 实时捕获业务系统数据变动，再通过动态表开展实时分析与计算，为业务决策层及时提供准确且具时效性的数据洞察，助力企业敏捷决策。

