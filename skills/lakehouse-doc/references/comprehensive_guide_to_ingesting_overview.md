# 将数据导入云器Lakehouse的完整指南

## 概述

将数据导入云器Lakehouse的方法有很多种。不同的场景、要求、团队技能和技术栈选择都可能会做出不同的数据采集决策。本快速入门将指导您完成使用不同方法加载相同数据的示例：

### 数据入仓

* 通过云器Lakehouse Studio 加载本地文件
* 通过云器Lakehouse Studio 批量加载（公网连接）
* 通过云器Lakehouse Studio 批量加载（私网连接）
* 通过云器Lakehouse Studio 实时多表加载（CDC）
* 使用 Zettapark SQL 导入数据
* 使用 Zettapark从Dataframe导入数据
* 来自 Kafka – 采用 Zettapipe
* 来自 Kafka – 外部表方式
* 来自数据湖（对象存储）- SQL Volume方式
* 来自数据湖（对象存储）- SQL Copy Into方式
* 来自External Catalog(Hive) - SQL方式
* 从 Java SDK - 使用云器实时写入服务

### 数据入湖

* 通过数据库客户端DBV/SQLWorkbench PUT文件的方式
* 通过ZettaPark PUT文件的方式

在本指南结束时，您应该熟悉多种加载数据的方法，并能够根据您的目标和需求选择正确的模式。完成初始项目设置后，每种提取方法都可以单独进行，并且彼此不依赖。

### 先决条件

* 云器Lakehouse帐户具有创建用户、角色、工作空间、Schema、动态表、虚拟计算集群、数据同步与调度任务等的能力
* 熟悉 Python、Kafka 和/或 Java
* Docker 基础知识
* 能够在本地运行 Docker 或访问环境来运行 Kafka 和 Kafka Connectors

### 您将学到什么

* 如何以及何时使用云器Lakehouse Studio的离线同步数据
* 如何以及何时使用云器Lakehouse Studio的多表实时同步数据
* 如何从数据湖导入数据
* 如何以及何时从文件导入数据
* 如何从 Kafka 加载数据
* 如何从流中加载数据

### 需要什么

* [云器Lakehouse](https://www.yunqi.tech/)账户
* 本指南的[Github代码库](https://github.com/yunqiqiliang/clickzetta_quickstart/tree/main/a_comprehensive_guide_to_ingesting_data_into_clickzetta)

### Mac 要求

* [Docker](https://docs.docker.com/desktop/install/mac-install/)安装
* [Conda](https://docs.conda.io/projects/conda/en/latest/user-guide/install/macos.html)安装

### Linux 要求

* [Docker](https://docs.docker.com/engine/install/ubuntu/)安装
* [Conda](https://docs.conda.io/projects/conda/en/stable/user-guide/install/linux.html)安装

### Windows 要求

* 适用于Windows的 [WSL with Ubuntu](https://learn.microsoft.com/en-us/windows/wsl/install)
* 在 Ubuntu 中安装 [Docker](https://docs.docker.com/engine/install/ubuntu/)
* 在 Ubuntu 中安装 [Conda](https://docs.conda.io/projects/conda/en/stable/user-guide/install/linux.html)

^
