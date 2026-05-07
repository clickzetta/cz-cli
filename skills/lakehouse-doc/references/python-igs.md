## ClickZetta Lakehouse Python SDK 实时写入

## 安装

1. 删除旧版本依赖

如果安装过旧版本的sdk，先卸载旧版本的 clickzetta-connector-python 包 和 clickzetta-sqlalchemy 包

```shell
pip uninstall clickzetta-connector clickzetta-sqlalchemy clickzetta-ingestion-python clickzetta-ingestion-python-v2 -y
```

2. 安装 clickzetta-connector，Python版本要求 3.7 以上：

```Bash
pip install clickzetta-connector
```

## **实时写入原理**

实时写入 Lakehouse 的Python SDK是一种高效的数据流处理工具，它允许用户将数据实时地上传并存储到Lakehouse中。以下是实时写入的工作原理：

1. SDK上传数据 ：用户通过Python SDK将数据实时上传到Lakehouse的Ingestion Service。
2. Ingestion Service处理 ：Ingestion Service接收到数据后，直接将数据写入到Lakehouse的表中，此时数据以临时中间文件的形式存储，这个阶段称为 混合表 。
3. 查询实时数据 ：在数据提交之前，用户即可查询（select）到这些实时写入的新数据，但这些数据对于table stream、materialized view和dynamic table来说是不可见的。
4. 数据提交 ：新写入的数据会在大约一分钟后自动提交，提交后，table stream、materialized view和dynamic table都能够读取这部分数据。
5. 混合表变成普通表 ：在数据提交后，后台进程会将混合表合并变成普通表，合并完成后用户可以执行更新操作（update\merge\delete）。

## **适用场景**

实时写入 Lakehouse 的 Python SDK 适用于以下场景：

* 短间隔数据导入 ：如果您的应用场景要求在非常短的时间间隔内（如5分钟或更短）导入数据，实时写入SDK可以满足您的需求。
* 频繁小量数据提交 ：对于需要频繁提交数据，但每次提交的数据量不大的情况，实时写入SDK提供了一个高效的解决方案。
* 实时数据分析 ：实时写入SDK适合需要对数据进行即时分析和响应的应用，例如实时监控、事件追踪和实时报告等。

## **注意事项**

* 实时写入的数据可以秒级查询。
* 实时写入数据目前只能通过内部提供的 Flink Connector 中支持 schema change 的 sink 算子（单并发）来实现实时的表结构变化感知。在其他场景下进行表结构更改时，需要先停止实时写入任务，然后在表结构变更后一段时间（大约90分钟）后，重新启动任务。
* table stream、materialized view 和 dynamic table 只能显示已经提交的数据。实时任务写入的数据需要等待 1 分钟才能确认，因此 table stream 也需要等待 1 分钟才能看到。

## **数据类型支持**

Lakehouse Python SDK支持以下数据类型映射：

| SQL数据类型               | Python内部数据结构                   |
| --------------------- | ------------------------------ |
| BOOLEAN               | bool                           |
| STRING / JSON         | str                            |
| CHAR(n) / VARCHAR(n)  | str(超限写入将截断)                   |
| BINARY                | bytes                          |
| DECIMAL               | Decimal                        |
| INT8                  | int                            |
| INT16                 | int                            |
| INT32                 | int                            |
| INT64                 | int                            |
| FLOAT                 | float                          |
| DOUBLE                | float                          |
| DATE                  | date                           |
| TIMESTAMP\_LTZ        | datetime(tz=timezone)          |
| TIMESTAMP\_NTZ        | datetime                       |
| INTERVAL\_DAY\_TIME   | interval\_day\_time            |
| INTERVAL\_YEAR\_MONTH | -                              |
| ARRAY                 | list                           |
| MAP                   | map                            |
| STRUCT                | json or collections.namedtuple |

## **通过客户端创建实时数据流**

要创建实时数据流，首先需要使用 Lakehouse 客户端连接：

```Python
from clickzetta.connector.v0.connection import connect
from clickzetta.connector.v0.enums import RealtimeOperation
from clickzetta_ingestion.realtime.realtime_options import RealtimeOptionsBuilder, FlushMode
from clickzetta_ingestion.realtime.arrow_stream import RowOperator


# 创建连接
with connect(username='your_username',
             password='your_password',
             service='your_service_endpoint',
             instance='your_instance',
             workspace='your_workspace',
             schema='your_schema',
             vcluster='your_vcluster') as conn:
    
    # 创建实时数据流
    stream = conn.get_realtime_stream(
        schema="your_schema",
        table="your_table",
        operate=RealtimeOperation.APPEND_ONLY,  # 普通表使用APPEND_ONLY
        options=RealtimeOptionsBuilder().with_flush_mode(FlushMode.AUTO_FLUSH_BACKGROUND).build()
    )
    
    # 使用完毕后关闭流
    stream.close()
```

