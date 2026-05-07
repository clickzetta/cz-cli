## 实时写入原理

实时写入Lakehouse的SDK是一种高效的数据流处理工具，它允许用户将数据实时地上传并存储到Lakehouse中。以下是实时写入的工作原理：

1. **SDK上传数据**：用户通过SDK将数据实时上传到Lakehouse的Ingestion Service。
2. **Ingestion Service处理**：Ingestion Service接收到数据后，直接将数据写入到Lakehouse的表中，此时数据以临时中间文件的形式存储，这个阶段称为**混合表**。
3. **查询实时数据**：在数据提交之前，用户即可查询（select）到这些实时写入的新数据，但这些数据对于table stream、materialized view和dynamic table来说是不可见的。
4. **数据提交**：新写入的数据会在大约一分钟后自动提交，提交后，table stream、materialized view和dynamic table都能够读取这部分数据。
5. **混合表变成普通表**：在数据提交后，后台进程会将混合表合并变成普通表，合并完成后用户可以执行更新操作（update/merge/delete）。

## 适用场景

实时写入Lakehouse的SDK适用于以下场景：

* **短间隔数据导入**：如果您的应用场景要求在非常短的时间间隔内（如5分钟或更短）导入数据，实时写入SDK可以满足您的需求。
* **频繁小量数据提交**：对于需要频繁提交数据，但每次提交的数据量不大的情况，实时写入SDK提供了一个高效的解决方案。
* **实时数据分析**：实时写入SDK适合需要对数据进行即时分析和响应的应用，例如实时监控、事件追踪和实时报告等。

## 注意事项

* 实时写入的数据可以秒级查询。
* 实时写入数据目前只能通过内部提供的 Flink Connector 中支持 schema change 的 sink 算子（单并发）来实现实时的表结构变化感知。在其他场景下进行表结构更改时，需要先停止实时写入任务，然后在表结构变更后一段时间（大约90分钟）后，重新启动任务。
* table stream、materialized view 和 dynamic table 只能显示已经提交的数据。实时任务写入的数据需要等待 1 分钟才能确认，因此 table stream 也需要等待 1 分钟才能看到。

## 通过客户端创建实时数据流

要创建实时数据流，首先需要使用 Lakehouse 客户端（client）：

```java
RowStream stream = client.newRealtimeStreamBuilder()
.operate(RowStream.RealTimeOperate.APPEND_ONLY)
.options(options)
.schema(schema)
.table(table)
.build();
// 关闭流，释放资源
stream.close();
```

operate：传入一个枚举值，实时接口支持 RowStream.RealTimeOperate.APPEND\_ONLY 和 RowStream.RealTimeOperate.CDC。
options：用于传入实时写入流的参数，具体见下文的 options 说明。

## 选项（Options）

可以将以下选项（options）传入到实时数据流中，用于控制写入数据的行为。这些参数均为选填，推荐使用默认参数。

```SQL
Options options = Options.builder()
.withFlushMode(FlushMode.AUTO_FLUSH_BACKGROUND)
            .withMutationBufferLinesNum(50000)
            .withMutationBufferMaxNum(50)
            .withMutationBufferSpace(20 * 1024 * 1024)
            .withFlushInterval(10 * 1000)
            .withRequestFailedRetryEnable(true)
            .withRequestFailedRetryTimes(5)
            .withRequestFailedRetryInternalMs(5 * 1000)
            .withRequestFailedRetryLogDebugEnable(true)
            .withRequestFailedRetryStatus(
                    RegisterStatus.RetryStatus.THROTTLED,
                    RegisterStatus.RetryStatus.INTERNAL_ERROR,
                    RegisterStatus.RetryStatus.FAILED,
                    RegisterStatus.RetryStatus.PRECHECK_FAILED)
            .build();
```

**参数说明**

