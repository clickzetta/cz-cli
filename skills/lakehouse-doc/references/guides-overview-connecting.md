# 连接并使用Lakehouse

云器 Lakehouse 为您提供多种连接和操作方式，包括 Lakehouse Studio、Lakehouse CLI、驱动与连接器、SDK 等。本文档将详细介绍如何使用这些工具，以及提供一些实际使用示例。

## Lakehouse Studio：Lakehouse 开发与管理工具

Lakehouse Studio 为您提供了一套完整的数据管理工具，包括数据集成、开发分析、编排调度、监控运维、系统管理等。多角色用户可以在统一的体验下协作进行开发和分析。

详见：[Studio使用操作指南](studio_manual.md)

### 使用示例

1. 登录 Lakehouse Studio。
2. 在左侧导航栏中选择相应的管理工具。
3. 根据需要进行数据集成、开发分析等操作。

## Lakehouse CLI（命令行工具）

Lakehouse CLI 是 Lakehouse 提供的命令行工具。安装和配置连接后，您可以使用 Lakehouse CLI 客户端提交 SQL 命令。

## 驱动与连接器及 SDK

Lakehouse 支持多种驱动、连接器及 SDK，方便您通过不同的编程语言和工具访问 Lakehouse。

* JDBC 驱动：通过 JDBC 连接访问 Lakehouse。
* SQLAlchemy（Python ORM）：通过 SQLAlchemy 协议连接访问 Lakehouse。
* Flink Connector：通过该 Connector 实时写入数据。
* Java SDK：通过 Java SDK 连接访问 Lakehouse。
* Python SDK：通过 Python SDK 连接访问 Lakehouse。
* Catalog SDK：通过 Catalog SDK，开源引擎（如 Spark、Trino）可连接 Lakehouse 元数据并访问数据。
* Zettapark：与 PySpark 兼容的编程接口。

## JDBC地址获取

在 Lakehouse Studio 中，您可以轻松获取工作空间的 JDBC URL。
![](.topwrite/assets/image_1709103767129.png)

### 操作步骤

1. 登录 Lakehouse Studio。
2. 在左侧导航栏中选择“工作空间”。
3. 在工作空间详情页面，找到“JDBC URL”并复制。

## 生态工具

详见：[使用开源工具连接Lakehouse](eco_integration/sqlworkbench-j-lakehouse.md)