参数说明：

* operate : 传入一个枚举值，实时接口支持 RealtimeOperation.APPEND\_ONLY 和 RealtimeOperation.CDC

  * 普通表使用 RealtimeOperation.APPEND\_ONLY
  * 主键表必须使用 RealtimeOperation.CDC

* options : 用于传入实时写入流的参数，详见下文的选项说明

## **选项（Options**）

在Python SDK中，可以通过`RealtimeOptionsBuilder`类来配置实时写入流的参数。这些参数均为选填，推荐使用默认参数。

```Python
from clickzetta.ingestion.realtime.realtime_options import RealtimeOptionsBuilder, FlushMode, RetryStatus

options = RealtimeOptionsBuilder()\
        .with_flush_mode(FlushMode.AUTO_FLUSH_BACKGROUND) \
        .with_mutation_buffer_lines_num(50000) \
        .with_mutation_buffer_max_num(50) \
        .with_mutation_buffer_space(20 * 1024 * 1024) \
        .with_flush_interval(10 * 1000) \
        .with_request_failed_retry_enable(True) \
        .with_request_failed_retry_times(5) \
        .with_request_failed_retry_internal_ms(5 * 1000) \
        .with_request_failed_retry_log_debug_enable(True) \
        .with_request_failed_retry_status([
        RetryStatus.THROTTLED,
        RetryStatus.INTERNAL_ERROR,
        RetryStatus.FAILED,
        RetryStatus.PRECHECK_FAILED]) \
        .build()
```

**刷写控制**

| 参数名               | 默认值                     | 说明                                                                                                                                           |
| ----------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| with\_flush\_mode | AUTO\_FLUSH\_BACKGROUND | 数据刷写策略，可选： - AUTO\_FLUSH\_SYNC：同步刷写（阻塞式，保证顺序） - AUTO\_FLUSH\_BACKGROUND：异步刷写（高吞吐） - MANUAL\_FLUSH：手动触发刷写 ⚠️ 主键表限制：PK表强制使用AUTO\_FLUSH\_SYNC模式 |

**缓冲区配置**

| 参数名                                | 默认值               | 单位 | 说明                              |
| ---------------------------------- | ----------------- | -- | ------------------------------- |
| with\_mutation\_buffer\_lines\_num | 1000              | 条  | 行数阈值：单个缓冲区最大行数，达到后触发刷写          |
| with\_mutation\_buffer\_space      | 10MB (1010241024) | 字节 | 空间阈值：单个缓冲区最大内存占用，与行数阈值任一达到即触发刷写 |
| with\_mutation\_buffer\_max\_num   | 50                | 个  | 缓冲池容量：允许同时存在的缓冲区数量（类似连接池机制）     |

**定时刷写**

| 参数名                   | 默认值 | 说明                   |
| --------------------- | --- | -------------------- |
| with\_flush\_interval | 10秒 | 最大延迟：缓冲区未满时强制刷写的等待时间 |

**重试机制参数组**

| 参数名                                        | 默认值    | 说明         |
| ------------------------------------------ | ------ | ---------- |
| with\_request\_failed\_retry\_enable       | TRUE   | 是否启用失败重试机制 |
| with\_request\_failed\_retry\_times        | 5      | 单次操作最大重试次数 |
| with\_request\_failed\_retry\_internal\_ms | 5000ms | 重试间隔时间（毫秒） |

**高级配置**

| 参数名                                              | 默认值                                               | 说明                                                                                   |
| ------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| with\_request\_failed\_retry\_status             | THROTTLED,INTERNAL\_ERROR,FAILED,PRECHECK\_FAILED | 重试触发条件： - THROTTLED：流控 - INTERNAL\_ERROR：服务端错误 - FAILED：常规失败 - PRECHECK\_FAILED：预检失败 |
| with\_request\_failed\_retry\_log\_debug\_enable | TRUE                                              | 是否打印详细重试日志（DEBUG级别）                                                                  |

## 写入数据（Row）

通过`stream.create_row`方法创建具体的数据对象（Row），并通过`row.set_value`方法将数据封装到Row对象中。

```Python
# 创建一行数据
row = stream.create_row(RowOperator.INSERT)  # 普通表使用INSERT

# 设置字段值
row.set_value("id", 1)
row.set_value("name", "test_name")

# 应用行数据到流中
stream.apply(row)
```

