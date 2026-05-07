# Apache Kafka 数据源配置指南

## 概述

Apache Kafka 是一个高吞吐量、可扩展的分布式事件流平台，非常适合构建实时数据管道和流分析应用程序。通过配置 Kafka 数据源，您可以实现与其他系统的高效数据流式传输。

## 参数配置

配置 Kafka 数据源时，需要提供以下信息以确保成功连接到 Kafka 集群：

* **数据源名称**：为您的 Kafka 数据源指定一个易于识别的唯一名称，例如 `OrderStreamKafka`。
* **Kafka 连接配置**：填写 Kafka 集群的服务地址，格式为 `host1:port,host2:port,host3:port`。例如，`order-kafka-broker-01:9092,order-kafka-broker-02:9092`。
* **Kafka 安全认证协议**：选择适当的安全认证协议，如无认证、SASL_PLAINTEXT、SASL_SSL/SCRAM。
* **JAAS 配置**：如果使用 SASL 认证（如 SASL_SSL 或 SASL_PLAINTEXT），提供 Java 认证和授权服务（JAAS）的配置字符串，例如 `org.apache.kafka.common.security.plain.PlainLoginModule required username="orderuser" password="orderpass";`。
* **Truststore (CA 证书) 文件**：如果使用 SSL/TLS 加密（如 SASL_SSL），指定 truststore 文件的路径，例如 `kafka.client.truststore.jks`。
* **Truststore 密码**：提供 truststore 的访问密码。
* **Keystore (客户端证书) 文件**：如果需要双向 SSL/TLS 认证（客户端认证），指定 keystore 文件的路径，例如 `kafka.client.keystore.jks`。
* **Keystore 密码**：提供 keystore 的访问密码。

## 连接配置

在连接配置方面，您需要注意以下事项：

* **直连**：确保您输入的连接信息在公网可访问。如果源端开启了IP访问白名单，请确保数据集成服务的出口IP地址已被添加到白名单中，具体IP地址请联系技术支持人员。

## 注意事项

* 确保 Kafka 集群的安全性和稳定性，合理配置认证和授权机制。
* 在生产环境中，建议使用加密连接（如 SASL_SSL）来保护数据传输的安全。
* 监控 Kafka 集群的运行状态，以便及时发现并解决潜在问题。

完成配置后，您就可以在数据同步任务中选择此 Kafka 数据源，进行数据的导入或导出操作。