| 类别 | 参数 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| 写入性能相关参数 | withFlushMode | FlushMode.AUTO_FLUSH_BACKGROUND | 数据刷写方式，目前支持：<br>FlushMode.AUTO_FLUSH_SYNC：每次等待上次刷新完成后才进行下一步写入。<br>FlushMode.AUTO_FLUSH_BACKGROUND：异步刷新，允许多个写入同时进行，不需要等待前一次写入完成。 |
| 写入性能相关参数 | withMutationBufferLinesNum | 100 | 每个 buffer 中的数据条数的积攒限制，积攒达到后则会发送至服务端。当达到此限制时，数据将被实际 flush 提交至服务端。如果一次导入的数据量达到 MB 级别，可以调大此参数以加快导入速度。数据提交至服务端的条件是 MutationBufferLinesNum 或 withFlushInterval 中任意一个优先达到。 |
|          | withMutationBufferMaxNum             | 5                                    | 在数据提交过程中，`withMutationBufferLinesNum` 指定了在达到一定数量的数据条目后进行发送，这是一个触发异步发送的阈值。而 `withMutationBufferMaxNum` 则定义了可以同时存在的缓冲区（buffer）的最大数量。即使前一个缓冲区的数据还未完全写入，只要缓冲区的数量没有超过 `withMutationBufferMaxNum` 指定的限制，就可以继续向新的缓冲区写入数据。这允许系统在处理和发送数据时实现更高的并发性，因为不必等待所有缓冲区都清空才能继续写入新数据。简而言之，`withMutationBufferMaxNum` 相当于jdbc连接池 |
| 写入性能相关参数 | withMutationBufferSpace | 5 * 1024 * 1024 (5MB) | 当达到此限制时，数据将被实际 flush 提交至服务端。如果一次导入的数据量达到 MB 级别，可以调大此参数以加快导入速度。数据提交至服务端的条件是 withMutationBufferSpace 或 withMutationBufferLinesNum 中任意一个优先达到。 |
| 写入性能相关参数 | withFlushInterval | 10 * 1000 (10秒) | 当达到此时间限制时，数据将被实际 flush 提交至服务端。数据提交至服务端的条件是 withMutationBufferSpace 或 withMutationBufferLinesNum 中任意一个优先达到。 |
| 重试机制相关参数 | withRequestFailedRetryEnable | FALSE | 是否开启 mutate 失败重试机制。取值为 TRUE 或 FALSE。 |
|          | withRequestFailedRetryTimes          | 5                                    | mutate 失败，重试最大次数。                                                                                                                                                                                                                                                                                           |
| 重试机制相关参数 | withRequestFailedRetryInternalMs | 5000 (5秒) | 失败重试间隔时间，单位毫秒（ms）。 |
|          | withRequestFailedRetryLogDebugEnable | FALSE                                | 是否开启debug日志                                                                                                                                                                                                                                                                                                 |
|          | withRequestFailedRetryStatus         | RegisterStatus.RetryStatus.THROTTLED | 根据哪种错误原因进行重试，默认是RegisterStatus.RetryStatus.THROTTLED。多个值使用逗号隔开 取值 RegisterStatus.RetryStatus.THROTTLED RegisterStatus.RetryStatus.INTERNAL\_ERROR RegisterStatus.RetryStatus.FAILED RegisterStatus.RetryStatus.PRECHECK\_FAILED                                                                             |

## 写入数据（Row）

通过 `stream.createRow` 方法创建具体的数据对象（Row），并通过 `row.setValue` 方法将数据封装到 Row 对象中。

**Row** **row** = stream.createRow(Stream.Operator.INSERT);

row\.setValue("id", t);

row\.setValue("name", String.valueOf(t));

stream.apply(row);

* 当 Stream 创建为 `RowStream.RealTimeOperate.APPEND_ONLY` 时，仅能创建 `Stream.Operator.INSERT` 类型的 Row。

* 当 Stream 创建为 `RowStream.RealTimeOperate.CDC` 时，以下所有 Row 类型均可使用：

  * `Stream.Operator.INSERT`：插入行，如果目标行已存在则报错。
  * `Stream.Operator.DELETE`：删除行，如果目标行不存在则报错。
  * `Stream.Operator.UPDATE`：更新行，如果目标行不存在则报错。
  * `Stream.Operator.UPSERT`：插入行，如果目标行已存在则更新该行。
  * `Stream.Operator.INSERT_IGNORE`：插入行，如果目标行已存在则自动忽略。

## 数据提交到服务端

通过调用 `((RealtimeStream)stream).flush()` 方法，数据会提交到服务端。如果没有调用该方法，则数据根据 withMutationBufferSpace、withMutationBufferLinesNum 或 withFlushInterval 中任意一个条件优先达到时，数据将被发送到服务端。

# 具体案例

## 普通表追加写入

```Java
// 建表 create table ingest_stream(id int,name string);
import com.clickzetta.client.ClickZettaClient;
import com.clickzetta.client.RowStream;
import com.clickzetta.platform.client.api.Options;
import com.clickzetta.platform.client.api.Row;
import com.clickzetta.platform.client.api.Stream;

public class RealtimeStreamDemo {
    public static void main(String[] args) throws Exception {
        if (args.length != 5) {
            System.out.println("input arguments: jdbcUrl, username, password");
            System.exit(1);
        }
        String jdbcUrl = args[0];
        String username = args[1];
        String password = args[2];
        String schema = args[3];
        String table = args[4];
        ClickZettaClient client = ClickZettaClient.newBuilder().url(jdbcUrl).username(username).password(password).build();
        Options options = Options.builder()
            //指定刷新方式可选，默认是异步刷新
            .withFlushMode(FlushMode.AUTO_FLUSH_BACKGROUND)
           //每个buffer中的条数
            .withMutationBufferLinesNum(50000)
            .withMutationBufferMaxNum(50)
            //buffer中最大大小，达到改值时则提交到服务端。
            .withMutationBufferSpace(20 * 1024 * 1024)
            //提交数据置服务端间隔，达到改值时则提交到服务端。
            .withFlushInterval(10 * 1000)
            //是否开启出错重试，默认值是false
            .withRequestFailedRetryEnable(true)
            //出错重试次数
            .withRequestFailedRetryTimes(5)
            //出错重试间隔
            .withRequestFailedRetryInternalMs(5 * 1000)
            //是否开启degug日志，默认false
            .withRequestFailedRetryLogDebugEnable(false)
            .build();

        RowStream stream = client.newRealtimeStreamBuilder()
                .operate(RowStream.RealTimeOperate.APPEND_ONLY)
                .options(options)
                .schema(schema)
                .table(table)
                .build();

        for (int t = 0; t < 1000; t++) {
            Row row = stream.createRow(Stream.Operator.INSERT);
            row.setValue("id",t);
            row.setValue("name", String.valueOf(t));
            stream.apply(row);
        }
        // 调用 flush 之后数据会提交值服务端，如果不调用则根据上面刷新方式指定的参数写入。比如withFlushInterval
        ((RealtimeStream)stream).flush();
        // 调用 stream close接口，close 时会隐含执行 flush
        stream.close();
        client.close();
    }
}
```

