# AutoMQ 数据源配置指南

## 概述

AutoMQ 是新一代云原生流数据平台，100% 兼容 Apache Kafka 协议。通过创新的存储架构设计，AutoMQ 将数据持久化分离至云存储（如 Amazon S3），实现了相比传统 Kafka 10 倍的成本降低和 100 倍的弹性提升，同时保持单位数毫秒级的延迟表现。AutoMQ 适用于构建实时数据管道、流式数据处理和事件驱动架构等场景。

## 参数配置

配置 AutoMQ 数据源时，需要提供以下信息以确保成功连接到 AutoMQ 集群：

### 基础配置

* **数据源名称**：为您的 AutoMQ 数据源指定一个易于识别的唯一名称。例如：`UserBehaviorAutoMQ`、`OrderStreamAutoMQ`。建议使用能够清晰表达数据用途的命名方式。

* **AutoMQ 连接配置**：填写 AutoMQ 集群的 Bootstrap Server 地址，格式为 `host1:port,host2:port,host3:port`。

  * 示例：`automq-broker-01.example.com:9092,automq-broker-02.example.com:9092`

### 安全认证配置

* **AutoMQ 安全认证协议**：根据您的集群安全策略选择合适的认证方式。AutoMQ 支持以下认证协议：

  * **无认证**：适用于开发测试环境或内网受保护环境
  * **SASL_PLAINTEXT**：使用 SASL 机制进行用户名密码认证，但数据传输未加密
  * **SASL_SSL**：使用 SASL 认证并通过 SSL/TLS 加密数据传输，推荐用于生产环境

### SASL 认证配置（当选择 SASL 认证时需要配置）

* **JAAS 配置**：提供 Java 认证和授权服务（JAAS）的配置字符串。不同认证机制的配置格式如下：

  **PLAIN 机制示例**：

  ```
  org.apache.kafka.common.security.plain.PlainLoginModule required username="automq_user" password="your_password";
  ```

  **SCRAM-SHA-256 机制示例**：

  ```
  org.apache.kafka.common.security.scram.ScramLoginModule required username="automq_user" password="your_password";
  ```

  **SCRAM-SHA-512 机制示例**：

  ```
  org.apache.kafka.common.security.scram.ScramLoginModule required username="automq_user" password="your_password";
  ```

### SSL/TLS 证书配置（当选择 SSL 加密时需要配置）

* **Truststore (CA 证书) 文件**：上传 Truststore 文件，用于验证 AutoMQ 服务器的身份。

  * 支持 JKS 和 PKCS12 格式

* **Truststore 密码**：提供访问 Truststore 文件的密码，确保证书安全。

* **Keystore (私钥) 文件**（可选）：如果 AutoMQ 集群启用了双向 TLS 认证（mTLS），则需要指定客户端 Keystore 文件路径。

  * 示例：`/security/automq.client.keystore.jks`

* **Keystore 密码**（可选）：提供访问 Keystore 文件的密码。

### 高级配置

* **数据源描述**（可选）：添加对数据源用途、业务场景的详细说明，便于团队成员理解和管理。例如："生产环境用户行为数据流，用于实时推荐系统"。

## 连接配置说明

### 网络连通性

在配置 AutoMQ 连接时，请注意以下事项：

* **公网访问**：如果 AutoMQ 集群部署在云端，请确保您输入的 Bootstrap Server 地址可通过公网访问。如果集群配置了 IP 白名单，请将数据集成服务的出口 IP 地址添加到白名单中。具体 IP 地址清单请联系技术支持人员获取。
* **VPC 内网访问**：如果数据集成服务与 AutoMQ 集群部署在同一 VPC 或已配置 VPC 对等连接，建议使用内网地址以降低网络延迟和传输成本。

### 授权工作空间

* **指定工作空间**：将数据源授权给特定的工作空间使用，适用于需要严格权限控制的场景。
* **全部工作空间**：允许所有工作空间访问此数据源，便于跨团队协作和数据共享。

建议您根据数据安全策略和团队协作需求，选择合适的授权范围。

## 连接测试

配置完成后，点击“测试连接”按钮验证配置的正确性：

* **测试成功**：表示配置参数正确，可以成功连接到 AutoMQ 集群。您可以继续保存或使用此数据源。

* **测试失败**：请检查以下常见问题：

  * Bootstrap Server 地址格式是否正确
  * 网络连通性是否正常（防火墙、安全组规则）
  * 认证信息（用户名、密码）是否准确
  * SSL 证书配置是否完整且有效
  * IP 白名单配置是否包含数据集成服务的出口 IP

## 注意事项

### 安全性建议

* **生产环境加密**：强烈建议在生产环境中使用 SASL_SSL 认证协议，确保数据传输的机密性和完整性。
* **密码管理**：妥善保管认证密码和证书密钥，避免在代码或日志中明文记录。
* **最小权限原则**：为数据集成服务创建专用的 AutoMQ 用户，仅授予必要的 Topic 读写权限。
* **定期轮换**：建议定期更新认证凭证和 SSL 证书，降低安全风险。

### 运维监控建议

* **指标监控**：AutoMQ 原生支持 Prometheus 和 OpenTelemetry 指标导出，建议将其接入您的监控系统进行实时监控。
* **关键指标**：重点关注生产消费延迟、消息积压量、集群吞吐量等核心指标。
* **告警配置**：针对异常情况（如消费延迟超阈值、磁盘使用率过高）配置及时的告警通知。

## 完成配置

完成所有参数配置并通过连接测试后，点击"确定"保存数据源。随后，您可以在数据同步任务中选择此 AutoMQ 数据源，进行数据的实时采集、传输或分发操作，充分发挥 AutoMQ 的云原生优势和成本效益。

## 相关资源

* **AutoMQ 官网**：<https://www.automq.com/>
* **AutoMQ 开源代码**：<https://github.com/AutoMQ/automq>
* **技术文档**：访问 AutoMQ 官网，获取详细的技术文档和最佳实践指南。

***

^
