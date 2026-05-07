## 功能概述

> **【预览发布】** 本功能当前处于公开预览阶段。

本文主要介绍如何在 SQL 中创建与 Kafka 消息队列系统连接的外部表。通过定义外部表，可以方便地从 Kafka 中读取数据流，并将这些数据作为表进行查询和分析。

## 创建存储连接

首先，需要创建一个存储连接，用于连接到 Kafka 服务器。目前不支持需要客户端证书的连接方式。

### 语法

```SQL
CREATE STORAGE CONNECTION connection_name
    TYPE kafka
    BOOTSTRAP_SERVERS = ['server1:port1', 'server2:port2', ...]
    SECURITY_PROTOCOL = 'PLAINTEXT';
```

### 参数说明

* **connection_name**: 连接的名称，用于后续引用。
* **TYPE**: 连接类型，此处为 `kafka`。
* **BOOTSTRAP_SERVERS**: Kafka 集群的地址列表，格式为 `['host1:port1', 'host2:port2', ...]`。
* **SECURITY_PROTOCOL**: 安全协议，可以是 `PLAINTEXT` 等。

### 示例

```SQL
CREATE STORAGE CONNECTION test_kafka_conn
    TYPE kafka
    BOOTSTRAP_SERVERS = ['47.99.48.62:9092']
    SECURITY_PROTOCOL = 'PLAINTEXT';
```

^