**Row类型说明**：

* 当Stream创建为`RealtimeOperation.APPEND_ONLY`时，仅能创建`RowOperator.INSERT`类型的Row。
* 当Stream创建为`RealtimeOperation.CDC`时，可以使用以下Row类型：
  * `RowOperator.UPSERT`：插入行，如果目标行已存在则更新该行。
  * `RowOperator.DELETE_IGNORE`：删除行，如果目标行不存在则自动忽略。

**注意**：主键表(PK表)必须使用CDC模式，且只能使用UPSERT和DELETE\_IGNORE操作类型。

## 数据提交到服务端

通过调用`stream.flush()`方法，数据会立即提交到服务端。如果没有显式调用此方法，数据会根据以下条件之一被自动提交：

1. 达到`with_mutation_buffer_space`设置的缓冲区大小
2. 达到`with_mutation_buffer_lines_num`设置的行数
3. 达到`with_flush_interval`设置的时间间隔

## 具体案例

### 主键表（PK表）写入完整示例

```Python
from clickzetta.connector.v0.connection import connect
from clickzetta.connector.v0.enums import RealtimeOperation
from clickzetta_ingestion.realtime.arrow_stream import RowOperator
from clickzetta_ingestion.realtime.realtime_options import RealtimeOptionsBuilder, FlushMode

with connect(username='your_username',
             password='your_password',
             service='your_service_endpoint',
             instance='your_instance',
             workspace='your_workspace',
             schema='your_schema',
             vcluster='default') as conn:
    
    # 创建主键表
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE test_pk (
        id STRING NOT NULL PRIMARY KEY,
        name STRING,
        age INT
    )
    """)
    
    # 创建实时数据流 - 主键表必须使用CDC
    stream = conn.get_realtime_stream(
        schema=conn.get_schema(),
        table="test_pk",
        operate=RealtimeOperation.CDC,
        options=RealtimeOptionsBuilder().with_flush_mode(FlushMode.AUTO_FLUSH_SYNC).build()
    )
    
    # 写入数据 - 主键表使用UPSERT
    for i in range(10):
        row = stream.create_row(RowOperator.UPSERT)
        row.set_value('id', f"id_{i}")
        row.set_value('name', f"user_{i}")
        row.set_value('age', 20 + i)
        stream.apply(row)
    
    # 更新数据 - 主键表使用UPSERT
    for i in range(5):
        row = stream.create_row(RowOperator.UPSERT)
        row.set_value('id', f"id_{i}")
        row.set_value('name', f"updated_user_{i}")
        row.set_value('age', 30 + i)
        stream.apply(row)
    
    # 删除数据 - 主键表使用DELETE_IGNORE
    for i in range(2):
        row = stream.create_row(RowOperator.DELETE_IGNORE)
        row.set_value('id', f"id_{i}")
        stream.apply(row)
    
    # 关闭流
    stream.close()
    
    # 验证结果
    cursor.execute("SELECT COUNT(*) FROM test_pk")
    count = cursor.fetchone()[0]
    print(f"剩余记录数: {count}")  # 应该是8条记录(10-2)
```

## 常见问题与解决方案

### 1. 主键表写入失败

**问题**: 向主键表写入数据时出现错误。

**解决方案**:

* 确保使用了正确的操作类型：主键表必须使用`RealtimeOperation.CDC`模式，且只能使用`RowOperator.UPSERT`和`RowOperator.DELETE_IGNORE`操作。
* 确保主键字段已正确设置值。
* 主键表不支持`FlushMode.AUTO_FLUSH_BACKGROUND`，会自动重置为`FlushMode.AUTO_FLUSH_SYNC`。
* 分区列要求是primary key的子集。

### **2. 内存占用过高**

**问题**: 写入大量数据时内存占用过高。

**解决方案**:

* 减小`with_mutation_buffer_lines_num`和`with_mutation_buffer_space`参数值。
* 定期调用`stream.flush()`手动刷新数据，并尽量避免 flush 过于频繁，会导致大量小文件产生。
* 考虑分批写入数据而不是一次性写入大量数据。

## 总结

ClickZetta Python SDK的实时写入功能提供了高效、灵活的数据写入方式，支持各种数据类型和操作模式。通过合理配置参数，可以根据不同场景优化写入性能。

对于主键表和普通表，需要使用不同的操作模式和行操作类型。主键表必须使用CDC模式，且只能使用UPSERT和DELETE\_IGNORE操作；普通表通常使用APPEND\_ONLY模式和INSERT操作。
