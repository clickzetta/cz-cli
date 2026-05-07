# 功能简介

Lakehouse 通过 flink-connector-lakehouse 插件，实现了与 Flink 的无缝对接，使得数据能够高效地写入 Lakehouse。该插件采用实时接口进行数据写入，确保了数据处理的时效性。

Lakehouse 提供了两种 Flink Connector 写入模式：igs-dynamic-table 和 igs-dynamic-table-append-only，以满足不同场景下的需求。

1. **igs-dynamic-table**：支持追加模式和Flink CDC场景。在这种模式下，当 Flink 作为数据源接入 CDC 日志时，如果源端包含 update、delete 及 insert 操作，并且 Lakehouse 服务端表设置了主键属性，使用 igs-dynamic-table 将触发数据的更新和删除操作。支持在Lakehouse中[主键表](primary-key.md)写入。
2. **igs-dynamic-table-append-only**：特别适用于不希望进行数据更新或删除的场景。即使在 Flink CDC 同步数据时，该模式也能确保数据仅进行追加操作，避免了不必要的数据变更。如果您的目标是避免数据的删除和更新，选择 igs-dynamic-table-append-only 将是一个更安全的选择。这样，您的数据将始终保持原始状态，不会被后续操作所影响。支持Lakehouse普通表写入。

| **类别** | **详情**            |
| ------ | ----------------- |
| 支持的类型  | 只支持结果表，不支持作为源表和维表 |
| 运行模式   | 流模式               |

# 版本兼容

| Flink Version       | Lakehouse Flink Connector Version |
| ------------------- | --------------------------------- |
| 1.14、1.15、1.17 | 请联系Lakehouse支持                    |

使用Flink CDC时推荐使用版本 >= 2.3。

# 使用

## Maven引入

Maven仓库坐标如下：

```Plain
<dependency>
<groupId>com.clickzetta</groupId> 
<artifactId>igs-flink-connector-${对应的flink版本}</artifactId>
<version>请联系Lakehouse支持</version>
</dependency>
```

## 使用方法

### TABLE API方式写入

```Java
-- First, define your data source
CREATE TABLE source_table (
  col1 INT,
  col2 INT,
  col3 VARCHAR
) WITH (
  'connector' = 'your-source-connector',
  'property1' = 'value1'
);

-- Second, define IGS table sink
CREATE TABLE mock_table (
  col1 INT,
  col2 INT,
  col3 VARCHAR
) WITH (
  'connector' = 'igs-dynamic-table',
  'curl' = 'jdbc:clickzetta://{instance-name}.{regin}.api.clickzetta.com/default?username=user&password=******&schema=public',
  'schema-name' = 'public',
  'table-name' = 'mock_table',
  'sink.parallelism' = '1',
  'properties' = 'authentication:true'
);

-- Third, execute the data transfer
INSERT INTO mock_table
SELECT * FROM source_table;
```

#### 通用配置选项