## 写入vector类型

创建表

```
CREATE TABLE test\_vector (
vec1 vector(float, 512), -- 指定元素类型为float，维度为512
vec2 vector(512), -- 默认元素类型为float，维度为512
vec3 vector(tinyint, 128) -- 指定元素类型为tinyint，维度为128

);
```

使用Java写入

```Java

import com.clickzetta.client.ClickZettaClient;
import com.clickzetta.client.RowStream;
import com.clickzetta.platform.client.api.Options;
import com.clickzetta.platform.client.api.Row;
import com.clickzetta.platform.client.api.Stream;

public class RealtimeStreamDemo {
    public static void main(String[] args) throws Exception {
        if (args.length != 5) {
            System.out.println("input arguments: jdbcUrl, username, password");
            System.exit(1);
        }
        String jdbcUrl = args[0];
        String username = args[1];
        String password = args[2];
        String schema = args[3];
        String table = args[4];
        ClickZettaClient client = ClickZettaClient.newBuilder().url(jdbcUrl).username(username).password(password).build();
        Options options = Options.builder().withMutationBufferLinesNum(10).build();
        realtimeStream = client.newRealtimeStreamBuilder()
                .operate(RowStream.RealTimeOperate.APPEND_ONLY)
                .options(options)
                .schema(schema)
                .table(table)
                .build();

        // 准备数据
        float[] vec1 = new float[512];
        float[] vec2 = new float[512];
        byte[] vec3 = new byte[128]; // tinyint 在Java中可以用 byte 表示       
        // 初始化数据（这里只是示例，实际数据需要根据需求填充）
        for (int i = 0; i < 512; i++) {
            vec1[i] = (float) Math.random();
            vec2[i] = (float) Math.random();
        }
        for (int i = 0; i < 128; i++) {
            vec3[i] = (byte) (Math.random() * 256);
        }
        row = realtimeStream.createRow(Stream.Operator.INSERT);
        row.setValue("vec1",vec1);
        row.setValue("vec2",vec1);
        row.setValue("vec3",vec3);
        
        realtimeStream.apply(row);
        realtimeStream.flush();
        // 调用 stream close接口，close 时会隐含执行 flush
        realtimeStream.close();
        client.close();
    }
}
```

## CDC实时写入

Lakehouse支持数据库的CDC（Change Data Capture）功能，以流的方式将数据写入到Lakehouse表中，并实时更新表数据。同步过程通过RealtimeStream实时更新插入和删除行操作来实现。同时，支持使用Flink connector和IGS SDK进行数据写入。在创建表时，需要设置主键以确保数据的唯一性和一致性。

### 创建表

在创建Lakehouse表时，需要指定主键。CDC写入会根据主键进行数据去重，以确保数据的准确性。虽然创建的主键表支持SQL操作，建议通过实时写入流进行数据写入。以下是一个创建表的示例：

```sql
CREATE TABLE igs_test_upsert (
    id INT PRIMARY KEY,
    event VARCHAR(100),
    event_time STRING
);
```

### IGS SDK实时写入流

#### 创建实时写入流

使用IGS SDK创建实时写入流，需要指定操作类型（CDC）和相关选项。以下是一个创建实时写入流的示例：

```java
RowStream stream = client.newRealtimeStreamBuilder()
    .operate(RowStream.RealTimeOperate.CDC)
    .options(options)
    .schema(schema)
    .table(table)
    .build(); // 关闭流，释放流资源，必须调用
stream.close();
```

#### 指定操作类型

根据需求，可以指定不同的操作类型：

* `Stream.Operator.UPSERT`：插入或更新行。如果目标行不存在，则插入；如果已存在，则更新。
* `Stream.Operator.DELETE_IGNORE`：删除行。如果目标行不存在，则自动忽略。

#### 使用原生Java Sdk写入

```java
Row row = stream.createRow(Stream.Operator.UPSERT); // 插入或更新行
Row rowToDelete = stream.createRow(Stream.Operator.DELETE_IGNORE); // 删除行
```

### 使用Lakehouse实时同步功能写入

参考文档[多表实时同步](../realtime_sync.md)

### 使用FLINK CONNECTOR写入

Flink connector是基于RealtimeStream SDK封装的，用于实现实时数据同步。查看[Flink Connector](../flink-write-connector.md)

