# 将数据导入云器 Lakehouse 的完整指南

## 概述

将数据导入云器 Lakehouse 的方法有很多种。不同的场景、要求、团队技能和技术栈选择都可能影响数据采集的决策。本快速入门将指导您完成使用不同方法加载相同数据的示例。

### 数据入仓

* 通过云器 Lakehouse Studio 加载本地文件
* 通过云器 Lakehouse Studio 批量加载（公网连接）
* 通过云器 Lakehouse Studio 批量加载（私网连接）
* 通过云器 Lakehouse Studio 实时多表加载（CDC）
* 使用 ZettaPark SQL 导入数据
* 使用 ZettaPark 从 DataFrame 导入数据
* 来自 Kafka – 采用 ZettaPipe
* 来自 Kafka – 外部表方式
* 来自数据湖（对象存储）– SQL Volume 方式
* 来自数据湖（对象存储）– SQL COPY INTO 方式
* 来自 External Catalog (Hive) – SQL 方式
* 从 Java SDK - 使用云器实时写入服务

### 数据入湖

* 通过数据库客户端 DBV/SQLWorkbench PUT 文件的方式
* 通过 ZettaPark PUT 文件的方式

在本指南结束时，您应该熟悉多种加载数据的方法，并能够根据您的目标和需求选择正确的模式。完成初始项目设置后，每种数据提取方法都可以单独进行，且彼此独立。

### 先决条件

* 云器 Lakehouse 账户需具备创建用户、角色、工作空间、Schema、动态表、虚拟计算集群、数据同步与调度任务等能力。
* 熟悉 SQL/Python、Kafka 和/或 Java，具体要求因数据加载方式而异。
* Docker 基础知识
* 能够在本地运行 Docker 或访问可运行 Kafka 及 Kafka Connector 的环境。

### 您将学到什么

* 如何以及何时使用云器 Lakehouse Studio 进行离线数据同步
* 如何以及何时使用云器 Lakehouse Studio 进行多表实时数据同步
* 如何从数据湖导入数据
* 如何以及何时从文件导入数据
* 如何从 Kafka 加载数据
* 如何从流中加载数据

### 需要什么

* [云器Lakehouse](https://www.yunqi.tech/)账户
* 本指南的 [Github代码库](https://github.com/yunqiqiliang/clickzetta_quickstart/tree/main/a_comprehensive_guide_to_ingesting_data_into_clickzetta)

### Mac 要求

* [Docker](https://docs.docker.com/desktop/install/mac-install/)安装
* [Conda](https://docs.conda.io/projects/conda/en/latest/user-guide/install/macos.html)安装

### Linux 要求

* [Docker](https://docs.docker.com/engine/install/ubuntu/)安装
* [Conda](https://docs.conda.io/projects/conda/en/stable/user-guide/install/linux.html)安装

### Windows 要求

* 适用于 Windows 的 [WSL with Ubuntu](https://learn.microsoft.com/en-us/windows/wsl/install)
* 在 Ubuntu 中安装 [Docker](https://docs.docker.com/engine/install/ubuntu/)
* 在 Ubuntu 中安装 [Conda](https://docs.conda.io/projects/conda/en/stable/user-guide/install/linux.html)

^