| 参数                               | 是否必须 | 默认值                                                                           | 说明                                                                                                                                                                                                                                                                                              |
| -------------------------------- | ---- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| connector                        | 是    | -                                                                             | igs-dynamic-table：支持追加模式和Flink CDC场景，一般Lakehouse是主键表。
igs-dynamic-table-append-only：只支持追加，Lakehouse是普通表。                                                                                                                                                                                         |
| curl                             | 是    | -                                                                             | Lakehouse JDBC连接地址，可以在工作空间页面获取到，如下图。注意如果用户名中含有=、@、&等字符需要进行URL编码，可以参考[编码网站](https://www.urlencoder.org/)，例如用户名或者密码是abc=123，编码后是abc%3D123。![](.topwrite/assets/image_1726133161757.png)                                                                                                          |
| schema-name                      | 是    | -                                                                             | 需要写入的Schema                                                                                                                                                                                                                                                                                     |
| table-name                       | 是    | -                                                                             | 需要写入的table                                                                                                                                                                                                                                                                                      |
| sink.parallelism                 | 是    | -                                                                             | 写入的并发度。如果目标表定义了主键（PK），则该并发度只能是1。                                                                                                                                                                                                                                                                      |
| properties                       | 是    | -                                                                             | `authentication:true`。如果您使用内网连接Lakehouse，请配置 `authentication:true,isInternal:true,isDirect:false`。                                                                                                                                                                                            |
| workspace                        | 否    | -                                                                             | 工作空间名称                                                                                                                                                                                                                                                                                          |
| flush.mode                       | 否    | *AUTO\_FLUSH\_BACKGROUND*                                                     | 数据刷写方式，目前支持：
- `AUTO_FLUSH_SYNC`：每次等待上次刷新完成后才进行下一步写入。
- `AUTO_FLUSH_BACKGROUND`：异步刷新，允许多个写入同时进行，不需要等待前一次写入完成。                                                                                                                                                                                             |
| showDebugLog                     | 否    | False                                                                         | 是否打开debug日志                                                                                                                                                                                                                                                                                     |
| mutation.flush.interval          | 否    | 10 \* 1000                                                                    | 当达到此时间限制时，数据将被实际 flush 提交至服务端。数据提交至服务端的条件是 `mutation.buffer.lines.num`、`mutation.buffer.space`、`mutation.flush.interval` 三个条件中任意一个优先达到。                                                                                                                                                              |
| mutation.buffer.space            | 否    | 5 \* 1024 \* 1024                                                             | buffer积攒大小限制，当达到此限制时，数据将被实际 flush 提交至服务端。如果一次导入的数据量达到 MB 级别，可以调大此参数以加快导入速度。数据提交至服务端的条件是 `mutation.buffer.lines.num`、`mutation.buffer.space`、`mutation.flush.interval` 三个条件中任意一个优先达到。                                                                                                                 |
| mutation.buffer.max.num          | 否    | 5                                                                             | 在数据提交过程中，`mutation.buffer.lines.num`指定了在达到一定数量的数据条目后进行发送，这是一个触发异步发送的阈值。而 `mutation.buffer.max.num` 则定义了可以同时存在的缓冲区（buffer）的最大数量。即使前一个缓冲区的数据还未完全写入，只要缓冲区的数量没有超过 `mutation.buffer.max.num` 指定的限制，就可以继续向新的缓冲区写入数据。这允许系统在处理和发送数据时实现更高的并发性，因为不必等待所有缓冲区都清空才能继续写入新数据。简而言之，`mutation.buffer.max.num` 相当于JDBC连接池。 |
| mutation.buffer.lines.num        | 否    | 100                                                                           | 每个buffer中的数据条数的积攒限制，积攒够会切换新的buffer继续积攒，直到 `mutation.buffer.max.num` 达到限制触发flush。                                                                                                                                                                                                                    |
| error.type.handler               | 否    | com.clickzetta.platform.client.api.ErrorTypeHandler$TerminateErrorTypeHandler | 默认值（可不设置，中断程序）：`com.clickzetta.platform.client.api.ErrorTypeHandler$TerminateErrorTypeHandler`
可选值（不中断程序）：`com.clickzetta.platform.client.api.ErrorTypeHandler$DefaultErrorTypeHandler`（潜在风险：容忍数据丢失）                                                                                                     |
| request.failed.retry.enable      | 否    | false                                                                         | 是否开启mutate失败重试机制。                                                                                                                                                                                                                                                                               |
| request.failed.retry.times       | 否    | 3                                                                             | mutate失败，重试最大次数。                                                                                                                                                                                                                                                                                |
| request.failed.retry.internal.ms | 否    | 1000                                                                          | 单位ms，失败重试间隔时间1000ms。                                                                                                                                                                                                                                                                            |
| request.failed.retry.status      | 否    | THROTTLED                                                                     | 可选值：THROTTLED,FAILED,NOT\_FOUND,INTERNAL\_ERROR,PRECHECK\_FAILED,STREAM\_UNAVAILABLE                                                                                                                                                                                                            |
| mapping.operation.type.to        | 是    | 无                                                                             | 如果设置为igs-dynamic-table-append-only时可以指定对于CDC的operater操作符落入LH Table中的字段名。必须是STRING类型。写入数据枚举值：INSERT｜UPDATE\_BEFORE｜UPDATE\_AFTER｜DELETE                                                                                                                                                          |

### 使用DataStream方式写入

```Java
// first. define your data source.
...
...

// second. define igs data sink.
// 权限相关的接入 请看接入说明
IgsWriterOptions writerOptions = IgsWriterOptions.builder()
    .streamUrl("jdbc:clickzetta://instance-name.region_id.api.clickzetta.com/default?username=user&password=******&schema=public")
    .withAuthenticate(true)
    .withFlushMode(FlushMode.AUTO_FLUSH_BACKGROUND)
    .withMutationBufferMaxNum(3)
    .withMutationBufferLinesNum(10)
    .build();

IgsSink<Row> sink = new IgsSink<>(
    writerOptions,
    IgsTableInfo.from("public", "mock_table"),
//字段必须写全，保持和目标表一致
    new RowOperationMapper(
        new String[]{"col1", "col2", "col3"},
        WriteOperation.ChangeType.INSERT)
);

// third. add sink to dataStream & execute.
dataStream.addSink(sink).name("mock-igs");
env.execute("Igs Mock Test");
```

* 参数意义及设置参考通用配置选项

## 使用限制

* 目前只支持结果表，不支持作为源表和维表

# 使用具体案例

## 实时数据同步：使用Flink CDC将MySQL数据写入Lakehouse主键表

### 概述

本文详细介绍了如何通过Lakehouse的flink connector使用igs-dynamic-table模式，实现MySQL数据库的变更数据捕获（CDC）日志实时同步到Lakehouse的主键表中。在igs-dynamic-table模式下，Lakehouse主键列的数据能够自动更新，确保数据的一致性和实时性。

### STEP 1:环境准备

* 使用IntelliJ IDEA作为开发工具，需具备Flink编程能力。
* 获取Lakehouse连接信息，可在Lakehouse Studio管理 -> 工作空间中查看JDBC连接串，如下：
![](../.topwrite/assets/image_1728887857029.png)

```SQL
jdbc:clickzetta://6861c888.cn-shanghai-alicloud.api.clickzetta.com/quickstart_ws?username=xxx&password=xxx&schema=public
```

* 本地搭建的Mysql数据库

* 下载Lakehouse提供的Flink Connector包（目前由Lakehouse支持提供下载包），下载完成后将JAR包打入到本地Maven仓库中，方便在Maven项目中引用和打包。

  * ```SQL
    mvn install:install-file -Dfile=igs-flink-connector-15-0.11.0-shaded.jar -DgroupId=com.clickzetta -DartifactId=igs-flink-connector-15 -Dversion=0.11.0 -Dpackaging=jar
    ```

* 修改pom.xml文件，添加如下依赖

  * ```XML
    <properties>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
        <flink.version>1.15.2</flink.version>
        <java.version>1.8</java.version>
        <scala.binary.version>2.12</scala.binary.version>
        <maven.compiler.source>${java.version}</maven.compiler.source>
        <maven.compiler.target>${java.version}</maven.compiler.target>
        <scope-flink>compile</scope-flink>
    </properties>
    <repositories>
        <repository>
            <id>apache.snapshots</id>
            <name>Apache Development Snapshot Repository</name>
            <url>https://repository.apache.org/content/repositories/snapshots/</url>
            <releases>
                <enabled>false</enabled>
            </releases>
            <snapshots>
                <enabled>true</enabled>
            </snapshots>
        </repository>
    </repositories>

    <dependencies>
        <dependency>
            <groupId>com.ververica</groupId>
            <artifactId>flink-connector-mysql-cdc</artifactId>
            <version>2.3.0</version>
        </dependency>
        <dependency>
            <groupId>com.clickzetta</groupId>
            <artifactId>igs-flink-connector-15</artifactId>
            <version>0.11.0</version>
            <exclusions>
                <exclusion>
                    <groupId>org.slf4j</groupId>
                    <artifactId>*</artifactId>
                </exclusion>
            </exclusions>
            <scope>${scope-flink}</scope>
        </dependency>
        <dependency>
            <groupId>org.slf4j</groupId>
            <artifactId>slf4j-log4j12</artifactId>
            <version>1.7.7</version>
            <scope>runtime</scope>
        </dependency>
        <dependency>
            <groupId>org.apache.flink</groupId>
            <artifactId>flink-table-planner_2.12</artifactId>
            <version>${flink.version}</version>
            <scope>${scope-flink}</scope>
        </dependency>
        <dependency>
            <groupId>org.apache.flink</groupId>
            <artifactId>flink-connector-base</artifactId>
            <version>${flink.version}</version>
            <scope>${scope-flink}</scope>
        </dependency>
        <dependency>
            <groupId>org.apache.flink</groupId>
            <artifactId>flink-runtime-web</artifactId>
            <version>${flink.version}</version>
            <scope>${scope-flink}</scope>
        </dependency>
        <dependency>
            <groupId>org.apache.flink</groupId>
            <artifactId>flink-table-api-java</artifactId>
            <version>${flink.version}</version>
            <scope>${scope-flink}</scope>
        </dependency>
        <dependency>
            <groupId>org.apache.flink</groupId>
            <artifactId>flink-table-api-java-bridge</artifactId>
            <version>${flink.version}</version>
            <scope>${scope-flink}</scope>
        </dependency>
        <dependency>
            <groupId>org.apache.flink</groupId>
            <artifactId>flink-table-common</artifactId>
            <version>${flink.version}</version>
            <scope>${scope-flink}</scope>
        </dependency>
        <dependency>
            <groupId>org.apache.flink</groupId>
            <artifactId>flink-streaming-java</artifactId>
            <version>${flink.version}</version>
            <scope>${scope-flink}</scope>
        </dependency>
        <dependency>
            <groupId>org.apache.flink</groupId>
            <artifactId>flink-clients</artifactId>
            <version>${flink.version}</version>
            <scope>${scope-flink}</scope>
        </dependency>
        <dependency>
            <groupId>org.apache.flink</groupId>
            <artifactId>flink-java</artifactId>
            <version>${flink.version}</version>
            <scope>${scope-flink}</scope>
        </dependency>
        <dependency>
            <groupId>org.apache.flink</groupId>
            <artifactId>flink-table-common</artifactId>
            <version>${flink.version}</version>
            <scope>${scope-flink}</scope>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-shade-plugin</artifactId>
                <version>3.2.4</version>
                <executions>
                    <execution>
                        <phase>package</phase>
                        <goals>
                            <goal>shade</goal>
                        </goals>
                        <configuration>
                            <createDependencyReducedPom>false</createDependencyReducedPom>
                        </configuration>
                    </execution>
                </executions>
            </plugin>
        </plugins>
    </build>
    ```

### STEP 2:在Mysql中创建表并插入测试数据

```SQL
create table people (id int primary key,name varchar(100));
insert into people values(1,'a'),(2,'b'),(3,'c');
```

### STEP 3:在Lakehouse中创建主键表

```SQL
create table people (id int,name string,primary key(id));
```

Lakehouse的**主键（PRIMARY KEY）** 用于确保表中每条记录的唯一性。在Lakehouse架构中，定义了主键的表在进行实时数据写入时，系统将自动根据主键值进行数据去重，一旦设置了主键，您将无法通过SQL语句执行插入、删除、更新操作，也不能添加或删除列。

### STEP 4:编写代码,并在IDEA启动任务

```SQL
import org.apache.flink.api.common.restartstrategy.RestartStrategies;
import org.apache.flink.api.common.time.Time;
import org.apache.flink.streaming.api.environment.StreamExecutionEnvironment;
import org.apache.flink.table.api.TableResult;
import org.apache.flink.table.api.bridge.java.StreamTableEnvironment;
import java.util.concurrent.ExecutionException;
public class MysqlCDCToLakehouse {
    public static void main(String[] args) throws ExecutionException, InterruptedException {

        StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment()
                .setParallelism(1);
        env.setRestartStrategy(RestartStrategies.fixedDelayRestart(100, Time.seconds(60)));
        //      env.enableCheckpointing(60000);
//
//
//        env.getCheckpointConfig().setCheckpointingMode(CheckpointingMode.EXACTLY_ONCE);
//
//        env.getCheckpointConfig().setMinPauseBetweenCheckpoints(1000);

// checkpoint 必须在 60s 内结束，否则被丢弃，默认是 10 分钟
//        env.getCheckpointConfig().setCheckpointTimeout(60000);
// 同一时间只能允许有一个 checkpoint
//        env.getCheckpointConfig().setMaxConcurrentCheckpoints(1);
// 最多允许 checkpoint 失败 3 次
//        env.getCheckpointConfig().setTolerableCheckpointFailureNumber(3);
// 当 Flink 任务取消时，保留外部保存的 checkpoint 信息
//        env.getCheckpointConfig().enableExternalizedCheckpoints(CheckpointConfig.ExternalizedCheckpointCleanup.RETAIN_ON_CANCELLATION);
        StreamTableEnvironment tableEnv = StreamTableEnvironment.create(env);
        String mysqlCdc ="create table mysql_people(\n" +
                "    id int,\n" +
                "    name string,\n" +
                "    primary key(id) NOT ENFORCED)\n" +
                "with(\n" +
                "'connector' = 'mysql-cdc',\n" +
                "'hostname' = 'localhost',\n" +
                "'port' = '3306',\n" +
                "'username' = 'xxx',\n" +
                "'password' = 'xxx',\n" +
                "'database-name' = 'xxxx',\n" +
                "'server-time-zone'='Asia/Shanghai',\n" +
                "'table-name' = 'people'\n" +
                ")";

        tableEnv.executeSql(mysqlCdc);

        // 字段个数需要保持和lakehouse表一致
        String lakehouseTable ="create table lakehouse_people(\n" +
                "    id int,\n" +
                "    name string,\n" +
                "    primary key(id) NOT ENFORCED)\n" +
                "with(\n" +
                "'connector'='igs-dynamic-table',\n" +
                "'curl'='jdbc:clickzetta://jnsxwfyr.cn-shanghai-alicloud.api.clickzetta.com/qingyun?username=xxx&password=xxx&schema=public',\n" +
                "'properties' = 'authentication:true',\n"+
                "'schema-name' = 'public',\n" +
                "'table-name' = 'people',\n" +
                "'sink.parallelism' = '1'\n" +
                ")\n";
        tableEnv.executeSql(lakehouseTable);

        TableResult tableResult = tableEnv.sqlQuery("select * from mysql_people").executeInsert("lakehouse_people");
        tableResult.await();

    }
}
```

### STEP 5:数据同步验证

* 启动完成后将会将mysql数据自动同步到lakehouse中，在Lakehouse中查询数据

```SQL
select * from people;
+----+------+
| id | name |
+----+------+
| 2  | b    |
| 3  | c    |
| 1  | a    |
+----+------+
```

* 在mysql更新一条数据

```SQL
update people set name='A' where id=1;
```

* 在Lakehouse中查询，则会保持和mysql数据一致

```SQL
select * from people;
+----+------+
| id | name |
+----+------+
| 2  | b    |
| 3  | c    |
| 1  | A    |
+----+------+
```

## 实时数据同步：使用Flink CDC将MySQL数据写入Lakehouse普通表中

### 概述

本文详细介绍了如何通过Lakehouse的flink connector使用igs-dynamic-table-append-only模式，实现MySQL数据库的变更数据捕获（CDC）日志实时同步到Lakehouse的普通表中。在igs-dynamic-table-append-only模式下，Lakehouse 将直接记录 CDC 原始日志，而不会更新Lakehouse中的数据。

### STEP 1:环境准备

* 使用IntelliJ IDEA作为开发工具，需具备Flink编程能力。
* 获取Lakehouse连接信息，可在Lakehouse Studio管理 -> 工作空间中查看JDBC连接串，并将JDBC协议替换为igs。如下修改为：
![](../.topwrite/assets/image_1728887857029.png)

```SQL
jdbc:clickzetta://6861c888.cn-shanghai-alicloud.api.clickzetta.com/quickstart_ws?username=xxx&password=xxx&schema=public
```

* 本地搭建的Mysql数据库

* 下载Lakehouse提供的Flink Connector包（目前由Lakehouse支持提供下载包），下载完成后将JAR包打入到本地Maven仓库中，方便在Maven项目中引用和打包。

  * ```SQL
    mvn install:install-file -Dfile=igs-flink-connector-15-0.11.0-shaded.jar -DgroupId=com.clickzetta -DartifactId=igs-flink-connector-15 -Dversion=0.11.0 -Dpackaging=jar
    ```

* 修改pom.xml文件，添加如下依赖

  * ```SQL
    <properties>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
        <flink.version>1.15.2</flink.version>
        <java.version>1.8</java.version>
        <scala.binary.version>2.12</scala.binary.version>
        <maven.compiler.source>${java.version}</maven.compiler.source>
        <maven.compiler.target>${java.version}</maven.compiler.target>
        <scope-flink>compile</scope-flink>
    </properties>
    <repositories>
        <repository>
            <id>apache.snapshots</id>
            <name>Apache Development Snapshot Repository</name>
            <url>https://repository.apache.org/content/repositories/snapshots/</url>
            <releases>
                <enabled>false</enabled>
            </releases>
            <snapshots>
                <enabled>true</enabled>
            </snapshots>
        </repository>
    </repositories>

    <dependencies>
        <dependency>
            <groupId>com.ververica</groupId>
            <artifactId>flink-connector-mysql-cdc</artifactId>
            <version>2.3.0</version>
        </dependency>
        <dependency>
            <groupId>com.clickzetta</groupId>
            <artifactId>igs-flink-connector-15</artifactId>
            <version>0.11.0</version>
            <exclusions>
                <exclusion>
                    <groupId>org.slf4j</groupId>
                    <artifactId>*</artifactId>
                </exclusion>
            </exclusions>
            <scope>${scope-flink}</scope>
        </dependency>
        <dependency>
            <groupId>org.slf4j</groupId>
            <artifactId>slf4j-log4j12</artifactId>
            <version>1.7.7</version>
            <scope>runtime</scope>
        </dependency>
        <dependency>
            <groupId>org.apache.flink</groupId>
            <artifactId>flink-table-planner_2.12</artifactId>
            <version>${flink.version}</version>
            <scope>${scope-flink}</scope>
        </dependency>
        <dependency>
            <groupId>org.apache.flink</groupId>
            <artifactId>flink-connector-base</artifactId>
            <version>${flink.version}</version>
            <scope>${scope-flink}</scope>
        </dependency>
        <dependency>
            <groupId>org.apache.flink</groupId>
            <artifactId>flink-runtime-web</artifactId>
            <version>${flink.version}</version>
            <scope>${scope-flink}</scope>
        </dependency>
        <dependency>
            <groupId>org.apache.flink</groupId>
            <artifactId>flink-table-api-java</artifactId>
            <version>${flink.version}</version>
            <scope>${scope-flink}</scope>
        </dependency>
        <dependency>
            <groupId>org.apache.flink</groupId>
            <artifactId>flink-table-api-java-bridge</artifactId>
            <version>${flink.version}</version>
            <scope>${scope-flink}</scope>
        </dependency>
        <dependency>
            <groupId>org.apache.flink</groupId>
            <artifactId>flink-table-common</artifactId>
            <version>${flink.version}</version>
            <scope>${scope-flink}</scope>
        </dependency>
        <dependency>
            <groupId>org.apache.flink</groupId>
            <artifactId>flink-streaming-java</artifactId>
            <version>${flink.version}</version>
            <scope>${scope-flink}</scope>
        </dependency>
        <dependency>
            <groupId>org.apache.flink</groupId>
            <artifactId>flink-clients</artifactId>
            <version>${flink.version}</version>
            <scope>${scope-flink}</scope>
        </dependency>
        <dependency>
            <groupId>org.apache.flink</groupId>
            <artifactId>flink-java</artifactId>
            <version>${flink.version}</version>
            <scope>${scope-flink}</scope>
        </dependency>
        <dependency>
            <groupId>org.apache.flink</groupId>
            <artifactId>flink-table-common</artifactId>
            <version>${flink.version}</version>
            <scope>${scope-flink}</scope>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-shade-plugin</artifactId>
                <version>3.2.4</version>
                <executions>
                    <execution>
                        <phase>package</phase>
                        <goals>
                            <goal>shade</goal>
                        </goals>
                        <configuration>
                            <createDependencyReducedPom>false</createDependencyReducedPom>
                        </configuration>
                    </execution>
                </executions>
            </plugin>
        </plugins>
    </build>
    ```

### STEP 2:在Mysql中创建表并插入测试数据

```SQL
create table people_append (id int primary key,name varchar(100));
insert into people_append values(1,'a'),(2,'b'),(3,'c');
```

### STEP 3:在Lakehouse中创建普通表

```SQL
create table people_append (id int,name string,source_operate string);
```

`source_operate` 字段用于记录 MySQL 中的日志操作。在 Lakehouse Flink Connector 中配置 `mapping.operation.type.to`，可以指定 CDC 的操作符落入 Lakehouse 表中的字段名。

### STEP 4:编写代码,并在IDEA启动任务

```SQL
import org.apache.flink.api.common.restartstrategy.RestartStrategies;
import org.apache.flink.api.common.time.Time;
import org.apache.flink.streaming.api.environment.StreamExecutionEnvironment;
import org.apache.flink.table.api.TableResult;
import org.apache.flink.table.api.bridge.java.StreamTableEnvironment;
import java.util.concurrent.ExecutionException;

public class MysqlAppendToLakehouse {
    public static void main(String[] args) throws ExecutionException, InterruptedException {

        StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment()
                .setParallelism(1);
        env.setRestartStrategy(RestartStrategies.fixedDelayRestart(100, Time.seconds(60)));
        //      env.enableCheckpointing(60000);
//
//
//        env.getCheckpointConfig().setCheckpointingMode(CheckpointingMode.EXACTLY_ONCE);
//
//        env.getCheckpointConfig().setMinPauseBetweenCheckpoints(1000);

// checkpoint 必须在 60s 内结束，否则被丢弃，默认是 10 分钟
//        env.getCheckpointConfig().setCheckpointTimeout(60000);
// 同一时间只能允许有一个 checkpoint
//        env.getCheckpointConfig().setMaxConcurrentCheckpoints(1);
// 最多允许 checkpoint 失败 3 次
//        env.getCheckpointConfig().setTolerableCheckpointFailureNumber(3);
// 当 Flink 任务取消时，保留外部保存的 checkpoint 信息
//        env.getCheckpointConfig().enableExternalizedCheckpoints(CheckpointConfig.ExternalizedCheckpointCleanup.RETAIN_ON_CANCELLATION);
        StreamTableEnvironment tableEnv = StreamTableEnvironment.create(env);
        String mysqlCdc ="create table mysql_people(\n" +
                "    id int,\n" +
                "    name string,\n" +
                "    primary key(id) NOT ENFORCED)\n" +
                "with(\n" +
                "'connector' = 'mysql-cdc',\n" +
                "'hostname' = 'localhost',\n" +
                "'port' = '3306',\n" +
                "'username' = 'root',\n" +
                "'password' = '123456',\n" +
                "'database-name' = 'mydb',\n" +
                "'server-time-zone'='Asia/Shanghai',\n" +
                "'table-name' = 'people_append'\n" +
                ")";

        tableEnv.executeSql(mysqlCdc);

        // second. define igs table sink.
        String lakehouseTable ="create table lakehouse_people(\n" +
                "    id int,\n" +
                "    name string,\n" +
                "    primary key(id) NOT ENFORCED)\n" +
                "with(\n" +
                "'connector'='igs-dynamic-table-append-only',\n" +
                "'curl'='jdbc:clickzetta://jnsxwfyr.cn-shanghai-alicloud.api.clickzetta.com/qingyun?username=uat_test&password=Abcd123456&schema=public',\n" +
                "'properties' = 'authentication:true',\n"+
                "'schema-name' = 'public',\n" +
                "'table-name' = 'people_append',\n" +
                "'mapping.operation.type.to' = 'source_operate',\n" +
                "'sink.parallelism' = '1'\n" +
                ")\n";
        tableEnv.executeSql(lakehouseTable);

        TableResult tableResult = tableEnv.sqlQuery("select * from mysql_people").executeInsert("lakehouse_people");
        tableResult.await();

    }
}
```

### STEP 5:数据同步验证

* 启动完成后将会将mysql数据自动同步到lakehouse中，在Lakehouse中查询数据

```SQL
select * from people;
+----+------+
| id | name |
+----+------+
| 2  | b    |
| 3  | c    |
| 1  | a    |
+----+------+
```

* 在mysql更新一条数据

```SQL
update people set name='A' where id=1;
```

* 在Lakehouse中查询，则会保持记录mysql的所有操作

```SQL
+----+------+----------------+
| id | name | source_operate |
+----+------+----------------+
| 1  | a    | INSERT         |
| 2  | b    | INSERT         |
| 3  | c    | INSERT         |
| 1  | a    | UPDATE_BEFORE  |
| 1  | A    | UPDATE_AFTER   |
+----+------+----------------+
```

^
