# 使用 Java SDK 读取 Kafka 数据并实时上传

本文档详细介绍了如何利用 Java SDK 将数据实时写入 Lakehouse，适用于需要实时数据流处理的业务场景，特别适合熟悉 Java 的开发人员。本案例以 Kafka 为数据源，展示如何读取 Kafka 数据并通过 Lakehouse 的 RealtimeStream 接口进行写入。如果您对读取 Kafka 数据没有特殊要求，推荐使用 Lakehouse Studio 数据集成。Lakehouse Studio 数据集成提供了可视化监控，提高了数据管理的透明度。

# 参考文档

[Java SDK实时上传数据](java_reference/realtime-upload.md)

## 应用场景

* 适用于需要实时处理数据流的业务场景。
* 适合熟悉Java并需要自定义逻辑处理的开发人员。

## 使用限制

* 实时写入的数据可以秒级查询。
* 表结构变更时，需停止实时写入任务，并在变更后约 90 分钟重新启动。
* table stream、materialized view 和 dynamic table 只能显示已经提交的数据。实时任务写入的数据需要等待约 1 分钟才能确认，因此 table stream 也需要等待约 1 分钟才能看到。

# 使用案例

本案例使用 Kafka 的 Java 客户端读取数据，并调用 Lakehouse 的 RealtimeStream 接口进行写入。

## 环境准备

* 拥有 Kafka 集群（本次演示使用的是本地搭建的 Kafka），并创建 Topic `lakehouse-stream`。

  * ```SQL
    bin/kafka-topics.sh --create --topic lakehouse-stream --bootstrap-server localhost:9092
    ```

* 数据格式为 JSON，使用 Kafka 命令行生产数据：

  * ```SQL
    {"id": 1, "name": "张三", "email": "zhangsan@example.com", "isActive": true}
    --kafka生产者命令行
    bin/kafka-console-producer.sh --topic lakehouse-stream --bootstrap-server localhost:9092
    ```

* 在 Lakehouse 上创建表

  * ```SQL
    create table realtime_stream(id int,event json);
    ```

## 使用Java代码开发

### Maven依赖

在项目的 `pom.xml` 文件中添加以下依赖。Lakehouse Maven 最新依赖可以在 [maven库](https://central.sonatype.com/artifact/com.clickzetta/clickzetta-java) 中找到。

```SQL
<dependency>
    <groupId>com.clickzetta</groupId>
    <artifactId>clickzetta-java</artifactId>
    <version>1.3.1</version>
</dependency>
<!-- https://mvnrepository.com/artifact/org.apache.kafka/kafka-clients -->
<dependency>
    <groupId>org.apache.kafka</groupId>
    <artifactId>kafka-clients</artifactId>
    <version>3.2.0</version>
</dependency>
```

### 编写Java代码

1. **定义 Kafka 连接类**：创建一个 `KafkaReader` 类，配置 Kafka 消费者。
2. **消费 Kafka 并写入 Lakehouse**：创建 `Kafka2Lakehouse` 类，实现从 Kafka 读取数据并通过 RealtimeStream 写入 Lakehouse 的逻辑。

定义一个 Kafka 连接类，Kafka 的 Java 客户端配置可以参考 [Kafka官网](https://docs.confluent.io/kafka-clients/java/current/overview.html)。

```SQL
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import java.util.Collections;
import java.util.Properties;
// 创建一个消费者类
public class KafkaReader {
    // 定义一个kafka消费者对象
    private KafkaConsumer<String, String> consumer;
    // 定义一个构造方法，初始化消费者的配置
    public KafkaReader() {
        // 创建一个Properties对象，用于存储消费者的配置信息
        Properties props = new Properties();
        // 指定连接的kafka集群的地址
        props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
        // 指定消费者所属的消费者组
        props.put(ConsumerConfig.GROUP_ID_CONFIG, "test-group");
        // 指定消费者的key和value的反序列化器
        props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, "org.apache.kafka.common.serialization.StringDeserializer");
        props.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, "org.apache.kafka.common.serialization.StringDeserializer");
        // 指定消费者的自动位移提交策略
        props.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, "true");
        // 指定消费者的自动位移提交间隔
        props.put(ConsumerConfig.AUTO_COMMIT_INTERVAL_MS_CONFIG, "1000");
        // 使用配置信息创建一个kafka消费者对象
        consumer = new KafkaConsumer<>(props);
    }
    // 定义一个方法，用于从指定的主题中读取数据
    public KafkaConsumer<String, String> readFromTopic(String topic) {
        consumer.subscribe(Collections.singleton(topic));
        return consumer;
    }
}
```

消费 Kafka 数据并写入到 Lakehouse 中

```SQL

import com.clickzetta.client.ClickZettaClient;
import com.clickzetta.client.RealtimeStream;
import com.clickzetta.client.RowStream;
import com.clickzetta.platform.client.api.Options;
import com.clickzetta.platform.client.api.Row;
import com.clickzetta.platform.client.api.Stream;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.ConsumerRecords;
import org.apache.kafka.clients.consumer.KafkaConsumer;

import java.text.MessageFormat;
import java.time.Duration;

public class Kafka2Lakehouse {
    private static ClickZettaClient client;
    private static final String password = "";
    private static final String table = "realtime_stream";
    private static final String workspace = "";
    private static final String schema = "public";
    private static final String user = "";
    private static final String vc = "default";
    static RealtimeStream realtimeStream;
    static KafkaReader kafkaReader;
    //读取Topic并写入到Lakehouse中
    public static void main(String[] args) throws Exception {
        initialize();
        kafkaReader = new KafkaReader();
        final KafkaConsumer<String, String> consumer = kafkaReader.readFromTopic("lakehouse-stream");
        // 开始消费消息
        while (true) {
            int i = 1;
            try {
                ConsumerRecords<String, String> records = consumer.poll(Duration.ofSeconds(1));
                for (ConsumerRecord<String, String> record : records) {
                    Row row = realtimeStream.createRow(Stream.Operator.INSERT);
                    i++;
                    row.setValue("id", i);
                    row.setValue("event", record.value());

                    realtimeStream.apply(row);
                }
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        }
    }
    //初始化Lakehouse客户端和realtimeStream
    private static void initialize() throws Exception {
        String url = MessageFormat.format("jdbc:clickzetta://demo_instance.cn-shanghai-alicloud.api.clickzetta.com/{0}?" + "schema={1}&username={2}&password={3}&vcluster={4}", workspace, schema, user, password, vc);
        Options options = Options.builder().withMutationBufferLinesNum(10).build();
        client = ClickZettaClient.newBuilder().url(url).build();
        realtimeStream = client.newRealtimeStreamBuilder().operate(RowStream.RealTimeOperate.APPEND_ONLY).options(options).schema(schema).table(table).build();
    }
}
```

^
